// utils/rocUtils.js
'use strict';

const { Op } = require('sequelize');

// Models (used by compute + helpers)
const Reading  = require('../models/Reading');
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
const Building = require('../models/Building');

/* ============ Error helper ============ */
function sendErr(res, err, context = 'ROC error') {
  const status = (err && err.status) || 500;
  const msg =
    (typeof err?.message === 'string' && err.message.trim()) ? err.message :
    (typeof err === 'string' && err.trim()) ? err :
    'Internal Server Error';
  console.error(`${context}:`, err?.stack || err);
  return res.status(status).json({ error: msg });
}

/* ============ Pure helpers (no DB) ============ */
const LPG_MIN_CON = 1;

function round(n, d = 2) {
  const f = Math.pow(10, d);
  return Math.round((Number(n) || 0) * f) / f;
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isYMD(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }

/**
 * HYBRID period calculator (matches your Excel):
 *  - Current: 1st day of end month .. endDate (inclusive)
 *  - Previous: full previous calendar month
 *  - Pre-previous: full month before previous
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
 * DISPLAY-ONLY rolling windows for the JSON output:
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

/* ============ DB helpers ============ */
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

/* ============ Core compute (no auth; middlewares do that) ============ */
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
    return round(raw > 0 ? raw : LPG_MIN_CON);
  }
  throw Object.assign(new Error(`Unsupported meter type: ${t}`), { status: 400 });
}

async function computeROCForMeter({ meterId, endDate }) {
  // Meter → Stall → Building
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    attributes: ['meter_id', 'meter_type', 'meter_mult', 'stall_id'],
    raw: true
  });
  if (!meter) { const err = new Error('Meter not found'); err.status = 404; throw err; }

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['stall_id', 'tenant_id', 'building_id'],
    raw: true
  });
  if (!stall) { const err = new Error('Stall not found for this meter'); err.status = 404; throw err; }

  const building = await Building.findOne({
    where: { building_id: stall.building_id },
    attributes: ['building_id', 'emin_con', 'wmin_con'],
    raw: true
  });
  if (!building) { const err = new Error('Building configuration not found'); err.status = 400; throw err; }

  const periods = getPeriodStrings(endDate);

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

  const unitsNow = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prevMax.value, currMax.value);

  let unitsPrev = null;
  let roc = null;
  if (prePrevMax && prevMax) {
    unitsPrev = computeUnitsOnly(meter.meter_type, meter.meter_mult, building, prePrevMax.value, prevMax.value);
    if (unitsPrev > 0) {
      roc = Math.ceil(((unitsNow - unitsPrev) / unitsPrev) * 100);
    }
  }

  const display = getDisplayRollingPeriods(endDate);

  return {
    meter_id: meter.meter_id,
    stall_id: stall.stall_id,
    tenant_id: stall.tenant_id || null,
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

/* ============ Indirect building resolver for record checks ============ */
async function getBuildingIdForRequest(req) {
  const meterId = req.params?.meter_id || req.params?.id || req.body?.meter_id;
  if (!meterId) return null;
  const meter = await Meter.findOne({ where: { meter_id: meterId }, attributes: ['stall_id'], raw: true });
  if (!meter) return null;
  const stall = await Stall.findOne({ where: { stall_id: meter.stall_id }, attributes: ['building_id'], raw: true });
  return stall?.building_id || null;
}

module.exports = {
  // helpers
  sendErr,
  isYMD,
  getPeriodStrings,
  getDisplayRollingPeriods,
  // core compute
  computeROCForMeter,
  // record-building resolver
  getBuildingIdForRequest,
  // expose if you want to unit test them individually
  __testing: { round, ymd, getMaxReadingInPeriod }
};
