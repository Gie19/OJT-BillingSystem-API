const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Reading = require('../models/Reading');
const Rate = require('../models/Rate');

// All routes require a valid token
router.use(authenticateToken);

/**
 * GET /billings/meters/:id/computation
 * - admin: unrestricted
 * - operator/biller: only for meters in their building
 * - uses tenant-specific rate via stall.tenant_id
 */
router.get('/meters/:id/computation',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const meterId = req.params.id;
      const round = (num, dec) => (num === null || num === undefined) ? null : Number(Number(num).toFixed(dec));
      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';

      // 1) Load meter
      const meter = await Meter.findOne({ where: { meter_id: meterId }, raw: true });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      // 2) Resolve stall -> building + tenant
      const stall = await Stall.findOne({
        where: { stall_id: meter.stall_id },
        attributes: ['building_id', 'tenant_id'],
        raw: true
      });
      if (!stall) return res.status(400).json({ error: 'Stall not found for meter' });

      // 3) Building scope for operator/biller
      if (!isAdmin) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        if (stall.building_id !== userBldg) {
          return res.status(403).json({ error: 'No access: This meter is not under your assigned building.' });
        }
      }

      // 4) Readings (latest 3)
      const rows = await Reading.findAll({
        where: { meter_id: meterId },
        order: [['lastread_date', 'DESC'], ['reading_id', 'DESC']],
        limit: 3,
        raw: true
      });
      if (rows.length < 1) {
        return res.json({ meter_id: meterId, note: 'No readings found.' });
      }

      // 5) Tenant-specific rate
      if (!stall.tenant_id) {
        return res.status(400).json({ error: 'Stall has no tenant; no rate available.' });
      }
      const rate = await Rate.findOne({ where: { tenant_id: stall.tenant_id }, raw: true });
      if (!rate) return res.status(400).json({ error: 'No rate configured for this tenant.' });

      // 6) Prepare values
      const mtype = (meter.meter_type || '').toLowerCase();
      const mult  = Number(meter.meter_mult) || 1.0;

      const v0 = Number(rows[0].reading_value) || 0; // latest
      const v1 = rows[1] ? (Number(rows[1].reading_value) || 0) : null;
      const v2 = rows[2] ? (Number(rows[2].reading_value) || 0) : null;

      let consumption_latest = null, consumption_prev = null, change_rate = null;
      let base_latest = null, vat_latest = null, total_latest = null;
      let base_prev = null, vat_prev = null, total_prev = null;

      if (mtype === 'lpg') {
        // LPG: uses raw reading_value × lrate_perKg (no deltas)
        const lrate = Number(rate.lrate_perKg) || 0;
        consumption_latest = v0;
        consumption_prev   = v1;
        base_latest  = v0 * lrate;
        vat_latest   = 0;
        total_latest = base_latest + vat_latest;

        if (v1 !== null) {
          base_prev  = v1 * lrate;
          vat_prev   = 0;
          total_prev = base_prev + vat_prev;
        }

        change_rate = (v1 !== null && v1 !== 0) ? ((v0 - v1) / v1) * 100 : null;

      } else {
        // Electric/Water: delta × multiplier
        if (rows.length < 2) {
          return res.json({ meter_id: meterId, note: 'Not enough data for consumption.' });
        }
        const deltaLatest = v0 - v1;
        const deltaPrev   = v2 !== null ? (v1 - v2) : null;

        consumption_latest = deltaLatest * mult;
        consumption_prev   = (deltaPrev !== null) ? (deltaPrev * mult) : null;

        // Minimum consumption rules
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
          const wnet  = Number(rate.wnet_vat) || 1; // divisor
          const wVat  = Number(rate.w_vat) || 0;

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
        bill_prev_total:      round(total_prev, 2),
      });
    } catch (err) {
      console.error('Computation error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
