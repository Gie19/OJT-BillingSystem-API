const express = require('express');
const router = express.Router();
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const { Op, literal } = require('sequelize');

// Imported models
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Reading = require('../models/Reading');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL METERS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const meters = await Meter.findAll();
    res.json(meters);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET METER BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const meter = await Meter.findOne({ where: { meter_id: req.params.id } });
    if (!meter) return res.status(404).json({ message: 'Meter not found' });
    res.json(meter);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW METER
router.post('/', authorizeRole('admin'), async (req, res) => {
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
});

// UPDATE METER BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const meterId = req.params.id;
  const { meter_type, meter_sn, stall_id, meter_status, meter_mult } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing meter
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
});

// DELETE METER BY ID with dependency check
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
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
});

module.exports = router;
