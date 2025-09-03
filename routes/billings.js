const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/authenticateToken'); // JWT → req.user
const authorizeRole = require('../middleware/authorizeRole');        // 'admin' | 'employee'

const Reading = require('../models/Reading');
const Meter   = require('../models/Meter');
const Stall   = require('../models/Stall');
const Building= require('../models/Building');
const Rate    = require('../models/Rate');

const { Op } = require('sequelize');

// ---------- helpers ----------
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function isAdmin(req) {
  return (req.user?.user_level || '').toLowerCase() === 'admin';
}

// Add months in UTC, keeping the day when possible (similar to “billing month” roll)
function addMonthsUTC(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(y, m + months, 1));
  // clamp to month length
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function addDaysUTC(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Build current period from an endDate: [start = end - 1 month + 1 day, end]
function getCurrentPeriodFromEnd(endDateStr) {
  const start = ymd(addDaysUTC(ymd(addMonthsUTC(endDateStr, -1)), +1));
  const end   = ymd(endDateStr);
  return { start, end };
}

// Build previous period from current period’s start: [prevStart, prevEnd = start - 1 day]
function getPreviousPeriodFromCurrent(currentStartStr) {
  const prevEnd   = ymd(addDaysUTC(currentStartStr, -1));
  const prevStart = ymd(addDaysUTC(ymd(addMonthsUTC(prevEnd, -1)), +1));
  return { prevStart, prevEnd };
}

// MAX(reading_value) within [start, end]
async function getMaxReadingInPeriod(meterId, startDate, endDate) {
  const row = await Reading.findOne({
    where: {
      meter_id: meterId,
      lastread_date: { [Op.between]: [startDate, endDate] },
    },
    order: [
      ['reading_value', 'DESC'],
      ['lastread_date', 'DESC'],
      ['reading_id', 'DESC'],
    ],
    attributes: ['reading_value', 'lastread_date'],
    raw: true,
  });
  if (!row) return null;
  return { value: Number(row.reading_value) || 0, date: row.lastread_date };
}

function round(n, d) {
  if (n === null || n === undefined) return null;
  return Number(Number(n).toFixed(d));
}

// ---------- auth ----------
router.use(authenticateToken); // attaches req.user (user_id, user_level, user_fullname, building_id) :contentReference[oaicite:7]{index=7}

/**
 * GET /billings/meters/:meter_id/period-end/:endDate
 *   - :endDate is the period-end day (YYYY-MM-DD). Example: 2025-01-20 → current: 2024-12-21..2025-01-20, previous: 2024-11-21..2024-12-20
 * Access:
 *   - admin: any meter
 *   - employee: only meters under their assigned building
 */
router.get(
  '/meters/:meter_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const meterId  = req.params.meter_id;
      const endDate  = req.params.endDate;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      // 1) Resolve meter → stall (for building + tenant)
      const meter = await Meter.findOne({
        where: { meter_id: meterId },
        attributes: ['meter_id', 'meter_type', 'meter_mult', 'stall_id'],
        raw: true
      });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      const stall = await Stall.findOne({
        where: { stall_id: meter.stall_id },
        attributes: ['building_id', 'tenant_id'],
        raw: true
      });
      if (!stall) return res.status(404).json({ error: 'Stall not found for this meter' });

      // 2) Building scope for non-admins
      if ((req.user?.user_level || '').toLowerCase() !== 'admin') {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        if (stall.building_id !== userBldg) {
          return res.status(403).json({ error: 'No access: Meter not under your assigned building' });
        }
      }

      // 3) Tenant → rate (tenant-scoped rates)
      if (!stall.tenant_id) {
        return res.status(400).json({ error: 'Stall has no tenant; no rate available.' });
      }
      const rate = await Rate.findOne({
        where: { tenant_id: stall.tenant_id },
        raw: true
      });
      if (!rate) {
        return res.status(400).json({ error: 'No utility rate configured for this tenant.' });
      }

      // 4) Compute periods from endDate
      const currStart = ymd(new Date(addDaysUTC(ymd(addMonthsUTC(endDate, -1)), +1)));
      const currEnd   = ymd(new Date(endDate));
      const prevEnd   = ymd(addDaysUTC(currStart, -1));
      const prevStart = ymd(addDaysUTC(ymd(addMonthsUTC(prevEnd, -1)), +1));

      // 5) Get MAX index per period
      const currMax = await getMaxReadingInPeriod(meterId, currStart, currEnd);
      const prevMax = await getMaxReadingInPeriod(meterId, prevStart, prevEnd);
      if (!currMax) return res.status(400).json({ error: `No readings for ${currStart}..${currEnd}` });
      if (!prevMax) return res.status(400).json({ error: `No readings for ${prevStart}..${prevEnd}` });

      // 6) Compute using your same logic
      const mtype = String(meter.meter_type || '').toLowerCase();
      const mult  = Number(meter.meter_mult) || 1;
      const vCurr = Number(currMax.value) || 0;
      const vPrev = Number(prevMax.value) || 0;

      let consumption, base, vat, total;
      if (mtype === 'lpg') {
        const lrate = Number(rate.lrate_perKg) || 0;
        consumption = vCurr;
        base  = consumption * lrate;
        vat   = 0;
        total = base + vat;
      } else if (mtype === 'electric') {
        consumption = (vCurr - vPrev) * mult;
        const emin  = Number(rate.emin_con) || 0;
        if (consumption <= 0) consumption = emin;
        const erate = Number(rate.erate_perKwH) || 0;
        const eVat  = Number(rate.e_vat) || 0;
        base  = consumption * erate;
        vat   = base * eVat;
        total = base + vat;
      } else if (mtype === 'water') {
        consumption = (vCurr - vPrev) * mult;
        const wmin  = Number(rate.wmin_con) || 0;
        if (consumption <= 0) consumption = wmin;
        const wrate = Number(rate.wrate_perCbM) || 0;
        const wnet  = Number(rate.wnet_vat);
        const wVat  = Number(rate.w_vat) || 0;
        if (!Number.isFinite(wnet) || wnet <= 0) {
          return res.status(400).json({ error: 'Invalid water rate: wnet_vat must be > 0' });
        }
        base  = (consumption * wrate) / wnet;
        vat   = base * wVat;
        total = base + vat;
      } else {
        return res.status(400).json({ error: `Unsupported meter type: ${mtype}` });
      }

      return res.json({
        meter_id: meterId,
        meter_type: mtype,
        period_prev: { start: prevStart, end: prevEnd, max_reading_value: round(vPrev, 2), max_read_date: prevMax.date },
        period_curr: { start: currStart, end: currEnd, max_reading_value: round(vCurr, 2), max_read_date: currMax.date },
        prev_consumption_index: round(vPrev, 2),
        current_consumption_index: round(vCurr, 2),
        consumption: round(consumption, 2),
        base: round(base, 2),
        vat: round(vat, 2),
        total: round(total, 2)
      });
    } catch (err) {
      console.error('Billing period error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);


module.exports = router;
