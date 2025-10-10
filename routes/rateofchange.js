// routes/rateofchange.js
'use strict';

const express = require('express');
const router = express.Router();

const { Op } = require('sequelize');

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole     = require('../middleware/authorizeRole');

// Models
const Reading  = require('../models/Reading');
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
const Building = require('../models/Building');

/* =========================
 * Middleware
 * ========================= */
router.use(authenticateToken);

/* =========================
 * Local helpers (no DB)
 * ========================= */

// Hardcoded LPG minimum consumption (no DB reference)
const LPG_MIN_CON = 1;

// round to d decimals
function round(n, d = 2) {
  const f = Math.pow(10, d);
  return Math.round((Number(n) || 0) * f) / f;
}

// YYYY-MM-DD strings (match Reading.lastread_date = DATEONLY)
function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// month window based on an arbitrary endDate (YYYY-MM-DD)
function getPeriodStrings(endDateStr) {
  const end = new Date(endDateStr + 'T00:00:00Z');
  const currStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  const currEnd = new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000);

  const prevStart = new Date(Date.UTC(currStart.getUTCFullYear(), currStart.getUTCMonth() - 1, 1));
  const prevEnd = new Date(currStart.getTime() - 24 * 60 * 60 * 1000);

  const prePrevStart = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth() - 1, 1));
  const prePrevEnd = new Date(prevStart.getTime() - 24 * 60 * 60 * 1000);

  return {
    curr:   { start: ymd(currStart),   end: ymd(currEnd) },
    prev:   { start: ymd(prevStart),   end: ymd(prevEnd) },
    preprev:{ start: ymd(prePrevStart),end: ymd(prePrevEnd) },
  };
}

// unified consumption rule for all utilities
function computeUnitsOnly(meterType, meterMult, building, prevIdx, currIdx) {
  const t = String(meterType || '').toLowerCase();
  const mult = Number(meterMult) || 1;
  const prev = Number(prevIdx) || 0;
  const curr = Number(currIdx) || 0;

  const raw = (curr - prev) * mult;

  if (t === 'electric') {
    const min = Number(building.emin_con) || 0;
    return round(raw > 0 ? raw : min);
  }
  if (t === 'water') {
    const min = Number(building.wmin_con) || 0;
    return round(raw > 0 ? raw : min);
  }
  if (t === 'lpg') {
    // Use hardcoded minimum for LPG
    return round(raw > 0 ? raw : LPG_MIN_CON);
  }
  throw new Error(`Unsupported meter type: ${t}`);
}

/* =========================
 * DB helpers
 * ========================= */

// Latest reading within a [start, end] DATEONLY range (by lastread_date desc)
async function getMaxReadingInPeriod(meter_id, startStr, endStr) {
  const row = await Reading.findOne({
    where: {
      meter_id,
      lastread_date: { [Op.gte]: startStr, [Op.lte]: endStr },
    },
    order: [['lastread_date', 'DESC']],
    raw: true,
  });
  return row ? { value: Number(row.reading_value) || 0, date: row.lastread_date } : null;
}

/* =========================
 * Core computation
 * ========================= */

async function computeROCForMeter({ meterId, endDate, user }) {
  // Meter → Stall → Building
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    attributes: ['meter_id', 'meter_type', 'meter_mult', 'stall_id'],
    raw: true
  });
  if (!meter) { const err = new Error('Meter not found'); err.status = 404; throw err; }

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['stall_id', 'building_id'],
    raw: true
  });
  if (!stall) { const err = new Error('Stall not found for this meter'); err.status = 404; throw err; }

  // scope guard for non-admins
  const lvl = (user?.user_level || '').toLowerCase();
  if (lvl !== 'admin') {
    const userBldg = user?.building_id;
    if (!userBldg) { const err = new Error('Unauthorized: No building assigned'); err.status = 401; throw err; }
    if (stall.building_id !== userBldg) { const err = new Error('No access to this meter'); err.status = 403; throw err; }
  }

  // Only need electric & water mins from DB (LPG min is hardcoded)
  const building = await Building.findOne({
    where: { building_id: stall.building_id },
    attributes: ['building_id','emin_con','wmin_con'],
    raw: true
  });
  if (!building) { const err = new Error('Building configuration not found'); err.status = 400; throw err; }

  const periods = getPeriodStrings(endDate);
  const [currMax, prevMax, prePrevMax] = await Promise.all([
    getMaxReadingInPeriod(meterId, periods.curr.start, periods.curr.end),
    getMaxReadingInPeriod(meterId, periods.prev.start, periods.prev.end),
    getMaxReadingInPeriod(meterId, periods.preprev.start, periods.preprev.end),
  ]);

  if (!currMax || !prevMax) {
    const err = new Error(
      `Insufficient readings to compute current period. Need data in ${periods.curr.start}..${periods.curr.end} and ${periods.prev.start}..${periods.prev.end}.`
    );
    err.status = 400;
    throw err;
  }

  const unitsNow = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prevMax.value, currMax.value);

  let unitsPrev = null;
  let roc = null;
  if (prePrevMax && prevMax) {
    unitsPrev = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prePrevMax.value, prevMax.value);
    if (unitsPrev > 0) {
      roc = Math.ceil(((unitsNow - unitsPrev) / unitsPrev) * 100);
    }
  }

  return {
    meter_id: meter.meter_id,
    meter_type: String(meter.meter_type || '').toLowerCase(),
    building_id: stall.building_id,
    period: {
      current: { start: periods.curr.start, end: periods.curr.end },
      previous: { start: periods.prev.start, end: periods.prev.end }
    },
    indices: {
      prev_index: round(prevMax.value, 2),
      curr_index: round(currMax.value, 2)
    },
    current_consumption: unitsNow,
    previous_consumption: unitsPrev,
    rate_of_change: roc
  };
}

