const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const { Op, literal } = require('sequelize');

// Models
const Reading = require('../models/Reading');
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');

// All routes below require a valid token
router.use(authenticateToken);

// Helpers
function isAdmin(req) {
  return (req.user?.user_level || '').toLowerCase() === 'admin';
}

async function getMeterBuildingId(meterId) {
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
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
}

async function getReadingBuildingId(readingId) {
  const reading = await Reading.findOne({
    where: { reading_id: readingId },
    attributes: ['meter_id'],
    raw: true
  });
  if (!reading) return null;
  return getMeterBuildingId(reading.meter_id);
}

/**
 * GET ALL METER READINGS
 * - Admins: all readings
 * - Operators: readings for meters in stalls under their building
 * - Returns [] if none
 */
router.get('/',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    try {
      if (isAdmin(req)) {
        const readings = await Reading.findAll();
        return res.json(readings);
      }

      // Operator-scoped
      const buildingId = req.user?.building_id;
      if (!buildingId) {
        return res.status(401).json({ error: 'Unauthorized: No building assigned' });
      }

      const stalls = await Stall.findAll({
        where: { building_id: buildingId },
        attributes: ['stall_id'],
        raw: true
      });
      const stallIds = stalls.map(s => s.stall_id);
      if (stallIds.length === 0) return res.json([]);

      const meters = await Meter.findAll({
        where: { stall_id: stallIds },
        attributes: ['meter_id'],
        raw: true
      });
      const meterIds = meters.map(m => m.meter_id);
      if (meterIds.length === 0) return res.json([]);

      const readings = await Reading.findAll({
        where: { meter_id: meterIds }
      });

      return res.json(readings); // 200 with [] if none
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET METER READING BY ID
 * - Admins: full access
 * - Operators: only if the reading’s meter’s stall is in their building
 */
router.get('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    try {
      const readingId = req.params.id;

      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) return res.status(404).json({ message: 'Meter reading not found' });

      if (isAdmin(req)) {
        return res.json(reading);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) {
        return res.status(401).json({ error: 'Unauthorized: No building assigned' });
      }

      const recordBuildingId = await getReadingBuildingId(readingId);
      if (recordBuildingId && recordBuildingId !== buildingId) {
        return res.status(403).json({
          error: 'No access: This meter reading is not under your assigned building.'
        });
      }

      res.json(reading);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET readings for a specific date (YYYY-MM-DD)
 * - Admin: all meters; Operator: only their building
 */
router.get('/by-date/:date',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    try {
      if (isAdmin(req)) {
        const rows = await Reading.findAll({ where: { lastread_date: date } });
        return res.json(rows);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) return res.status(401).json({ error: 'Unauthorized: No building assigned' });

      const stalls = await Stall.findAll({ where: { building_id: buildingId }, attributes: ['stall_id'], raw: true });
      const stallIds = stalls.map(s => s.stall_id);
      if (!stallIds.length) return res.json([]);

      const meters = await Meter.findAll({ where: { stall_id: stallIds }, attributes: ['meter_id'], raw: true });
      const meterIds = meters.map(m => m.meter_id);
      if (!meterIds.length) return res.json([]);

      const rows = await Reading.findAll({
        where: { meter_id: meterIds, lastread_date: date }
      });
      return res.json(rows);
    } catch (err) {
      console.error('by-date error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET today's readings
 */
router.get('/today',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    req.params.date = today;
    return router.handle({ ...req, url: `/meter_reading/by-date/${today}`, method: 'GET' }, res);
  }
);

/**
 * CREATE NEW METER READING (daily)
 * - Admins and Operators
 * - Operator must create for meters under their own building (no utility filter)
 * - Enforce DAILY: only one reading per meter per lastread_date
 * - lastread_date/read_by are NOT NULL → always set
 * - lastread_date: manual input; defaults to today (YYYY-MM-DD) if omitted
 */
router.post('/',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const { meter_id, reading_value, lastread_date } = req.body;
    if (!meter_id || reading_value === undefined) {
      return res.status(400).json({ error: 'meter_id and reading_value are required' });
    }

    try {
      const meter = await Meter.findOne({ where: { meter_id } });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        const meterBldg = await getMeterBuildingId(meter_id);
        if (!meterBldg || meterBldg !== userBldg) {
          return res.status(403).json({ error: 'No access: You can only create readings for meters under your assigned building.' });
        }
      }

      // DAILY ENFORCEMENT
      const dateOnly = (lastread_date && /^\d{4}-\d{2}-\d{2}$/.test(lastread_date))
        ? lastread_date
        : new Date().toISOString().slice(0, 10);

      const existing = await Reading.findOne({
        where: { meter_id, lastread_date: dateOnly },
        attributes: ['reading_id'],
        raw: true
      });
      if (existing) {
        return res.status(409).json({ error: `Reading already exists for ${meter_id} on ${dateOnly}` });
      }

      // Generate new MR-<n>
      const lastReading = await Reading.findOne({
        where: { reading_id: { [Op.like]: 'MR-%' } },
        order: [[literal("CAST(SUBSTRING(reading_id, 4) AS UNSIGNED)"), "DESC"]],
      });
      let nextNumber = 1;
      if (lastReading) {
        const lastNumber = parseInt(lastReading.reading_id.slice(3), 10);
        if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
      }

      const newReadingId = `MR-${nextNumber}`;
      const now = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      await Reading.create({
        reading_id: newReadingId,
        meter_id,
        reading_value,
        lastread_date: dateOnly,               // DAILY
        read_by: updatedBy,                    // NOT NULL
        last_updated: now,
        updated_by: updatedBy
      });

      res.status(201).json({ message: 'Reading created successfully', readingId: newReadingId });
    } catch (err) {
      console.error('Error in POST /meter_reading:', err);
      // If DB unique index exists, ER_DUP_ENTRY will surface here too
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * UPDATE METER READING BY ID
 * - Admins: unrestricted
 * - Operators: can only update readings under their building
 * - DAILY: if lastread_date changes, enforce uniqueness per meter/day
 */
router.put('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const readingId = req.params.id;
    const { meter_id, reading_value, lastread_date } = req.body;
    const updatedBy = req.user.user_fullname;
    const now = getCurrentDateTime();

    try {
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) return res.status(404).json({ error: 'Reading not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });

        const currentBldg = await getReadingBuildingId(readingId);
        if (!currentBldg || currentBldg !== userBldg) {
          return res.status(403).json({ error: 'No access: You can only update readings under your assigned building.' });
        }

        if (meter_id && meter_id !== reading.meter_id) {
          const newMeterExists = await Meter.findOne({ where: { meter_id } });
          if (!newMeterExists) return res.status(400).json({ error: 'Invalid meter_id: Meter does not exist.' });
          const newMeterBldg = await getMeterBuildingId(meter_id);
          if (!newMeterBldg || newMeterBldg !== userBldg) {
            return res.status(403).json({ error: 'No access: The new meter is not under your assigned building.' });
          }
        }
      }

      if (!meter_id && reading_value === undefined && lastread_date === undefined) {
        return res.status(400).json({ message: 'No changes detected in the request body.' });
      }

      // DAILY ENFORCEMENT on date change
      if (lastread_date !== undefined) {
        const dateOnly = lastread_date
          ? (/^\d{4}-\d{2}-\d{2}$/.test(lastread_date) ? lastread_date : null)
          : new Date().toISOString().slice(0, 10);

        if (!dateOnly) {
          return res.status(400).json({ error: 'Invalid lastread_date format. Use YYYY-MM-DD.' });
        }

        const targetMeterId = meter_id || reading.meter_id;
        const clash = await Reading.findOne({
          where: {
            meter_id: targetMeterId,
            lastread_date: dateOnly,
            reading_id: { [Op.ne]: readingId }
          },
          attributes: ['reading_id'],
          raw: true
        });
        if (clash) {
          return res.status(409).json({ error: `Reading already exists for ${targetMeterId} on ${dateOnly}` });
        }

        reading.lastread_date = dateOnly; // keep NOT NULL
      }

      if (meter_id) reading.meter_id = meter_id;
      if (reading_value !== undefined) reading.reading_value = reading_value;

      // Always stamp who performed the edit
      reading.read_by = updatedBy;
      reading.last_updated = now;
      reading.updated_by = updatedBy;

      await reading.save();
      res.json({ message: `Reading with ID ${readingId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /meter_reading/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE METER READING BY ID
 * - Admins: unrestricted
 * - Operators: can only delete readings under their building
 */
router.delete('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const readingId = req.params.id;
    if (!readingId) {
      return res.status(400).json({ error: 'Reading ID is required' });
    }
    try {
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) {
        return res.status(404).json({ error: 'Reading not found' });
      }

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) {
          return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        }
        const readingBldg = await getReadingBuildingId(readingId);
        if (!readingBldg || readingBldg !== userBldg) {
          return res.status(403).json({
            error: 'No access: You can only delete readings under your assigned building.'
          });
        }
      }

      const deleted = await Reading.destroy({ where: { reading_id: readingId } });
      if (deleted === 0) {
        return res.status(404).json({ error: 'Reading not found' });
      }
      res.json({ message: `Reading with ID ${readingId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /meter_reading/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
