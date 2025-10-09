const { Op } = require('sequelize');

// Models
const Reading  = require('../models/Reading');
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
// const Rate     = require('../models/Rate');       // e_vat, w_vat, wnet_vat only
const Building = require('../models/Building');   // erate_perKwH, emin_con, wrate_perCbM, wmin_con, lrate_perKg

// ------------------------------------------------------
// Config
// ------------------------------------------------------
const BOUNDARY_MODE = 'include_zero_edge'; // or 'exclude_zero_edge'

// ------------------------------------------------------
// Pure helpers (no DB)
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

// ------------------------------------------------------
// DB helpers
// ------------------------------------------------------
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
      prev = d;
    } else {
      runs.push({ start: runStart, end: prev }); // end == last zero day
      runStart = d;
      prev = d;
    }
  }
  runs.push({ start: runStart, end: prev });
  return runs;
}

// ------------------------------------------------------
// Charge engine (Building base rates + Rate VAT/net)
// ------------------------------------------------------
function computeChargesByType(mtype, mult, building, rate, prevIdx, currIdx) {
  let consumption, base, vat, total;

  if (mtype === 'lpg') {
    const lrate = Number(building.lrate_perKg) || 0;
    consumption = Number(currIdx) || 0; // LPG: reading is qty (kg)
    base  = consumption * lrate;
    vat   = 0;
    total = base + vat;
  } else if (mtype === 'electric') {
    const emin  = Number(building.emin_con) || 0;
    const erate = Number(building.erate_perKwH) || 0;
    const eVat  = Number(rate.e_vat) || 0;

    consumption = (Number(currIdx) - Number(prevIdx)) * Number(mult || 1);
    if (consumption <= 0) consumption = emin; // min per segment
    base  = consumption * erate;
    vat   = base * eVat;
    total = base + vat;
  } else if (mtype === 'water') {
    const wmin  = Number(building.wmin_con) || 0;
    const wrate = Number(building.wrate_perCbM) || 0;
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
// Public API
// ------------------------------------------------------
async function computeBillingForMeter({ meterId, endDate, user }) {
  // 1) Meter → Stall
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    attributes: ['meter_id', 'meter_type', 'meter_mult', 'stall_id'],
    raw: true
  });
  if (!meter) {
    const err = new Error('Meter not found');
    err.status = 404;
    throw err;
  }

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['building_id', 'tenant_id'],
    raw: true
  });
  if (!stall) {
    const err = new Error('Stall not found for this meter');
    err.status = 404;
    throw err;
  }

  // 2) Building scope for non-admins
  const lvl = (user?.user_level || '').toLowerCase();
  if (lvl !== 'admin') {
    const userBldg = user?.building_id;
    if (!userBldg) {
      const err = new Error('Unauthorized: No building assigned');
      err.status = 401;
      throw err;
    }
    if (stall.building_id !== userBldg) {
      const err = new Error('No access: Meter not under your assigned building');
      err.status = 403;
      throw err;
    }
  }

  // 3) Rate + Building
  if (!stall.tenant_id) {
    const err = new Error('Stall has no tenant; no rate available.');
    err.status = 400;
    throw err;
  }
  const rate = await Rate.findOne({ where: { tenant_id: stall.tenant_id }, raw: true });
  if (!rate) {
    const err = new Error('No utility rate configured for this tenant.');
    err.status = 400;
    throw err;
  }

  const building = await Building.findOne({
    where: { building_id: stall.building_id },
    attributes: ['building_id','erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg'],
    raw: true
  });
  if (!building) {
    const err = new Error('Building configuration not found.');
    err.status = 400;
    throw err;
  }

  // 4) Periods
  const { start: currStart, end: currEnd } = getCurrentPeriodFromEnd(endDate);
  const { prevStart, prevEnd }             = getPreviousPeriodFromCurrent(currStart);

  // 5) Max indices within periods
  const currMax = await getMaxReadingInPeriod(meterId, currStart, currEnd);
  const prevMax = await getMaxReadingInPeriod(meterId, prevStart, prevEnd);
  if (!currMax) {
    const err = new Error(`No readings for ${currStart}..${currEnd}`);
    err.status = 400;
    throw err;
  }
  if (!prevMax) {
    const err = new Error(`No readings for ${prevStart}..${prevEnd}`);
    err.status = 400;
    throw err;
  }

  const mtype = String(meter.meter_type || '').toLowerCase();
  const mult  = Number(meter.meter_mult) || 1;

  // 6) Downtime (zeros) in CURRENT period
  const zeroRuns = await getZeroRuns(meterId, currStart, currEnd);

  // 7) Build split segments for CURRENT
  const segments = [];
  let anchorIdx = Number(prevMax.value);
  let pointer   = currStart;

  for (const run of zeroRuns) {
    // Billable BEFORE downtime
    const preEnd = (BOUNDARY_MODE === 'include_zero_edge') ? run.start : dayBefore(run.start);
    if (pointer <= preEnd) {
      const segMax = await getMaxReadingInPeriod(meterId, pointer, preEnd);
      if (segMax) {
        const charges = computeChargesByType(mtype, mult, building, rate, anchorIdx, segMax.value);
        segments.push({
          type: 'billable',
          start: pointer,
          end: preEnd,
          prev_index: round(anchorIdx, 2),
          curr_index: round(Number(segMax.value) || 0, 2),
          ...charges
        });
        anchorIdx = Number(segMax.value);
      }
    }

    // Downtime segment
    segments.push({ type: 'downtime', start: run.start, end: run.end, reason: 'zero readings' });

    // Next billable start
    pointer = (BOUNDARY_MODE === 'include_zero_edge') ? run.end : dayAfter(run.end);
  }

  // Trailing billable (after last downtime)
  if (pointer <= currEnd) {
    const segMax = await getMaxReadingInPeriod(meterId, pointer, currEnd);
    if (segMax) {
      const charges = computeChargesByType(mtype, mult, building, rate, anchorIdx, segMax.value);
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

  // Shape periods + totals
  const periods = segments.map(s => ({
    type: s.type,
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

  const totals = periods.reduce((acc, p) => {
    if (p.type !== 'billable') return acc;
    acc.consumption += Number(p.bill.consumption) || 0;
    acc.base        += Number(p.bill.base) || 0;
    acc.vat         += Number(p.bill.vat) || 0;
    acc.total       += Number(p.bill.total) || 0;
    return acc;
  }, { consumption: 0, base: 0, vat: 0, total: 0 });

  // Previous period rollup (for rate-of-change on consumption)
  const { prevStart: prePrevStart, prevEnd: prePrevEnd } = getPreviousPeriodFromCurrent(prevStart);
  const prePrevMax = await getMaxReadingInPeriod(meterId, prePrevStart, prePrevEnd);

  let previousConsumption = null;
  if (prePrevMax && prevMax) {
    const zeroRunsPrev = await getZeroRuns(meterId, prevStart, prevEnd);
    const prevSegments = [];
    let anchorPrevIdx = Number(prePrevMax.value);
    let prevPtr       = prevStart;

    for (const run of zeroRunsPrev) {
      const preEnd2 = (BOUNDARY_MODE === 'include_zero_edge') ? run.start : dayBefore(run.start);
      if (prevPtr <= preEnd2) {
        const segMax = await getMaxReadingInPeriod(meterId, prevPtr, preEnd2);
        if (segMax) {
          const ch = computeChargesByType(mtype, mult, building, rate, anchorPrevIdx, segMax.value);
          prevSegments.push({ type: 'billable', ...ch });
          anchorPrevIdx = Number(segMax.value);
        }
      }
      prevPtr = (BOUNDARY_MODE === 'include_zero_edge') ? run.end : dayAfter(run.end);
    }

    if (prevPtr <= prevEnd) {
      const segMax = await getMaxReadingInPeriod(meterId, prevPtr, prevEnd);
      if (segMax) {
        const ch = computeChargesByType(mtype, mult, building, rate, anchorPrevIdx, segMax.value);
        prevSegments.push({ type: 'billable', ...ch });
        anchorPrevIdx = Number(segMax.value);
      }
    }

    const prevTotals = prevSegments.reduce((acc, s) => {
      acc.consumption += Number(s.consumption) || 0;
      acc.base        += Number(s.base) || 0;
      acc.vat         += Number(s.vat) || 0;
      acc.total       += Number(s.total) || 0;
      return acc;
    }, { consumption: 0, base: 0, vat: 0, total: 0 });

    previousConsumption = round(prevTotals.consumption, 2);
  }

  const currentConsumption = round(totals.consumption, 2);
  let rateOfChange = null;
  if ((previousConsumption || 0) > 0) {
    rateOfChange = Math.ceil(((currentConsumption - previousConsumption) / previousConsumption) * 100);
  }

  return {
    meter_id: meterId,
    meter_type: mtype,
    building_id: stall.building_id,
    periods,
    totals,
    current_consumption: currentConsumption,
    previous_consumption: previousConsumption,
    rate_of_change: rateOfChange
  };
}

async function computeBillingForTenant({ tenantId, endDate, user }) {
  // Find stalls for tenant (apply building scope for non-admins)
  const stalls = await Stall.findAll({
    where: { tenant_id: tenantId },
    attributes: ['stall_id', 'building_id'],
    raw: true
  });
  if (!stalls.length) {
    const err = new Error('No stalls found for this tenant.');
    err.status = 404;
    throw err;
  }

  const lvl = (user?.user_level || '').toLowerCase();
  let scopedStalls = stalls;
  if (lvl !== 'admin') {
    const userBldg = user?.building_id;
    if (!userBldg) {
      const err = new Error('Unauthorized: No building assigned');
      err.status = 401;
      throw err;
    }
    scopedStalls = stalls.filter(s => s.building_id === userBldg);
    if (!scopedStalls.length) {
      const err = new Error('No access: Tenant has no stalls in your building');
      err.status = 403;
      throw err;
    }
  }

  const stallIds = scopedStalls.map(s => s.stall_id);
  const meters = await Meter.findAll({
    where: { stall_id: { [Op.in]: stallIds } },
    attributes: ['meter_id'],
    raw: true
  });
  if (!meters.length) {
    const err = new Error('No meters found for this tenant (in your scope).');
    err.status = 404;
    throw err;
  }

  const results = [];
  for (const m of meters) {
    try {
      const r = await computeBillingForMeter({ meterId: m.meter_id, endDate, user });
      results.push(r);
    } catch (innerErr) {
      results.push({ meter_id: m.meter_id, error: innerErr.message || 'Failed to compute billing for this meter' });
    }
  }

  // Rollups by meter type + grand currency totals
  const totalsByType = {};
  let grand = { base: 0, vat: 0, total: 0 };

  for (const r of results) {
    if (r.error) continue;
    const t = r.meter_type;
    if (!totalsByType[t]) {
      totalsByType[t] = { consumption: 0, base: 0, vat: 0, total: 0 };
    }
    totalsByType[t].consumption += Number(r.totals.consumption) || 0;
    totalsByType[t].base        += Number(r.totals.base) || 0;
    totalsByType[t].vat         += Number(r.totals.vat) || 0;
    totalsByType[t].total       += Number(r.totals.total) || 0;

    grand.base  += Number(r.totals.base) || 0;
    grand.vat   += Number(r.totals.vat) || 0;
    grand.total += Number(r.totals.total) || 0;
  }

  Object.keys(totalsByType).forEach(k => {
    totalsByType[k].consumption = round(totalsByType[k].consumption, 2);
    totalsByType[k].base        = round(totalsByType[k].base, 2);
    totalsByType[k].vat         = round(totalsByType[k].vat, 2);
    totalsByType[k].total       = round(totalsByType[k].total, 2);
  });
  grand.base  = round(grand.base, 2);
  grand.vat   = round(grand.vat, 2);
  grand.total = round(grand.total, 2);

  return { meters: results, totals_by_type: totalsByType, grand_totals: grand };
}

module.exports = {
  // main entry points
  computeBillingForMeter,
  computeBillingForTenant,

  // exported helpers (useful for tests)
  getCurrentPeriodFromEnd,
  getPreviousPeriodFromCurrent,
  getMaxReadingInPeriod,
  getZeroRuns,
  computeChargesByType,
  round,
};
