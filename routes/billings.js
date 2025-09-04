// routes/billings.js
const express = require('express');
const router = express.Router();

const { Op } = require('sequelize');

// Middlewares
const authenticateToken = require('../middleware/authenticateToken'); // attaches req.user
const authorizeRole     = require('../middleware/authorizeRole');     // 'admin' | 'operator' | 'biller'

// Models
const Reading  = require('../models/Reading');
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
const Rate     = require('../models/Rate');

// ------------------------------------------------------
// Config
// ------------------------------------------------------
// Labels around zero windows:
//  - 'include_zero_edge': Billable#1 ends on FIRST zero day; Billable#2 starts on LAST zero day
//  - 'exclude_zero_edge': Billable#1 ends the day BEFORE; Billable#2 starts the day AFTER
const BOUNDARY_MODE = 'include_zero_edge';

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function addMonthsUTC(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const next = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}
function addDaysUTC(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function round(n, d) {
  if (n === null || n === undefined) return null;
  return Number(Number(n).toFixed(d));
}
function dayAdd(dateStr, days) { return ymd(addDaysUTC(dateStr, days)); }
function dayBefore(dateStr) { return dayAdd(dateStr, -1); }
function dayAfter(dateStr)  { return dayAdd(dateStr, +1); }

// Build current/previous monthly periods from an end date
function getCurrentPeriodFromEnd(endDateStr) {
  const start = ymd(addDaysUTC(ymd(addMonthsUTC(endDateStr, -1)), +1));
  const end   = ymd(endDateStr);
  return { start, end };
}
function getPreviousPeriodFromCurrent(currentStartStr) {
  const prevEnd   = ymd(addDaysUTC(currentStartStr, -1));
  const prevStart = ymd(addDaysUTC(ymd(addMonthsUTC(prevEnd, -1)), +1));
  return { prevStart, prevEnd };
}

// Get the (value,date) of the MAX reading_value within [start..end]
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

// Find contiguous ranges of zero readings inside [start..end].
// Each run is { start, end } where `end` is EXACTLY the last zero day.
async function getZeroRuns(meterId, start, end) {
  const rows = await Reading.findAll({
    where: {
      meter_id: meterId,
      lastread_date: { [Op.between]: [start, end] },
      reading_value: 0
    },
    attributes: ['lastread_date'],
    order: [['lastread_date', 'ASC']],
    raw: true
  });
  if (!rows.length) return [];

  const runs = [];
  let runStart = ymd(rows[0].lastread_date);
  let prev     = runStart;

  for (let i = 1; i < rows.length; i++) {
    const d = ymd(rows[i].lastread_date);
    if (d === dayAfter(prev)) {
      prev = d; // still contiguous zero
    } else {
      runs.push({ start: runStart, end: prev }); // end == last zero day
      runStart = d;
      prev = d;
    }
  }
  runs.push({ start: runStart, end: prev });
  return runs;
}

// Compute period bill for (prevIdx → currIdx), respecting meter type rules.
function computeChargesByType(mtype, mult, rate, prevIdx, currIdx) {
  let consumption, base, vat, total;

  if (mtype === 'lpg') {
    const lrate = Number(rate.lrate_perKg) || 0;
    consumption = Number(currIdx) || 0; // LPG: value represents qty directly
    base  = consumption * lrate;
    vat   = 0;
    total = base + vat;
  } else if (mtype === 'electric') {
    const emin  = Number(rate.emin_con) || 0;
    const erate = Number(rate.erate_perKwH) || 0;
    const eVat  = Number(rate.e_vat) || 0;

    consumption = (Number(currIdx) - Number(prevIdx)) * Number(mult || 1);
    if (consumption <= 0) consumption = emin; // enforce minimum per segment
    base  = consumption * erate;
    vat   = base * eVat;
    total = base + vat;
  } else if (mtype === 'water') {
    const wmin  = Number(rate.wmin_con) || 0;
    const wrate = Number(rate.wrate_perCbM) || 0;
    const wnet  = Number(rate.wnet_vat);
    const wVat  = Number(rate.w_vat) || 0;
    if (!Number.isFinite(wnet) || wnet <= 0) throw new Error('Invalid water rate: wnet_vat must be > 0');

    consumption = (Number(currIdx) - Number(prevIdx)) * Number(mult || 1);
    if (consumption <= 0) consumption = wmin;
    base  = (consumption * wrate) / wnet;
    vat   = base * wVat;
    total = base + vat;
  } else {
    throw new Error(`Unsupported meter type: ${mtype}`);
  }

  return {
    consumption: round(consumption, 2),
    base: round(base, 2),
    vat: round(vat, 2),
    total: round(total, 2),
  };
}

// ------------------------------------------------------
// Auth
// ------------------------------------------------------
router.use(authenticateToken);

// ------------------------------------------------------
// Route
// ------------------------------------------------------

/**
 * GET /billings/meters/:meter_id/period-end/:endDate
 * Example: endDate=2025-01-20 → current: 2024-12-21..2025-01-20; previous: 2024-11-21..2024-12-20
 *
 * Access:
 * - admin: any meter
 * - operator/biller: only meters under their assigned building
 */
router.get(
  '/meters/:meter_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const meterId = req.params.meter_id;
      const endDate = req.params.endDate;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      // 1) Meter → Stall
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

      // 3) Tenant rate
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

      // 4) Periods
      const { start: currStart, end: currEnd } = getCurrentPeriodFromEnd(endDate);
      const { prevStart, prevEnd }             = getPreviousPeriodFromCurrent(currStart);

      // 5) Max indices for baseline and snapshot
      const currMax = await getMaxReadingInPeriod(meterId, currStart, currEnd);
      const prevMax = await getMaxReadingInPeriod(meterId, prevStart, prevEnd);
      if (!currMax) return res.status(400).json({ error: `No readings for ${currStart}..${currEnd}` });
      if (!prevMax) return res.status(400).json({ error: `No readings for ${prevStart}..${prevEnd}` });

      const mtype = String(meter.meter_type || '').toLowerCase();
      const mult  = Number(meter.meter_mult) || 1;

      // 6) Detect downtime windows (zeros), each ending on the last zero day
      const zeroRuns = await getZeroRuns(meterId, currStart, currEnd);

      // 7) Build split segments (billable/downtime)
      const segments = [];
      let anchorIdx = Number(prevMax.value); // first billable baseline
      let pointer   = currStart;

      for (const run of zeroRuns) {
        // Billable BEFORE downtime
        const preEnd = (BOUNDARY_MODE === 'include_zero_edge') ? run.start : dayBefore(run.start);
        if (pointer <= preEnd) {
          const segMax = await getMaxReadingInPeriod(meterId, pointer, preEnd);
          if (segMax) {
            const charges = computeChargesByType(mtype, mult, rate, anchorIdx, segMax.value);
            segments.push({
              type: 'billable',
              start: pointer,
              end: preEnd,
              prev_index: round(anchorIdx, 2),
              curr_index: round(Number(segMax.value) || 0, 2),
              ...charges
            });
            anchorIdx = Number(segMax.value); // move baseline forward
          }
        }

        // Downtime segment (zeros)
        segments.push({
          type: 'downtime',
          start: run.start,
          end: run.end,
          reason: 'zero readings',
          // Billing set later as null/0 in the final mapping
        });

        // Next billable start
        pointer = (BOUNDARY_MODE === 'include_zero_edge') ? run.end : dayAfter(run.end);
      }

      // Trailing billable AFTER last downtime (or entire window if no downtime)
      if (pointer <= currEnd) {
        const segMax = await getMaxReadingInPeriod(meterId, pointer, currEnd);
        if (segMax) {
          const charges = computeChargesByType(mtype, mult, rate, anchorIdx, segMax.value);
          segments.push({
            type: 'billable',
            start: pointer,
            end: currEnd,
            prev_index: round(anchorIdx, 2),
            curr_index: round(Number(segMax.value) || 0, 2),
            ...charges
          });
          anchorIdx = Number(segMax.value);
        }
      }

      // 8) Grouped output: keep all data per period
      const periods = segments.map(s => ({
        type: s.type, // "billable" | "downtime"
        start: s.start,
        end: s.end,
        ...(s.type === 'downtime' ? { reason: s.reason || 'zero readings' } : {}),
        bill: {
          prev_index: s.type === 'billable' ? (s.prev_index ?? null) : null,
          curr_index: s.type === 'billable' ? (s.curr_index ?? null) : null,
          consumption: s.type === 'billable' ? (s.consumption ?? 0) : 0,
          base: s.type === 'billable' ? (s.base ?? 0) : 0,
          vat: s.type === 'billable' ? (s.vat ?? 0) : 0,
          total: s.type === 'billable' ? (s.total ?? 0) : 0
        }
      }));

      // 9) Roll-up totals across BILLABLE periods
      const totals = periods.reduce((acc, p) => {
        if (p.type !== 'billable') return acc;
        acc.consumption += Number(p.bill.consumption) || 0;
        acc.base        += Number(p.bill.base) || 0;
        acc.vat         += Number(p.bill.vat) || 0;
        acc.total       += Number(p.bill.total) || 0;
        return acc;
      }, { consumption: 0, base: 0, vat: 0, total: 0 });

      // 10) Respond with simplified, grouped payload
      return res.json({
        meter_id: meterId,
        meter_type: mtype,
        periods,    // clean, split periods with all numbers retained
        totals      // billable-only rollup
      });

    } catch (err) {
      console.error('Billing period error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
