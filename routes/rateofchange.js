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
const Tenant   = require('../models/Tenant'); // <-- needed for per-tenant route

/* =========================
 * Middleware
 * ========================= */
router.use(authenticateToken);

/* =========================
 * Error helper
 * ========================= */
function sendErr(res, err, context = 'ROC error') {
  const status = (err && err.status) || 500;
  const msg =
    (typeof err?.message === 'string' && err.message.trim()) ? err.message :
    (typeof err === 'string' && err.trim()) ? err :
    'Internal Server Error';
  console.error(`${context}:`, err?.stack || err);
  return res.status(status).json({ error: msg });
}

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

function isYMD(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }

/**
 * HYBRID period calculator (used for computations to match Excel math):
 *  - Current window: 1st day of end month .. endDate (inclusive)
 *  - Previous window: full previous calendar month
 *  - Pre-previous window: full month before previous
 */
function getPeriodStrings(endDateStr) {
  if (!isYMD(endDateStr)) {
    const err = new Error('Invalid end_date format. Use YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  const end = new Date(endDateStr + 'T00:00:00Z');

  const firstOfMonth = (y, m) => new Date(Date.UTC(y, m, 1));
  const lastOfMonth  = (y, m) => new Date(Date.UTC(y, m + 1, 1) - 24 * 60 * 60 * 1000);

  const y = end.getUTCFullYear();
  const m = end.getUTCMonth();

  // Current: 1st of end-month .. endDate
  const currStart = firstOfMonth(y, m);
  const currEnd   = end;

  // Previous: full previous month
  const prevYear  = (m === 0) ? y - 1 : y;
  const prevMonth = (m === 0) ? 11 : m - 1;
  const prevStart = firstOfMonth(prevYear, prevMonth);
  const prevEnd   = lastOfMonth(prevYear, prevMonth);

  // Pre-previous: full month before previous
  const pprevYear  = (prevMonth === 0) ? prevYear - 1 : prevYear;
  const pprevMonth = (prevMonth === 0) ? 11 : prevMonth - 1;
  const prePrevStart = firstOfMonth(pprevYear, pprevMonth);
  const prePrevEnd   = lastOfMonth(pprevYear, pprevMonth);

  return {
    curr:    { start: ymd(currStart),    end: ymd(currEnd) },
    prev:    { start: ymd(prevStart),    end: ymd(prevEnd) },
    preprev: { start: ymd(prePrevStart), end: ymd(prePrevEnd) },
  };
}

/**
 * DISPLAY-ONLY rolling periods (for the JSON output):
 *  - Current: end_date - 30 days .. end_date (inclusive)
 *  - Previous: the 31-day block immediately before current
 */
function getDisplayRollingPeriods(endDateStr, windowDays = 31) {
  if (!isYMD(endDateStr)) {
    const err = new Error('Invalid end_date format. Use YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  const end = new Date(endDateStr + 'T00:00:00Z');
  const addDays = (d, n) => {
    const t = new Date(d.getTime());
    t.setUTCDate(t.getUTCDate() + n);
    return t;
  };

  const currEnd   = end;
  const currStart = addDays(end, -(windowDays - 1));

  const prevEnd   = addDays(currStart, -1);
  const prevStart = addDays(prevEnd, -(windowDays - 1));

  return {
    curr: { start: ymd(currStart), end: ymd(currEnd) },
    prev: { start: ymd(prevStart), end: ymd(prevEnd) }
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
  throw Object.assign(new Error(`Unsupported meter type: ${t}`), { status: 400 });
}

/* =========================
 * Auth scope helpers (arrays-aware, admin bypass)
 * ========================= */
function isAdmin(user) {
  const roles = Array.isArray(user?.user_roles)
    ? user.user_roles.map(r => String(r || '').toLowerCase())
    : (user?.user_level ? [String(user.user_level).toLowerCase()] : []);
  return roles.includes('admin');
}

function userBuildings(user) {
  const arr = Array.isArray(user?.building_ids) ? user.building_ids : [];
  const single = user?.building_id ? [user.building_id] : [];
  return Array.from(new Set([...arr, ...single].map(String)));
}

function enforceScopeOrThrow(user, stall) {
  if (isAdmin(user)) return;
  const buildings = userBuildings(user);
  if (!buildings.length) {
    throw Object.assign(new Error('Unauthorized: No buildings assigned'), { status: 401 });
  }
  if (!buildings.includes(String(stall.building_id))) {
    throw Object.assign(new Error('No access to this meter'), { status: 403 });
  }
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

  // scope guard (arrays-aware)
  enforceScopeOrThrow(user, stall);

  // Only need electric & water mins from DB (LPG min is hardcoded)
  const building = await Building.findOne({
    where: { building_id: stall.building_id },
    attributes: ['building_id','emin_con','wmin_con'],
    raw: true
  });
  if (!building) { const err = new Error('Building configuration not found'); err.status = 400; throw err; }

  // HYBRID periods for computation
  const periods = getPeriodStrings(endDate);

  // Max indices in each window
  const [currMax, prevMax, prePrevMax] = await Promise.all([
    getMaxReadingInPeriod(meterId, periods.curr.start,    periods.curr.end),
    getMaxReadingInPeriod(meterId, periods.prev.start,    periods.prev.end),
    getMaxReadingInPeriod(meterId, periods.preprev.start, periods.preprev.end),
  ]);

  if (!currMax || !prevMax) {
    const err = new Error(
      `Insufficient readings to compute current period. Need data in ${periods.curr.start}..${periods.curr.end} and ${periods.prev.start}..${periods.prev.end}.`
    );
    err.status = 400;
    throw err;
  }

  // Excel logic:
  // Previous Consumed = (Max prev month - Max pre-previous month) * mult
  // Current  Consumed = (Max current window - Max prev month) * mult
  const unitsNow = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prevMax.value, currMax.value);

  let unitsPrev = null;
  let roc = null;
  if (prePrevMax && prevMax) {
    unitsPrev = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prePrevMax.value, prevMax.value);
    if (unitsPrev > 0) {
      roc = Math.ceil(((unitsNow - unitsPrev) / unitsPrev) * 100);
    }
  }

  // DISPLAY rolling windows for the JSON output
  const display = getDisplayRollingPeriods(endDate);

  return {
    meter_id: meter.meter_id,
    stall_id: stall.stall_id,                 // <-- include stall
    building_id: stall.building_id,
    meter_type: String(meter.meter_type || '').toLowerCase(),
    period: {
      current:  { start: display.curr.start,  end: display.curr.end },
      previous: { start: display.prev.start,  end: display.prev.end }
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
      if (!isYMD(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }
      const result = await computeROCForMeter({ meterId: meter_id, endDate, user: req.user });
      return res.json(result);
    } catch (err) {
      sendErr(res, err, 'Rate-of-change (meter) error');
    }
  }
);

/**
 * NEW: Per-tenant ROC across all meters (shows per-meter with stall)
 * GET /rateofchange/tenants/:tenant_id/period-end/:endDate
 * Roles: admin, operator, biller (add 'reader' if you want)
 */
router.get(
  '/tenants/:tenant_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { tenant_id, endDate } = req.params;
      if (!isYMD(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      // Find stalls for tenant
      const stalls = await Stall.findAll({
        where: { tenant_id },
        attributes: ['stall_id', 'building_id'],
        raw: true
      });
      if (!stalls.length) {
        return res.status(404).json({ error: 'No stalls found for this tenant' });
      }

      // Scope: filter stalls for non-admins
      const allowed = isAdmin(req.user)
        ? stalls
        : stalls.filter(s => userBuildings(req.user).includes(String(s.building_id)));

      if (!allowed.length) {
        return res.status(403).json({ error: 'No accessible stalls in your assigned buildings' });
      }

      const stallIds = allowed.map(s => s.stall_id);

      // Meters under those stalls
      const meters = await Meter.findAll({
        where: { stall_id: { [Op.in]: stallIds } },
        attributes: ['meter_id', 'stall_id'],
        raw: true
      });
      if (!meters.length) {
        return res.status(404).json({ error: 'No meters found for this tenant (within your scope)' });
      }

      // Compute per meter using the same function
      const results = [];
      for (const m of meters) {
        try {
          const r = await computeROCForMeter({ meterId: m.meter_id, endDate, user: req.user });
          results.push(r); // includes stall_id in the return
        } catch (e) {
          results.push({
            meter_id: m.meter_id,
            stall_id: m.stall_id,
            error: (e && e.message) || 'Failed to compute rate of change'
          });
        }
      }

      // Overall display periods
      const display = getDisplayRollingPeriods(endDate);

      return res.json({
        tenant_id,
        period: {
          current:  display.curr,
          previous: display.prev
        },
        meters: results
      });
    } catch (err) {
      sendErr(res, err, 'Rate-of-change (tenant) error');
    }
  }
);

module.exports = router;
