const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');

const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Reading = require('../models/Reading');
const Rate = require('../models/Rate');
const Tenant = require('../models/Tenant');

// All routes require a valid token
router.use(authenticateToken);

// Helpers
const round = (num, dec) => (num === null || num === undefined) ? null : Number(Number(num).toFixed(dec));
const isAdmin = (req) => (req.user?.user_level || '').toLowerCase() === 'admin';

async function getMeterBuildingAndTenant(meterId) {
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    // removed 'rollover_value' – column not present in DB
    attributes: ['stall_id', 'meter_type', 'meter_mult'],
    raw: true
  });
  if (!meter) return { meter: null, stall: null };

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['building_id', 'tenant_id'],
    raw: true
  });
  return { meter, stall };
}

// Kept for clarity; we pass rollover = null to disable it
function deltaWithRollover(curr, prev, rollover) {
  let d = curr - prev;
  const r = Number(rollover);
  if (d < 0 && Number.isFinite(r) && r > 0) {
    d = (r - prev) + curr;
  }
  return d;
}

// ---------- SINGLE METER PREVIEW ----------
router.get(
  '/meters/:meter_id',
  authorizeRole('admin', 'operator', 'biller'),
  authorizeUtilityRole({ roles: ['operator', 'biller'], anyOf: ['electric', 'water', 'lpg'], requireAll: false }),
  async (req, res) => {
    try {
      const meterId = req.params.meter_id;

      // 1) Load meter + stall (building/tenant)
      const { meter, stall } = await getMeterBuildingAndTenant(meterId);
      if (!meter) return res.status(404).json({ error: 'Meter not found' });
      if (!stall) return res.status(400).json({ error: 'Stall not found for meter' });

      // 2) Building scope (non-admin)
      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        if (stall.building_id !== userBldg) {
          return res.status(403).json({ error: 'No access: This meter is not under your assigned building.' });
        }
      }

      // 3) Load latest readings (up to 3)
      const rows = await Reading.findAll({
        where: { meter_id: meterId },
        order: [['lastread_date', 'DESC'], ['reading_id', 'DESC']],
        limit: 3,
        raw: true
      });
      if (rows.length < 1) {
        return res.json({ meter_id: meterId, note: 'No readings found.' });
      }

      // 4) Tenant-specific rate
      if (!stall.tenant_id) {
        return res.status(400).json({ error: 'Stall has no tenant; no rate available.' });
      }
      const rate = await Rate.findOne({ where: { tenant_id: stall.tenant_id }, raw: true });
      if (!rate) return res.status(400).json({ error: 'No rate configured for this tenant.' });

      // 5) Compute
      const mtype = String(meter.meter_type || '').toLowerCase();
      const mult  = Number(meter.meter_mult) || 1.0;
      const rollover = null; // disabled

      const v0 = Number(rows[0].reading_value) || 0; // latest
      const v1 = rows[1] ? (Number(rows[1].reading_value) || 0) : null;
      const v2 = rows[2] ? (Number(rows[2].reading_value) || 0) : null;

      let consumption_latest = null, consumption_prev = null, change_rate = null;
      let base_latest = null, vat_latest = null, total_latest = null;
      let base_prev = null, vat_prev = null, total_prev = null;

      if (mtype === 'lpg') {
        const lrate = Number(rate.lrate_perKg) || 0;
        consumption_latest = v0;
        consumption_prev   = v1;

        base_latest  = consumption_latest * lrate;
        vat_latest   = 0;
        total_latest = base_latest + vat_latest;

        if (v1 !== null) {
          base_prev  = consumption_prev * lrate;
          vat_prev   = 0;
          total_prev = base_prev + vat_prev;
        }

        change_rate = (v1 !== null && v1 !== 0) ? ((v0 - v1) / v1) * 100 : null;

      } else {
        if (rows.length < 2) {
          return res.json({ meter_id: meterId, note: 'Not enough data for consumption.' });
        }

        const dLatest = deltaWithRollover(v0, v1, rollover);
        const dPrev   = v2 !== null ? deltaWithRollover(v1, v2, rollover) : null;

        consumption_latest = dLatest * mult;
        consumption_prev   = (dPrev !== null) ? (dPrev * mult) : null;

        if (mtype === 'electric') {
          const emin = Number(rate.emin_con) || 0;
          if (consumption_latest <= 0) consumption_latest = emin;
          if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = emin;
        } else if (mtype === 'water') {
          const wmin = Number(rate.wmin_con) || 0;
          if (consumption_latest <= 0) consumption_latest = wmin;
          if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = wmin;
        }

        change_rate = (consumption_prev !== null && consumption_prev !== 0)
          ? ((consumption_latest - consumption_prev) / consumption_prev) * 100
          : null;

        if (mtype === 'electric') {
          const erate = Number(rate.erate_perKwH) || 0;
          const eVat  = Number(rate.e_vat) || 0;

          base_latest  = consumption_latest * erate;
          vat_latest   = base_latest * eVat;
          total_latest = base_latest + vat_latest;

          if (consumption_prev !== null) {
            base_prev  = consumption_prev * erate;
            vat_prev   = base_prev * eVat;
            total_prev = base_prev + vat_prev;
          }
        } else if (mtype === 'water') {
          const wrate = Number(rate.wrate_perCbM) || 0;
          const wnet  = Number(rate.wnet_vat);      // divisor (must be > 0)
          const wVat  = Number(rate.w_vat) || 0;

          if (!Number.isFinite(wnet) || wnet <= 0) {
            return res.status(400).json({ error: 'Invalid water settings: wnet_vat must be > 0' });
          }

          base_latest  = (consumption_latest * wrate) / wnet;
          vat_latest   = base_latest * wVat;
          total_latest = base_latest + vat_latest;

          if (consumption_prev !== null) {
            base_prev  = (consumption_prev * wrate) / wnet;
            vat_prev   = base_prev * wVat;
            total_prev = base_prev + vat_prev;
          }
        }
      }

      return res.json({
        meter_id: meterId,
        meter_type: mtype,
        tenant_id: stall.tenant_id,
        rate_id: rate.rate_id,

        latest_reading_value: round(v0, 2),
        prev_reading_value:   round(v1, 2),

        consumption_latest:   round(consumption_latest, 2),
        consumption_prev:     round(consumption_prev, 2),
        change_rate:          round(change_rate, 1),

        base_latest:          round(base_latest, 2),
        vat_latest:           round(vat_latest, 2),
        bill_latest_total:    round(total_latest, 2),

        base_prev:            round(base_prev, 2),
        vat_prev:             round(vat_prev, 2),
        bill_prev_total:      round(total_prev, 2)
      });
    } catch (err) {
      console.error('Computation error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ---------- TENANT AGGREGATE PREVIEW ----------
router.get(
  '/tenants/:tenant_id/',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const tenantId = req.params.tenant_id;

      // Load tenant and enforce building scope (non-admin)
      const tenant = await Tenant.findOne({
        where: { tenant_id: tenantId },
        attributes: ['tenant_id', 'building_id', 'tenant_name'],
        raw: true
      });
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        if (tenant.building_id !== userBldg) {
          return res.status(403).json({ error: 'No access: Tenant not under your assigned building.' });
        }
      }

      // Tenant-specific rate
      const rate = await Rate.findOne({ where: { tenant_id: tenantId }, raw: true });
      if (!rate) {
        return res.status(400).json({ error: 'No rate configured for this tenant.' });
      }

      // Find stalls for this tenant
      const stalls = await Stall.findAll({
        where: { tenant_id: tenantId },
        attributes: ['stall_id'],
        raw: true
      });
      const stallIds = stalls.map(s => s.stall_id);
      if (stallIds.length === 0) {
        return res.json({
          tenant_id: tenant.tenant_id,
          tenant_name: tenant.tenant_name,
          building_id: tenant.building_id,
          rate_id: rate.rate_id,
          meters: [],
          totals: { base_latest: 0, vat_latest: 0, bill_latest_total: 0 }
        });
      }

      // Get all meters under those stalls (no rollover)
      const meters = await Meter.findAll({
        where: { stall_id: stallIds },
        attributes: ['meter_id', 'meter_type', 'meter_mult'],
        raw: true
      });
      if (meters.length === 0) {
        return res.json({
          tenant_id: tenant.tenant_id,
          tenant_name: tenant.tenant_name,
          building_id: tenant.building_id,
          rate_id: rate.rate_id,
          meters: [],
          totals: { base_latest: 0, vat_latest: 0, bill_latest_total: 0 }
        });
      }

      // For operators/billers, filter meters by utility_role
      let allowedMeters = meters;
      if (!isAdmin(req)) {
        const allowedUtils = Array.isArray(req.user.utility_role)
          ? req.user.utility_role.map(s => String(s).toLowerCase())
          : [];
        allowedMeters = meters.filter(m => allowedUtils.includes(String(m.meter_type).toLowerCase()));
      }

      // Compute per meter
      const results = [];
      for (const m of allowedMeters) {
        const rows = await Reading.findAll({
          where: { meter_id: m.meter_id },
          order: [['lastread_date', 'DESC'], ['reading_id', 'DESC']],
          limit: 3,
          raw: true
        });

        if (rows.length === 0) {
          results.push({
            meter_id: m.meter_id,
            meter_type: m.meter_type,
            note: 'No readings found.'
          });
          continue;
        }

        const mtype = String(m.meter_type || '').toLowerCase();
        const mult  = Number(m.meter_mult) || 1.0;
        const rollover = null; // disabled

        const v0 = Number(rows[0].reading_value) || 0;
        const v1 = rows[1] ? (Number(rows[1].reading_value) || 0) : null;
        const v2 = rows[2] ? (Number(rows[2].reading_value) || 0) : null;

        let consumption_latest = null, consumption_prev = null, change_rate = null;
        let base_latest = null, vat_latest = null, total_latest = null;
        let base_prev = null, vat_prev = null, total_prev = null;

        if (mtype === 'lpg') {
          const lrate = Number(rate.lrate_perKg) || 0;
          consumption_latest = v0;
          consumption_prev   = v1;

          base_latest  = consumption_latest * lrate;
          vat_latest   = 0;
          total_latest = base_latest + vat_latest;

          if (v1 !== null) {
            base_prev  = consumption_prev * lrate;
            vat_prev   = 0;
            total_prev = base_prev + vat_prev;
          }

          change_rate = (v1 !== null && v1 !== 0) ? ((v0 - v1) / v1) * 100 : null;

        } else {
          if (rows.length < 2) {
            results.push({
              meter_id: m.meter_id,
              meter_type: m.meter_type,
              note: 'Not enough data for consumption.'
            });
            continue;
          }

          const dLatest = deltaWithRollover(v0, v1, rollover);
          const dPrev   = v2 !== null ? deltaWithRollover(v1, v2, rollover) : null;

          consumption_latest = dLatest * mult;
          consumption_prev   = (dPrev !== null) ? (dPrev * mult) : null;

          if (mtype === 'electric') {
            const emin = Number(rate.emin_con) || 0;
            if (consumption_latest <= 0) consumption_latest = emin;
            if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = emin;
          } else if (mtype === 'water') {
            const wmin = Number(rate.wmin_con) || 0;
            if (consumption_latest <= 0) consumption_latest = wmin;
            if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = wmin;
          }

          change_rate = (consumption_prev !== null && consumption_prev !== 0)
            ? ((consumption_latest - consumption_prev) / consumption_prev) * 100
            : null;

          if (mtype === 'electric') {
            const erate = Number(rate.erate_perKwH) || 0;
            const eVat  = Number(rate.e_vat) || 0;

            base_latest  = consumption_latest * erate;
            vat_latest   = base_latest * eVat;
            total_latest = base_latest + vat_latest;

            if (consumption_prev !== null) {
              base_prev  = consumption_prev * erate;
              vat_prev   = base_prev * eVat;
              total_prev = base_prev + vat_prev;
            }
          } else if (mtype === 'water') {
            const wrate = Number(rate.wrate_perCbM) || 0;
            const wnet  = Number(rate.wnet_vat); // must be > 0
            const wVat  = Number(rate.w_vat) || 0;

            if (!Number.isFinite(wnet) || wnet <= 0) {
              results.push({
                meter_id: m.meter_id,
                meter_type: m.meter_type,
                error: 'Invalid water settings: wnet_vat must be > 0'
              });
              continue;
            }

            base_latest  = (consumption_latest * wrate) / wnet;
            vat_latest   = base_latest * wVat;
            total_latest = base_latest + vat_latest;

            if (consumption_prev !== null) {
              base_prev  = (consumption_prev * wrate) / wnet;
              vat_prev   = base_prev * wVat;
              total_prev = base_prev + vat_prev;
            }
          }
        }

        results.push({
          meter_id: m.meter_id,
          meter_type: m.meter_type,
          latest_reading_value: round(v0, 2),
          prev_reading_value:   round(v1, 2),

          consumption_latest:   round(consumption_latest, 2),
          consumption_prev:     round(consumption_prev, 2),
          change_rate:          round(change_rate, 1),

          base_latest:          round(base_latest, 2),
          vat_latest:           round(vat_latest, 2),
          bill_latest_total:    round(total_latest, 2),

          base_prev:            round(base_prev, 2),
          vat_prev:             round(vat_prev, 2),
          bill_prev_total:      round(total_prev, 2)
        });
      }

      // Totals
      const totals = results.reduce((acc, r) => {
        acc.base_latest       += Number(r.base_latest || 0);
        acc.vat_latest        += Number(r.vat_latest || 0);
        acc.bill_latest_total += Number(r.bill_latest_total || 0);
        return acc;
      }, { base_latest: 0, vat_latest: 0, bill_latest_total: 0 });

      return res.json({
        tenant_id: tenant.tenant_id,
        tenant_name: tenant.tenant_name,
        building_id: tenant.building_id,
        rate_id: rate.rate_id,
        meters: results,
        totals: {
          base_latest: round(totals.base_latest, 2),
          vat_latest: round(totals.vat_latest, 2),
          bill_latest_total: round(totals.bill_latest_total, 2)
        }
      });
    } catch (err) {
      console.error('Tenant computation error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
