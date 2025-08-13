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

// GET latest consumption & change_rate for a meter
router.get('/:id/computation', authorizeRole('admin', 'employee'), async (req, res) => {
  try {
    const meterId = req.params.id;

    // 1) Ensure meter exists
    const meter = await Meter.findOne({ where: { meter_id: meterId } });
    if (!meter) return res.status(404).json({ error: 'Meter not found' });

    // 2) If employee, enforce building scope via Stall -> building_id
    if ((req.user?.user_level || '').toLowerCase() !== 'admin') {
      const stall = await Stall.findOne({ where: { stall_id: meter.stall_id }, attributes: ['building_id'], raw: true });
      if (!stall || stall.building_id !== req.user?.building_id) {
        return res.status(403).json({ error: 'No access: This meter is not under your assigned building.' });
      }
    }

    // 3) Get last up-to-3 readings (most recent first)
    const rows = await Reading.findAll({
      where: { meter_id: meterId },
      order: [['lastread_date', 'DESC'], ['reading_id', 'DESC']],
      limit: 3
    });

    if (rows.length < 2) {
      return res.json({ meter_id: meterId, note: 'Not enough data for consumption.' });
    }

    // 4) Compute using meter multiplier
    const mult = Number(meter.meter_mult) || 1.0;

    const v0 = Number(rows[0].reading_value) || 0;
    const v1 = Number(rows[1].reading_value) || 0;
    const v2 = rows[2] ? (Number(rows[2].reading_value) || 0) : null;

    const deltaLatest = v0 - v1;
    const deltaPrev   = v2 !== null ? (v1 - v2) : null;

    const consumption_latest = deltaLatest * mult;
const consumption_prev   = deltaPrev !== null ? (deltaPrev * mult) : null;

const change_rate = consumption_prev !== 0 && consumption_prev !== null
  ? ((consumption_latest - consumption_prev) / consumption_prev) * 100
  : null;

// rounding
const round = (num, dec) => num !== null ? Number(num.toFixed(dec)) : null;

res.json({
  meter_id: meterId,
  consumption_latest: round(consumption_latest, 2),
  consumption_prev: round(consumption_prev, 2),
  change_rate: round(change_rate, 1)
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
