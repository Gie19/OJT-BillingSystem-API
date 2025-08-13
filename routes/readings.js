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
 * - Employees: only readings for meters in stalls under their building
 * - Return 403 with clear message when nothing is accessible
 */
router.get('/',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    try {
      // Admin path
      if (isAdmin(req)) {
        const readings = await Reading.findAll();
        return res.json(readings);
      }

      // Employee path → scope via Stall.building_id → Meter → Reading
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
      if (stallIds.length === 0) {
        return res.status(403).json({
          error: 'No access: There are no stalls under your assigned building.'
        });
      }

      const meters = await Meter.findAll({
        where: { stall_id: stallIds },
        attributes: ['meter_id'],
        raw: true
      });
      const meterIds = meters.map(m => m.meter_id);
      if (meterIds.length === 0) {
        return res.status(403).json({
          error: 'No access: There are no meters under your assigned building.'
        });
      }

      const readings = await Reading.findAll({
        where: { meter_id: meterIds }
      });

      if (readings.length === 0) {
        return res.status(403).json({
          error: 'No access: There are no meter readings under your assigned building.'
        });
      }

      res.json(readings);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET METER READING BY ID
 * - Admins: full access
 * - Employees: only if the reading’s meter’s stall is in their building
 * - If exists but out-of-building → 403
 */
router.get('/:id',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    try {
      const readingId = req.params.id;

      // 404 if the resource doesn't exist at all
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
 * - Admins: unrestricted
 * - Employees: meter_id must belong to a stall under their building
 */
router.post('/',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const { meter_id, reading_value } = req.body;
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

      const lastread_date = parseFloat(reading_value) !== 0.00 ? now : null;
      const read_by = parseFloat(reading_value) !== 0.00 ? updatedBy : null;

      await Reading.create({
        reading_id: newReadingId,
        meter_id,
        reading_value,
        lastread_date,
        read_by,
        last_updated: now,
        updated_by: updatedBy
      });

      res.status(201).json({ message: 'Reading created successfully', readingId: newReadingId });
    } catch (err) {
      console.error('Error in POST /meter_reading:', err);
      res.status(500).json({ error: err.message });
    }
  }
);


/**
 * UPDATE METER READING BY ID
 * - Admins: unrestricted
 * - Employees:
 *    1) The existing reading must be under their building
 *    2) If changing meter_id, the new meter must also be under their building
 */
router.put('/:id',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const readingId = req.params.id;
    const { meter_id, reading_value } = req.body;
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

      if (!meter_id && reading_value === undefined) {
        return res.status(400).json({ message: 'No changes detected in the request body.' });
      }

      if (meter_id) reading.meter_id = meter_id;
      if (reading_value !== undefined) {
        reading.reading_value = reading_value;
        if (parseFloat(reading_value) === 0.00) {
          reading.lastread_date = null;
          reading.read_by = null;
        } else {
          reading.lastread_date = now;
          reading.read_by = updatedBy;
        }
      }

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
 * - Employees: can only delete readings under their building
 */
router.delete('/:id',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const readingId = req.params.id;
    if (!readingId) {
      return res.status(400).json({ error: 'Reading ID is required' });
    }
    try {
      // 404 if not found
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) {
        return res.status(404).json({ error: 'Reading not found' });
      }

      // Employee scope check
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