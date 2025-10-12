// utils/billingEngine.js
'use strict';

const { Op } = require('sequelize');

// Models
const Reading  = require('../models/Reading');   // DATEONLY lastread_date
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
const Tenant   = require('../models/Tenant');    // vat_code, wt_code, for_penalty
const VAT      = require('../models/VAT');       // e_vat, w_vat, l_vat (percent or fraction)
const WT       = require('../models/WT');        // e_wt, w_wt, l_wt (percent or fraction)
const Building = require('../models/Building');  // erate_perKwH, emin_con, wrate_perCbM, wmin_con, lrate_perKg

/* =========================
 * Small helpers (no DB)
 * ========================= */

function round(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return null;
  return Number(Number(n).toFixed(d));
}

// Percent normalizer: 1 -> 0.01, 12 -> 0.12, 0.12 -> 0.12
const normalizePct = (v) => {
  const n = Number(v) || 0;
  return n >= 1 ? n / 100 : n;
};

// LPG minimum is fixed (per your instruction)
const LPG_MIN_CON = 1;

// YYYY-MM-DD from a UTC Date
function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Build string windows (DATEONLY-safe) for current and previous months
function getCurrentPeriodFromEnd(endDateStr) {
  const end = new Date(endDateStr + 'T00:00:00Z');
  const startOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1));
  const endOfMonth = new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000);
  return { start: ymd(startOfMonth), end: ymd(endOfMonth) };
}

function getPreviousPeriodFromCurrent(currStartStr) {
  const s = new Date(currStartStr + 'T00:00:00Z'); // first day of current month
  const prevStart = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1));
  const prevEnd   = new Date(s.getTime() - 24 * 60 * 60 * 1000);
  return { prevStart: ymd(prevStart), prevEnd: ymd(prevEnd) };
}

/* =========================
 * DB helpers
 * ========================= */

// Latest reading (by date) in a DATEONLY window [start, end]
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

// Pull VAT/WT per tenant codes (returns FRACTIONS)
async function getTenantTaxKnobs(tenant) {
  const [vatRow, wtRow] = await Promise.all([
    tenant?.vat_code ? VAT.findOne({ where: { vat_code: tenant.vat_code }, raw: true }) : null,
    tenant?.wt_code  ? WT.findOne({ where: { wt_code:  tenant.wt_code  }, raw: true }) : null,
  ]);

  const vat = {
    e: normalizePct(vatRow?.e_vat || 0),
    w: normalizePct(vatRow?.w_vat || 0),
    l: normalizePct(vatRow?.l_vat || 0),
  };
  const wt = {
    e: normalizePct(wtRow?.e_wt || 0),
    w: normalizePct(wtRow?.w_wt || 0),
    l: normalizePct(wtRow?.l_wt || 0),
  };

  return { vat, wt };
}

/* =========================
 * Core math (Excel-style)
 * ========================= */

/**
 * Rule:
 *  - VAT = base × vat%
 *  - WT  = VAT × wt%           (withholding is a fraction of VAT)
 *  - Pen = for_penalty ? base × penalty% : 0
 *  - Total = base + VAT + Penalty − WT   (withholding is deducted)
 */
function applyTaxes({ base, vatRate, wtRate, forPenalty, penaltyRate }) {
  const b   = Number(base) || 0;

  const vat = b * (Number(vatRate) || 0);          // base × VAT%
  const wt  = vat * (Number(wtRate) || 0);         // VAT × WT%
  const pen = forPenalty ? b * (Number(penaltyRate) || 0) : 0;

  const total = b + vat + pen - wt;                // deduct withholding

  return { vat: round(vat), wt: round(wt), penalty: round(pen), total: round(total) };
}

