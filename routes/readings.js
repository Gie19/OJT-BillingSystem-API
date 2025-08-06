const express = require('express');
const router = express.Router();
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const Reading = require('../models/Reading');
const Meter = require('../models/Meter'); // For checking meter_id
const { Op, literal } = require('sequelize');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL METER READINGS
router.get('/', authorizeRole('admin', 'personnel'), async (req, res) => {
  try {
    const readings = await Reading.findAll();
    res.json(readings);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET METER READING BY ID
router.get('/:id', authorizeRole('admin', 'personnel'), async (req, res) => {
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
});

// CREATE NEW METER READING
router.post('/', authorizeRole('admin', 'personnel'), async (req, res) => {
  const { meter_id, prev_reading, curr_reading } = req.body;

  if (!meter_id) {
    return res.status(400).json({ error: 'meter_id is required' });
  }

  const safePrev = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '') ? prev_reading : 0.00;
  const safeCurr = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '') ? curr_reading : 0.00;

  try {
    // Validate meter_id exists
    const meter = await Meter.findOne({ where: { meter_id } });
    if (!meter) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    // Get next reading_id
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

    // Determine lastread_date and read_by
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
});

// UPDATE METER READING BY ID
router.put('/:id', authorizeRole('admin', 'personnel'), async (req, res) => {
  const readingId = req.params.id;
  const { meter_id, prev_reading, curr_reading } = req.body;
  const updatedBy = req.user.user_fullname;
  const now = getCurrentDateTime();

  try {
    const reading = await Reading.findOne({ where: { reading_id: readingId } });
    if (!reading) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    // Detect if meter_id changed
    const isMeterIdChanged = meter_id && meter_id !== reading.meter_id;
    // Safely handle values
    const finalPrevReading = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '')
      ? prev_reading : (prev_reading === undefined ? reading.prev_reading : 0.00);
    const finalCurrReading = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '')
      ? curr_reading : (curr_reading === undefined ? reading.curr_reading : 0.00);

    const isReadingChanged =
      (prev_reading !== undefined && finalPrevReading !== reading.prev_reading) ||
      (curr_reading !== undefined && finalCurrReading !== reading.curr_reading);

    // Validate new meter_id if it's changing
    if (isMeterIdChanged) {
      const meter = await Meter.findOne({ where: { meter_id } });
      if (!meter) {
        return res.status(400).json({ error: 'Invalid meter_id: Meter does not exist.' });
      }
    }

    if (!isMeterIdChanged && !isReadingChanged) {
      return res.status(400).json({ message: 'No changes detected in the request body.' });
    }

    // Decide lastread_date and read_by if readings changed
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

    // Build update object
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
});

// DELETE METER READING BY ID
router.delete('/:id', authorizeRole('admin', 'personnel'), async (req, res) => {
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
});

module.exports = router;
