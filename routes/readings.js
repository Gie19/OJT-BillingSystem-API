// routes/readings.js
const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { attachBuildingScope, enforceRecordBuilding } = require('../middleware/authorizeBuilding');

const { Op, literal } = require('sequelize');

// Models
const Reading = require('../models/Reading');
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');

// All routes below require a valid token
router.use(authenticateToken);

/**
 * GET ALL METER READINGS
 * - Admins: all readings
 * - Employees: only readings for meters in stalls under their building
 * - Return 403 with clear message when nothing is accessible
 */
router.get('/',
  authorizeRole('admin', 'employee'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      // Admin path
      if (!req.restrictToBuildingId) {
        const readings = await Reading.findAll();
        return res.json(readings);
      }

      // Employee path → scope via Stall.building_id → Meter → Reading
      const stalls = await Stall.findAll({
        where: { building_id: req.restrictToBuildingId },
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
 * - If exists but out-of-building → 403 with a clear message (from middleware)
 */
router.get('/:id',
  authorizeRole('admin', 'employee'),
  enforceRecordBuilding(async (req) => {
    // Resolve the building_id for this reading:
    const reading = await Reading.findOne({
      where: { reading_id: req.params.id },
      attributes: ['meter_id'],
      raw: true
    });
    if (!reading) return null; // lets handler 404

    const meter = await Meter.findOne({
      where: { meter_id: reading.meter_id },
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
      const reading = await Reading.findOne({ where: { reading_id: req.params.id } });
      if (!reading) {
        return res.status(404).json({ message: 'Meter reading not found' });
      }
      res.json(reading);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// CREATE NEW METER READING (unchanged roles)
router.post('/',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const { meter_id, prev_reading, curr_reading } = req.body;

    if (!meter_id) {
      return res.status(400).json({ error: 'meter_id is required' });
    }

    const safePrev = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '') ? prev_reading : 0.00;
    const safeCurr = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '') ? curr_reading : 0.00;

    try {
      const meter = await Meter.findOne({ where: { meter_id } });
      if (!meter) {
        return res.status(404).json({ error: 'Meter not found' });
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

      let lastread_date = null;
      let read_by = null;
      const bothZero = parseFloat(safePrev) === 0.00 && parseFloat(safeCurr) === 0.00;
      if (!bothZero) {
        lastread_date = now;
        read_by = updatedBy;
      }

      await Reading.create({
        reading_id: newReadingId,
        meter_id,
        prev_reading: safePrev,
        curr_reading: safeCurr,
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

// UPDATE METER READING BY ID (unchanged roles)
router.put('/:id',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const readingId = req.params.id;
    const { meter_id, prev_reading, curr_reading } = req.body;
    const updatedBy = req.user.user_fullname;
    const now = getCurrentDateTime();

    try {
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) {
        return res.status(404).json({ error: 'Reading not found' });
      }

      const isMeterIdChanged = meter_id && meter_id !== reading.meter_id;
      const finalPrevReading = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '')
        ? prev_reading : (prev_reading === undefined ? reading.prev_reading : 0.00);
      const finalCurrReading = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '')
        ? curr_reading : (curr_reading === undefined ? reading.curr_reading : 0.00);

      const isReadingChanged =
        (prev_reading !== undefined && finalPrevReading !== reading.prev_reading) ||
        (curr_reading !== undefined && finalCurrReading !== reading.curr_reading);

      if (isMeterIdChanged) {
        const meter = await Meter.findOne({ where: { meter_id } });
        if (!meter) {
          return res.status(400).json({ error: 'Invalid meter_id: Meter does not exist.' });
        }
      }

      if (!isMeterIdChanged && !isReadingChanged) {
        return res.status(400).json({ message: 'No changes detected in the request body.' });
      }

      let lastread_date = reading.lastread_date;
      let read_by = reading.read_by;
      if (isReadingChanged) {
        if (parseFloat(finalPrevReading) === 0.00 && parseFloat(finalCurrReading) === 0.00) {
          lastread_date = null;
          read_by = null;
        } else {
          lastread_date = now;
          read_by = updatedBy;
        }
      }

      const updateObj = {};
      if (isMeterIdChanged) updateObj.meter_id = meter_id;
      if (isReadingChanged) {
        updateObj.prev_reading = finalPrevReading;
        updateObj.curr_reading = finalCurrReading;
        updateObj.lastread_date = lastread_date;
        updateObj.read_by = read_by;
        updateObj.last_updated = now;
        updateObj.updated_by = updatedBy;
      }
      if (isMeterIdChanged && !isReadingChanged) {
        updateObj.last_updated = now;
        updateObj.updated_by = updatedBy;
      }

      await reading.update(updateObj);

      res.json({ message: `Reading with ID ${readingId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /meter_reading/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE METER READING BY ID (unchanged roles)
router.delete('/:id',
  authorizeRole('admin', 'employee'),
  async (req, res) => {
    const readingId = req.params.id;
    if (!readingId) {
      return res.status(400).json({ error: 'Reading ID is required' });
    }
    try {
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