// Unified for all utilities; LPG min is constant (1)
function computeChargesByType(mtype, mult, building, taxKnobs, prevIdx, currIdx, forPenalty, penaltyRate) {
  const t = String(mtype || '').toLowerCase();
  const k = Number(mult) || 1;
  const prev = Number(prevIdx) || 0;
  const curr = Number(currIdx) || 0;

  const raw = (curr - prev) * k;

  let min = 0, rate = 0, vatR = 0, wtR = 0;

  if (t === 'electric') {
    min  = Number(building.emin_con) || 0;
    rate = Number(building.erate_perKwH) || 0;
    vatR = taxKnobs.vat.e; wtR = taxKnobs.wt.e;
  } else if (t === 'water') {
    min  = Number(building.wmin_con) || 0;
    rate = Number(building.wrate_perCbM) || 0;
    vatR = taxKnobs.vat.w; wtR = taxKnobs.wt.w;
  } else if (t === 'lpg') {
    min  = LPG_MIN_CON; // fixed
    rate = Number(building.lrate_perKg) || 0;
    vatR = taxKnobs.vat.l; wtR = taxKnobs.wt.l;
  } else {
    throw new Error(`Unsupported meter type: ${t}`);
  }

  const consumption = raw > 0 ? raw : min;
  const base = consumption * rate;
  const taxes = applyTaxes({ base, vatRate: vatR, wtRate: wtR, forPenalty, penaltyRate });

  return {
    consumption: round(consumption),
    base: round(base),
    vat: taxes.vat,
    wt: taxes.wt,
    penalty: taxes.penalty,
    total: taxes.total,
  };
}

/* =========================
 * Public API — Billing
 * ========================= */

/**
 * Compute billing for a single meter for the month containing endDate.
 * @param {Object} params
 * @param {string} params.meterId
 * @param {string} params.endDate     YYYY-MM-DD
 * @param {Object} params.user        current user (for scope check)
 * @param {number} params.penaltyRatePct  Penalty % as PERCENT (e.g., 2 = 2%)
 */
async function computeBillingForMeter({ meterId, endDate, user, penaltyRatePct = 0 }) {
  // Meter → Stall
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    attributes: ['meter_id', 'meter_sn', 'meter_type', 'meter_mult', 'stall_id'],
    raw: true
  });
  if (!meter) { const e = new Error('Meter not found'); e.status = 404; throw e; }

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['stall_id', 'building_id', 'tenant_id'],
    raw: true
  });
  if (!stall) { const e = new Error('Stall not found for this meter'); e.status = 404; throw e; }

  // Scope check (non-admin must match building)
  const lvl = (user?.user_level || '').toLowerCase();
  if (lvl !== 'admin') {
    if (!user?.building_id) { const e = new Error('Unauthorized: No building assigned'); e.status = 401; throw e; }
    if (user.building_id !== stall.building_id) { const e = new Error('No access to this meter'); e.status = 403; throw e; }
  }

  // Building rates & mins
  const building = await Building.findOne({
    where: { building_id: stall.building_id },
    attributes: ['building_id','erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg'],
    raw: true
  });
  if (!building) { const e = new Error('Building configuration not found'); e.status = 400; throw e; }

  // Tenant tax knobs and penalty flag
  const tenant = await Tenant.findOne({
    where: { tenant_id: stall.tenant_id },
    attributes: ['tenant_id','tenant_name','vat_code','wt_code','for_penalty'],
    raw: true
  });
  if (!tenant) { const e = new Error('Tenant not found'); e.status = 400; throw e; }

  const taxKnobs   = await getTenantTaxKnobs(tenant);
  const forPenalty = !!tenant.for_penalty;
  const penaltyRate = forPenalty ? normalizePct(penaltyRatePct) : 0; // omit if false

  // Current & previous month windows (DATEONLY strings)
  const { start: currStart, end: currEnd } = getCurrentPeriodFromEnd(endDate);
  const { prevStart, prevEnd }             = getPreviousPeriodFromCurrent(currStart);

  // Pick last reading in each window (by date)
  const [currMax, prevMax] = await Promise.all([
    getMaxReadingInPeriod(meterId, currStart, currEnd),
    getMaxReadingInPeriod(meterId, prevStart, prevEnd),
  ]);

  if (!currMax) { const e = new Error(`No readings for ${currStart}..${currEnd}`); e.status = 400; throw e; }
  if (!prevMax) { const e = new Error(`No readings for ${prevStart}..${prevEnd}`); e.status = 400; throw e; }

  // Single-segment (Excel style): prev → curr
  const mtype = String(meter.meter_type || '').toLowerCase();
  const mult  = Number(meter.meter_mult) || 1;

  const bill = computeChargesByType(
    mtype, mult, building, taxKnobs, prevMax.value, currMax.value, forPenalty, penaltyRate
  );

  return {
    meter: {
      meter_id: meter.meter_id,
      meter_sn: meter.meter_sn,
      meter_type: mtype,
      meter_mult: mult,
    },
    stall: {
      stall_id: stall.stall_id,
      building_id: stall.building_id,
      tenant_id: stall.tenant_id,
    },
    tenant: {
      tenant_id: tenant.tenant_id,
      tenant_name: tenant.tenant_name,
      vat_code: tenant.vat_code || null,
      wt_code: tenant.wt_code || null,
      for_penalty: forPenalty,
    },
    period: {
      current: { start: currStart, end: currEnd },
      previous: { start: prevStart, end: prevEnd }
    },
    indices: {
      prev_index: round(prevMax.value, 2),
      curr_index: round(currMax.value, 2),
    },
    billing: bill,
    totals: {
      consumption: bill.consumption,
      base: bill.base,
      vat: bill.vat,
      wt: bill.wt,
      penalty: bill.penalty,
      total: bill.total,
    }
  };
}

