// routes/meters.js
const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam, attachBuildingScope, enforceRecordBuilding } = require('../middleware/authorizeBuilding');

const { Op, literal } = require('sequelize');

// Imported models
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Reading = require('../models/Reading');
const Building = require('../models/Building');
const Rate = require('../models/Rate');

// All routes below require valid token
router.use(authenticateToken);

/**
 * GET ALL METERS
 * - Admins: return all meters
 * - Employees: only meters in their assigned building (via Stall.building_id)
 */
router.get('/',
  authorizeRole('admin', 'employee'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      if (!req.restrictToBuildingId) {
        const meters = await Meter.findAll();
        return res.json(meters);
      }

      const stallRows = await Stall.findAll({
        where: { building_id: req.restrictToBuildingId },
        attributes: ['stall_id'],
        raw: true
      });

      const stallIds = stallRows.map(s => s.stall_id);
      if (stallIds.length === 0) {
        return res.status(403).json({
          error: 'No access: There are no meters under your assigned building.'
        });
      }

      const meters = await Meter.findAll({
        where: { stall_id: stallIds }
      });

      if (meters.length === 0) {
        return res.status(403).json({
          error: 'No access: All meters found belong to another building.'
        });
      }

      res.json(meters);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);


/**
 * GET METER BY ID
 * - Admins: full access
 * - Employees: only if the meter’s stall is in their building
 */
router.get('/:id',
  authorizeRole('admin', 'employee'),
  enforceRecordBuilding(async (req) => {
    const meter = await Meter.findOne({
      where: { meter_id: req.params.id },
      attributes: ['meter_id', 'stall_id'],
      raw: true
    });
    if (!meter) return null;

    const stall = await Stall.findOne({
      where: { stall_id: meter.stall_id },
      attributes: ['building_id'],
      raw: true
    });
    return stall?.building_id || null;
  }),
  async (req, res) => {
    try {
      const meter = await Meter.findOne({ where: { meter_id: req.params.id } });
      if (!meter) return res.status(404).json({ message: 'Meter not found' });
      res.json(meter);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// GET latest consumption, % change, and bill totals (electric, water, LPG)
router.get('/:id/computation', authorizeRole('admin', 'employee'), async (req, res) => {
  try {
    const meterId = req.params.id;

    // Utility
    const round = (num, dec) => (num === null || num === undefined)
      ? null
      : Number(Number(num).toFixed(dec));
    const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';

    // 1) Load meter
    const meter = await Meter.findOne({ where: { meter_id: meterId }, raw: true });
    if (!meter) return res.status(404).json({ error: 'Meter not found' });

    // 2) Building scope for employees (meter -> stall -> building)
    const stall = await Stall.findOne({
      where: { stall_id: meter.stall_id },
      attributes: ['building_id'],
      raw: true
    });
    if (!stall) return res.status(400).json({ error: 'Stall not found for meter' });

    if (!isAdmin) {
      const userBldg = req.user?.building_id;
      if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
      if (stall.building_id !== userBldg) {
        return res.status(403).json({ error: 'No access: This meter is not under your assigned building.' });
      }
    }

    // 3) Fetch last 3 readings (latest first)
    const rows = await Reading.findAll({
      where: { meter_id: meterId },
      order: [['lastread_date', 'DESC'], ['reading_id', 'DESC']],
      limit: 3,
      raw: true
    });

    if (rows.length < 2) {
      return res.json({ meter_id: meterId, note: 'Not enough data for consumption.' });
    }

    // 4) Compute consumptions with multiplier
    const mult = Number(meter.meter_mult) || 1.0;
    const v0 = Number(rows[0].reading_value) || 0;
    const v1 = Number(rows[1].reading_value) || 0;
    const v2 = rows[2] ? (Number(rows[2].reading_value) || 0) : null;

    const deltaLatest = v0 - v1;
    const deltaPrev   = v2 !== null ? (v1 - v2) : null;

    let consumption_latest = deltaLatest * mult;
    let consumption_prev   = deltaPrev !== null ? (deltaPrev * mult) : null;

    // 5) Get building's utility rates
    const building = await Building.findOne({
      where: { building_id: stall.building_id },
      attributes: ['rate_id'],
      raw: true
    });
    if (!building?.rate_id) return res.status(400).json({ error: 'No rate_id configured for building' });

    const rate = await Rate.findOne({ where: { rate_id: building.rate_id }, raw: true });
    if (!rate) return res.status(400).json({ error: 'Utility rate not found for building' });

    // 6) Apply min consumption by meter type
    const mtype = (meter.meter_type || '').toLowerCase();
    if (mtype === 'electric') {
      const emin = Number(rate.emin_con) || 0;
      if (consumption_latest <= 0) consumption_latest = emin;
      if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = emin;
    } else if (mtype === 'water') {
      const wmin = Number(rate.wmin_con) || 0;
      if (consumption_latest <= 0) consumption_latest = wmin;
      if (consumption_prev !== null && consumption_prev <= 0) consumption_prev = wmin;
    }
    // (No min specified for LPG — leaving as-is)

    // 7) % change_rate (vs previous)
    const raw_change_rate = (consumption_prev !== null && consumption_prev !== 0)
      ? ((consumption_latest - consumption_prev) / consumption_prev) * 100
      : null;

    // 8) Billing
    let bill_latest_total = null;
    let bill_prev_total   = null;

    if (mtype === 'electric') {
      const erate = Number(rate.erate_perKwH) || 0;
      const eVat  = Number(rate.e_vat) || 0;

      const baseLatest = consumption_latest * erate;
      const vatLatest  = baseLatest * eVat;
      bill_latest_total = baseLatest + vatLatest;

      if (consumption_prev !== null) {
        const basePrev = consumption_prev * erate;
        const vatPrev  = basePrev * eVat;
        bill_prev_total = basePrev + vatPrev;
      }
    } else if (mtype === 'water') {
      const wrate = Number(rate.wrate_perCbM) || 0;
      const wnet  = Number(rate.wnet_vat) || 0;
      const wVat  = Number(rate.w_vat) || 0;

      const baseLatest = consumption_latest * wrate;
      const netLatest  = baseLatest / wnet;
      const vatCompLatest = netLatest * wVat;
      bill_latest_total = baseLatest + vatCompLatest;

      if (consumption_prev !== null) {
        const basePrev = consumption_prev * wrate;
        const netPrev  = basePrev * wnet;
        const vatCompPrev = netPrev * wVat;
        bill_prev_total = basePrev + vatCompPrev;
      }
    } else if (mtype === 'lpg') {
      const lrate = Number(rate.lrate_perKg) || 0;
      bill_latest_total = consumption_latest * lrate;
      if (consumption_prev !== null) {
        bill_prev_total = consumption_prev * lrate;
      }
    }

    // 9) Respond (rounded)
    return res.json({
      meter_id: meterId,
      meter_type: mtype,
      consumption_latest: round(consumption_latest, 2),
      consumption_prev:   round(consumption_prev, 2),
      change_rate:        round(raw_change_rate, 1),  // percentage
      bill_latest_total:  round(bill_latest_total, 2),
      bill_prev_total:    round(bill_prev_total, 2)
    });
  } catch (err) {
    console.error('Computation error:', err);
    res.status(500).json({ error: err.message });
  }
});


// CREATE NEW METER (admin only)
router.post('/',
  authorizeRole('admin'),
  authorizeBuildingParam(), // optional: if client provides building_id, ensure it matches (admins bypass anyway)
  async (req, res) => {
    const { meter_type, meter_sn, meter_mult, stall_id, meter_status } = req.body;

    if (!meter_type || !meter_sn || !stall_id || !meter_status) {
      return res.status(400).json({ error: 'meter_type, meter_sn, stall_id, and meter_status are required' });
    }

    try {
      // Check if stall_id exists
      const stall = await Stall.findOne({ where: { stall_id } });
      if (!stall) {
        return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
      }

      // Get next meter_id
      const lastMeter = await Meter.findOne({
        where: { meter_id: { [Op.like]: 'MTR-%' } },
        order: [[literal("CAST(SUBSTRING(meter_id, 5) AS UNSIGNED)"), "DESC"]],
      });

      let nextNumber = 1;
      if (lastMeter) {
        const lastNumber = parseInt(lastMeter.meter_id.slice(4), 10);
        if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
      }
      const newMeterId = `MTR-${nextNumber}`;

      // Determine default meter_mult if not provided
      let finalMult = meter_mult;
      if (finalMult === undefined || finalMult === null || finalMult === '') {
        finalMult = (meter_type.toLowerCase() === 'water') ? 93.00 : 1;
      }

      const today = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      await Meter.create({
        meter_id: newMeterId,
        meter_type,
        meter_sn,
        meter_mult: finalMult,
        stall_id,
        meter_status,
        last_updated: today,
        updated_by: updatedBy
      });

      res.status(201).json({ message: 'Meter created successfully', meterId: newMeterId });
    } catch (err) {
      console.error('Error in POST /meters:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// UPDATE METER BY ID (admin only)
router.put('/:id',
  authorizeRole('admin'),
  authorizeBuildingParam(), // optional: if a building_id is passed, keep consistent semantics
  async (req, res) => {
    const meterId = req.params.id;
    const { meter_type, meter_sn, stall_id, meter_status, meter_mult } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
      const meter = await Meter.findOne({ where: { meter_id: meterId } });
      if (!meter) {
        return res.status(404).json({ error: 'Meter not found' });
      }

      // Validate stall_id if changed
      if (stall_id && stall_id !== meter.stall_id) {
        const stall = await Stall.findOne({ where: { stall_id } });
        if (!stall) {
          return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
        }
      }

      // Determine final values
      let finalMult = meter_mult !== undefined ? meter_mult : meter.meter_mult;
      if (meter_type && meter_type !== meter.meter_type && meter_mult === undefined) {
        finalMult = (meter_type.toLowerCase() === 'water') ? 93.00 : 1;
      }

      await meter.update({
        meter_type: meter_type || meter.meter_type,
        meter_sn: meter_sn || meter.meter_sn,
        stall_id: stall_id || meter.stall_id,
        meter_status: meter_status || meter.meter_status,
        meter_mult: finalMult,
        last_updated: lastUpdated,
        updated_by: updatedBy
      });

      res.json({ message: `Meter with ID ${meterId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /meters/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE METER BY ID (admin only) with dependency check
router.delete('/:id',
  authorizeRole('admin'),
  async (req, res) => {
    const meterId = req.params.id;
    if (!meterId) {
      return res.status(400).json({ error: 'Meter ID is required' });
    }
    try {
      const readings = await Reading.findAll({ where: { meter_id: meterId }, attributes: ['reading_id'] });

      let errors = [];
      if (readings.length) errors.push(`Reading(s): [${readings.map(r => r.reading_id).join(', ')}]`);

      if (errors.length) {
        return res.status(400).json({
          error: `Cannot delete meter. It is still referenced by: ${errors.join('; ')}`
        });
      }

      const deleted = await Meter.destroy({ where: { meter_id: meterId } });
      if (deleted === 0) {
        return res.status(404).json({ error: 'Meter not found' });
      }
      res.json({ message: `Meter with ID ${meterId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /meters/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
