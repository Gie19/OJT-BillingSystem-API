const express = require('express');
const router = express.Router();
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const Qr = require('../models/Qr');
const { Op, literal } = require('sequelize');

// All routes below require a valid token
router.use(authenticateToken);

// GET ALL QR DETAILS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const qrs = await Qr.findAll();
    res.json(qrs);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET QR DETAILS BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const qr = await Qr.findOne({ where: { qr_id: req.params.id } });
    if (!qr) {
      return res.status(404).json({ message: 'QR details not found' });
    }
    res.json(qr);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW QR DETAILS
router.post('/', authorizeRole('admin'), async (req, res) => {
  try {
    // Find the highest existing QR number
    const lastQr = await Qr.findOne({
      where: { qr_id: { [Op.like]: 'QR-%' } },
      order: [[literal("CAST(SUBSTRING(qr_id, 4) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastQr) {
      const lastNumber = parseInt(lastQr.qr_id.slice(3), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }

    const newQrId = `QR-${nextNumber}`;
    const today = getCurrentDateTime();
    const generatedBy = req.user.user_fullname;

    await Qr.create({
      qr_id: newQrId,
      generated_date: today,
      generated_by: generatedBy
    });

    res.status(201).json({ message: 'QR details created successfully', qr_id: newQrId });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE QR DETAILS BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const qrId = req.params.id;
  const { generated_date, generated_by } = req.body;

  try {
    const qr = await Qr.findOne({ where: { qr_id: qrId } });
    if (!qr) {
      return res.status(404).json({ error: 'QR details not found' });
    }

    await qr.update({
      generated_date: generated_date || qr.generated_date,
      generated_by: generated_by || qr.generated_by
    });

    res.json({ message: 'QR details updated successfully' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE QR DETAILS BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const qrId = req.params.id;

  try {
    const deleted = await Qr.destroy({ where: { qr_id: qrId } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'QR details not found' });
    }

    res.json({ message: `QR details with ID ${qrId} deleted successfully` });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
