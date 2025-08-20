const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole'); // ⬅️ NEW

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
 * CREATE NEW METER READING
 * - Admins and Readers only (operator cannot create)
 * - Reader must have utility access for the meter (electric/water/lpg)  ⬅️ NEW CHECK
 * - Non-admin must create for meters under their building
 * - lastread_date/read_by are NOT NULL → always set
 * - lastread_date: manual input; defaults to today (YYYY-MM-DD) if omitted
 */
router.post('/',
  authorizeRole('admin', 'reader'),
  authorizeUtilityRole({ roles: ['reader'] }), // ⬅️ NEW: reader must be allowed for meter’s utility
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

      const today = new Date().toISOString().slice(0, 10);
      const finalLastReadDate = lastread_date || today;

      await Reading.create({
        reading_id: newReadingId,
        meter_id,
        reading_value,
        lastread_date: finalLastReadDate,      // NOT NULL (DATEONLY)
        read_by: updatedBy,                    // NOT NULL
        last_updated: now,
        updated_by: updatedBy
      });

      res.status(201).json({ message: 'Reading created successfully', readingId: newReadingId });
    } catch (err) {
      console.error('Error in POST /meter_reading:', err);
      // If UNIQUE(meter_id,lastread_date) is violated, MySQL will throw ER_DUP_ENTRY
      res.status(500).json({ error: err.message });
    }
  }
);


/**
 * UPDATE METER READING BY ID
 * - Admins: unrestricted
 * - Operators: can only update readings under their building
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

      if (meter_id) reading.meter_id = meter_id;
      if (reading_value !== undefined) reading.reading_value = reading_value;

      if (lastread_date !== undefined) {
        // maintain NOT NULL lastread_date; allow manual edit; if omitted, keep current value
        reading.lastread_date = lastread_date || new Date().toISOString().slice(0, 10);
      }

      // Always stamp who performed the edit to satisfy NOT NULL read_by
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
