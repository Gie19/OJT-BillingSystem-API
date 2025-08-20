const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const {
  authorizeBuildingParam,
  attachBuildingScope,
  enforceRecordBuilding
} = require('../middleware/authorizeBuilding');

const { Op, literal } = require('sequelize');

const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Reading = require('../models/Reading');

// All routes require a valid token
router.use(authenticateToken);

/**
 * GET /meters
 * - admin: all
 * - operator: only meters in their building (via Stall.building_id)
 */
router.get('/',
  authorizeRole('admin', 'operator'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      // If admin, no building filter
      if (!req.restrictToBuildingId) {
        const meters = await Meter.findAll();
        return res.json(meters);
      }

      // For operators, restrict via stall->building
      const stallRows = await Stall.findAll({
        where: { building_id: req.restrictToBuildingId },
        attributes: ['stall_id'],
        raw: true
      });
      const stallIds = stallRows.map(s => s.stall_id);
      if (stallIds.length === 0) return res.json([]);

      const meters = await Meter.findAll({ where: { stall_id: stallIds } });
      return res.json(meters);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /meters/:id
 * - admin: full access
 * - operator: only if the meter’s stall belongs to their building
 */
router.get('/:id',
  authorizeRole('admin', 'operator'),
  enforceRecordBuilding(async (req) => {
    const meter = await Meter.findOne({
      where: { meter_id: req.params.id },
      attributes: ['stall_id'],
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

/**
 * POST /meters
 * - admin: any building
 * - operator: only inside their building (checks stall.building_id)
 */
router.post('/',
  authorizeRole('admin', 'operator'),
  authorizeBuildingParam(), // if body.building_id is sent, ensures it matches operator’s building (admin bypass)
  async (req, res) => {
    const { meter_type, meter_sn, meter_mult, stall_id, meter_status } = req.body;

    if (!meter_type || !meter_sn || !stall_id || !meter_status) {
      return res.status(400).json({ error: 'meter_type, meter_sn, stall_id, and meter_status are required' });
    }

    try {
      // unique meter_sn
      const dup = await Meter.findOne({ where: { meter_sn } });
      if (dup) return res.status(409).json({ error: 'meter_sn already exists' });

      // stall must exist (and be in user’s building if operator)
      const stall = await Stall.findOne({ where: { stall_id }, attributes: ['building_id'], raw: true });
      if (!stall) return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });

      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
      if (!isAdmin && stall.building_id !== req.user.building_id) {
        return res.status(403).json({ error: 'No access: Stall not under your assigned building.' });
      }

      // Generate new meter_id (MTR-<n>)
      const lastMeter = await Meter.findOne({
        where: { meter_id: { [Op.like]: 'MTR-%' } },
        order: [[literal("CAST(SUBSTRING(meter_id, 5) AS UNSIGNED)"), "DESC"]],
      });
      let nextNumber = 1;
      if (lastMeter) {
        const num = parseInt(lastMeter.meter_id.slice(4), 10);
        if (!isNaN(num)) nextNumber = num + 1;
      }
      const newMeterId = `MTR-${nextNumber}`;

      // Default multiplier if not provided
      let finalMult = meter_mult;
      if (finalMult === undefined || finalMult === null || finalMult === '') {
        finalMult = (String(meter_type).toLowerCase() === 'water') ? 93.00 : 1;
      }

      await Meter.create({
        meter_id: newMeterId,
        meter_type,
        meter_sn,
        meter_mult: finalMult,
        stall_id,
        meter_status,
        last_updated: getCurrentDateTime(),
        updated_by: req.user.user_fullname
      });

      res.status(201).json({ message: 'Meter created successfully', meterId: newMeterId });
    } catch (err) {
      console.error('Error in POST /meters:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PUT /meters/:id
 * - admin: unrestricted
 * - operator: only if meter is under their building; if moving to a new stall, that stall must also be under their building
 */
router.put('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const meterId = req.params.id;
    const { meter_type, meter_sn, stall_id, meter_status, meter_mult } = req.body;

    try {
      const meter = await Meter.findOne({ where: { meter_id: meterId } });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';

      // operator building scope on existing meter
      if (!isAdmin) {
        const currStall = await Stall.findOne({
          where: { stall_id: meter.stall_id },
          attributes: ['building_id'],
          raw: true
        });
        if (!currStall || currStall.building_id !== req.user.building_id) {
          return res.status(403).json({ error: 'No access: Meter not under your assigned building.' });
        }
      }

      // if changing stall, validate target stall + scope
      if (stall_id && stall_id !== meter.stall_id) {
        const target = await Stall.findOne({ where: { stall_id }, attributes: ['building_id'], raw: true });
        if (!target) return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
        if (!isAdmin && target.building_id !== req.user.building_id) {
          return res.status(403).json({ error: 'No access: Target stall not under your building.' });
        }
      }

      // unique meter_sn if changed
      if (meter_sn && meter_sn !== meter.meter_sn) {
        const exists = await Meter.findOne({
          where: { meter_sn, meter_id: { [Op.ne]: meterId } }
        });
        if (exists) return res.status(409).json({ error: 'meter_sn already exists' });
      }

      // derive final multiplier
      let finalMult = (meter_mult !== undefined) ? meter_mult : meter.meter_mult;
      if (meter_type && meter_type !== meter.meter_type && meter_mult === undefined) {
        finalMult = (String(meter_type).toLowerCase() === 'water') ? 93.00 : 1;
      }

      await meter.update({
        meter_type: meter_type ?? meter.meter_type,
        meter_sn: meter_sn ?? meter.meter_sn,
        stall_id: stall_id ?? meter.stall_id,
        meter_status: meter_status ?? meter.meter_status,
        meter_mult: finalMult,
        last_updated: getCurrentDateTime(),
        updated_by: req.user.user_fullname
      });

      res.json({ message: `Meter with ID ${meterId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /meters/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE /meters/:id
 * - admin: unrestricted
 * - operator: only if meter is under their building
 * - blocks delete if readings exist
 */
router.delete('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const meterId = req.params.id;
    if (!meterId) return res.status(400).json({ error: 'Meter ID is required' });

    try {
      // operator scope check
      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
      if (!isAdmin) {
        const meter = await Meter.findOne({ where: { meter_id: meterId }, attributes: ['stall_id'], raw: true });
        if (!meter) return res.status(404).json({ error: 'Meter not found' });
        const stall = await Stall.findOne({ where: { stall_id: meter.stall_id }, attributes: ['building_id'], raw: true });
        if (!stall || stall.building_id !== req.user.building_id) {
          return res.status(403).json({ error: 'No access: Meter not under your assigned building.' });
        }
      }

      // dependency check: readings
      const readings = await Reading.findAll({ where: { meter_id: meterId }, attributes: ['reading_id'] });
      if (readings.length) {
        return res.status(400).json({
          error: `Cannot delete meter. It is still referenced by: Reading(s) [${readings.map(r => r.reading_id).join(', ')}]`
        });
      }

      const deleted = await Meter.destroy({ where: { meter_id: meterId } });
      if (deleted === 0) return res.status(404).json({ error: 'Meter not found' });

      res.json({ message: `Meter with ID ${meterId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /meters/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