/* =========================
 * Routes
 * ========================= */

/**
 * GET /rateofchange/meters/:meter_id/period-end/:endDate
 * endDate format: YYYY-MM-DD (e.g., 2025-02-20)
 */
router.get(
  '/meters/:meter_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { meter_id, endDate } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }
      const result = await computeROCForMeter({ meterId: meter_id, endDate, user: req.user });
      return res.json(result);
    } catch (err) {
      console.error('Rate-of-change (meter) error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

/**
 * GET /rateofchange/tenants/:tenant_id/period-end/:endDate
 * Aggregates all meters for a tenant (scoped to user building if non-admin).
 */
router.get(
  '/tenants/:tenant_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { tenant_id, endDate } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      // Stalls for tenant (then scope to user building if needed)
      const stalls = await Stall.findAll({
        where: { tenant_id },
        attributes: ['stall_id', 'building_id'],
        raw: true
      });
      if (!stalls.length) return res.status(404).json({ error: 'No stalls found for this tenant' });

      const lvl = (req.user?.user_level || '').toLowerCase();
      const scopedStalls = (lvl === 'admin')
        ? stalls
        : stalls.filter(s => s.building_id === req.user?.building_id);

      if (!scopedStalls.length) {
        return res.status(403).json({ error: 'No accessible stalls in your building' });
      }

      const stallIds = scopedStalls.map(s => s.stall_id);
      const meters = await Meter.findAll({
        where: { stall_id: { [Op.in]: stallIds } },
        attributes: ['meter_id'],
        raw: true
      });
      if (!meters.length) return res.status(404).json({ error: 'No meters for this tenant (in your scope)' });

      // Compute per meter
      const perMeter = [];
      for (const m of meters) {
        try {
          const r = await computeROCForMeter({ meterId: m.meter_id, endDate, user: req.user });
          perMeter.push(r);
        } catch (innerErr) {
          perMeter.push({ meter_id: m.meter_id, error: innerErr.message || 'Failed to compute consumption' });
        }
      }

      // Aggregate by type + overall
      const byType = {};
      let aggCurrent = 0;
      let aggPrevious = 0;

      for (const r of perMeter) {
        if (r.error) continue;
        const t = r.meter_type;
        if (!byType[t]) byType[t] = { current_consumption: 0, previous_consumption: 0, meters: 0 };
        byType[t].current_consumption  += Number(r.current_consumption) || 0;
        byType[t].previous_consumption += Number(r.previous_consumption) || 0;
        byType[t].meters += 1;

        aggCurrent  += Number(r.current_consumption) || 0;
        aggPrevious += Number(r.previous_consumption) || 0;
      }

      Object.keys(byType).forEach(k => {
        byType[k].current_consumption  = round(byType[k].current_consumption);
        byType[k].previous_consumption = round(byType[k].previous_consumption);
      });

      const overall_rate_of_change =
        aggPrevious > 0 ? Math.ceil(((aggCurrent - aggPrevious) / aggPrevious) * 100) : null;

      return res.json({
        tenant_id,
        end_date: endDate,
        meters: perMeter,
        consumption_by_type: byType,
        totals: {
          current_consumption: round(aggCurrent),
          previous_consumption: round(aggPrevious),
          rate_of_change: overall_rate_of_change
        }
      });
    } catch (err) {
      console.error('Rate-of-change (tenant) error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

module.exports = router;