/**
 * Compute billing for all meters under a tenant (scoped to user's building if not admin).
 * Returns per-meter results and aggregated totals_by_type and grand_totals.
 */
async function computeBillingForTenant({ tenantId, endDate, user, penaltyRatePct = 0 }) {
  // All stalls of tenant
  const stalls = await Stall.findAll({
    where: { tenant_id: tenantId },
    attributes: ['stall_id', 'building_id'],
    raw: true
  });
  if (!stalls.length) { const e = new Error('No stalls found for this tenant'); e.status = 404; throw e; }

  // Scope to building if not admin
  const lvl = (user?.user_level || '').toLowerCase();
  const scopedStalls = (lvl === 'admin') ? stalls : stalls.filter(s => s.building_id === user?.building_id);
  if (!scopedStalls.length) { const e = new Error('No accessible stalls in your building'); e.status = 403; throw e; }

  const stallIds = scopedStalls.map(s => s.stall_id);
  const meters = await Meter.findAll({
    where: { stall_id: { [Op.in]: stallIds } },
    attributes: ['meter_id'],
    raw: true
  });
  if (!meters.length) { const e = new Error('No meters for this tenant (in your scope)'); e.status = 404; throw e; }

  const results = [];
  for (const m of meters) {
    try {
      const r = await computeBillingForMeter({ meterId: m.meter_id, endDate, user, penaltyRatePct });
      results.push(r);
    } catch (innerErr) {
      results.push({ meter_id: m.meter_id, error: innerErr.message || 'Billing failed for this meter' });
    }
  }

  // Roll up money by type and grand
  const totals_by_type = {};
  let grand_totals = { base: 0, vat: 0, wt: 0, penalty: 0, total: 0 };

  for (const r of results) {
    if (r.error) continue;
    const t = r.meter.meter_type;
    const b = r.totals;

    if (!totals_by_type[t]) totals_by_type[t] = { base: 0, vat: 0, wt: 0, penalty: 0, total: 0 };

    totals_by_type[t].base    += b.base;
    totals_by_type[t].vat     += b.vat;
    totals_by_type[t].wt      += b.wt;
    totals_by_type[t].penalty += b.penalty;
    totals_by_type[t].total   += b.total;

    grand_totals.base    += b.base;
    grand_totals.vat     += b.vat;
    grand_totals.wt      += b.wt;
    grand_totals.penalty += b.penalty;
    grand_totals.total   += b.total;
  }

  Object.keys(totals_by_type).forEach(k => {
    totals_by_type[k].base    = round(totals_by_type[k].base);
    totals_by_type[k].vat     = round(totals_by_type[k].vat);
    totals_by_type[k].wt      = round(totals_by_type[k].wt);
    totals_by_type[k].penalty = round(totals_by_type[k].penalty);
    totals_by_type[k].total   = round(totals_by_type[k].total);
  });

  grand_totals.base    = round(grand_totals.base);
  grand_totals.vat     = round(grand_totals.vat);
  grand_totals.wt      = round(grand_totals.wt);
  grand_totals.penalty = round(grand_totals.penalty);
  grand_totals.total   = round(grand_totals.total);

  return { meters: results, totals_by_type, grand_totals };
}

/* =========================
 * Exports
 * ========================= */
module.exports = {
  // money
  computeBillingForMeter,
  computeBillingForTenant,

  // helpers (if you want to reuse elsewhere)
  round,
  normalizePct,
  getCurrentPeriodFromEnd,
  getPreviousPeriodFromCurrent,
  getMaxReadingInPeriod,
  getTenantTaxKnobs,
  computeChargesByType,
  applyTaxes,
};
