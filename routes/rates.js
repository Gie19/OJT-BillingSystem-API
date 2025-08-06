const express = require('express');
const router = express.Router();
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const Rate = require('../models/Rate');
const { Op, literal } = require('sequelize');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL RATES
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const rates = await Rate.findAll();
    res.json(rates);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET RATE BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const rate = await Rate.findOne({ where: { rate_id: req.params.id } });
    if (!rate) return res.status(404).json({ message: 'Rate not found' });
    res.json(rate);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE FULL RATE
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { erate_perKwH, e_vat, emin_con, wmin_con, wrate_perCbM, wnet_vat, w_vat, l_rate } = req.body;

  if (
    erate_perKwH === undefined || e_vat === undefined || emin_con === undefined ||
    wmin_con === undefined || wrate_perCbM === undefined || wnet_vat === undefined ||
    w_vat === undefined || l_rate === undefined
  ) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const lastRate = await Rate.findOne({
      where: { rate_id: { [Op.like]: 'UR-%' } },
      order: [[literal("CAST(SUBSTRING(rate_id, 4) AS UNSIGNED)"), "DESC"]],
    });
    let nextNumber = 1;
    if (lastRate) {
      const lastNumber = parseInt(lastRate.rate_id.slice(3), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newRateId = `UR-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await Rate.create({
      rate_id: newRateId,
      erate_perKwH,
      e_vat,
      emin_con,
      wmin_con,
      wrate_perCbM,
      wnet_vat,
      w_vat,
      l_rate,
      last_updated: today,
      updated_by: updatedBy
    });

    res.status(201).json({ message: 'Rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE ELECTRIC RATE
router.post('/electric', authorizeRole('admin'), async (req, res) => {
  const { erate_perKwH, emin_con, e_vat } = req.body;
  if (
    erate_perKwH === undefined ||
    emin_con === undefined ||
    e_vat === undefined
  ) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const lastRate = await Rate.findOne({
      where: { rate_id: { [Op.like]: 'R-%' } },
      order: [[literal("CAST(SUBSTRING(rate_id, 3) AS UNSIGNED)"), "DESC"]],
    });
    let nextNumber = 1;
    if (lastRate) {
      const lastNumber = parseInt(lastRate.rate_id.slice(2), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await Rate.create({
      rate_id: newRateId,
      erate_perKwH,
      emin_con,
      e_vat,
      last_updated: today,
      updated_by: updatedBy
    });

    res.status(201).json({ message: 'Electric rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates/electric:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE WATER RATE
router.post('/water', authorizeRole('admin'), async (req, res) => {
  const { wmin_con, wrate_perCbM, wnet_vat, w_vat } = req.body;
  if (
    wmin_con === undefined ||
    wrate_perCbM === undefined ||
    wnet_vat === undefined ||
    w_vat === undefined
  ) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const lastRate = await Rate.findOne({
      where: { rate_id: { [Op.like]: 'R-%' } },
      order: [[literal("CAST(SUBSTRING(rate_id, 3) AS UNSIGNED)"), "DESC"]],
    });
    let nextNumber = 1;
    if (lastRate) {
      const lastNumber = parseInt(lastRate.rate_id.slice(2), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await Rate.create({
      rate_id: newRateId,
      wmin_con,
      wrate_perCbM,
      wnet_vat,
      w_vat,
      last_updated: today,
      updated_by: updatedBy
    });

    res.status(201).json({ message: 'Water rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates/water:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE LPG RATE
router.post('/lpg', authorizeRole('admin'), async (req, res) => {
  const { l_rate } = req.body;
  if (l_rate === undefined) {
    return res.status(400).json({ error: 'LPG rate is required' });
  }

  try {
    const lastRate = await Rate.findOne({
      where: { rate_id: { [Op.like]: 'R-%' } },
      order: [[literal("CAST(SUBSTRING(rate_id, 3) AS UNSIGNED)"), "DESC"]],
    });
    let nextNumber = 1;
    if (lastRate) {
      const lastNumber = parseInt(lastRate.rate_id.slice(2), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await Rate.create({
      rate_id: newRateId,
      l_rate,
      last_updated: today,
      updated_by: updatedBy
    });

    res.status(201).json({ message: 'LPG rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates/lpg:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ELECTRIC RATE
router.put('/electric/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;
  const { erate_perKwH, emin_con, e_vat } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    const rate = await Rate.findOne({ where: { rate_id: rateId } });
    if (!rate) return res.status(404).json({ error: 'Rate not found' });

    await rate.update({
      erate_perKwH: erate_perKwH ?? rate.erate_perKwH,
      emin_con: emin_con ?? rate.emin_con,
      e_vat: e_vat ?? rate.e_vat,
      last_updated: lastUpdated,
      updated_by: updatedBy
    });

    res.json({ message: `Electric rate with ID ${rateId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /rates/electric/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE WATER RATE
router.put('/water/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;
  const { wmin_con, wrate_perCbM, wnet_vat, w_vat } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    const rate = await Rate.findOne({ where: { rate_id: rateId } });
    if (!rate) return res.status(404).json({ error: 'Rate not found' });

    await rate.update({
      wmin_con: wmin_con ?? rate.wmin_con,
      wrate_perCbM: wrate_perCbM ?? rate.wrate_perCbM,
      wnet_vat: wnet_vat ?? rate.wnet_vat,
      w_vat: w_vat ?? rate.w_vat,
      last_updated: lastUpdated,
      updated_by: updatedBy
    });

    res.json({ message: `Water rate with ID ${rateId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /rates/water/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE LPG RATE
router.put('/lpg/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;
  const { l_rate } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    const rate = await Rate.findOne({ where: { rate_id: rateId } });
    if (!rate) return res.status(404).json({ error: 'Rate not found' });

    await rate.update({
      l_rate: l_rate ?? rate.l_rate,
      last_updated: lastUpdated,
      updated_by: updatedBy
    });

    res.json({ message: `LPG rate with ID ${rateId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /rates/lpg/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE ALL FIELDS
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;
  const {
    erate_perKwH, e_vat, emin_con,
    wmin_con, wrate_perCbM, wnet_vat, w_vat,
    l_rate
  } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    const rate = await Rate.findOne({ where: { rate_id: rateId } });
    if (!rate) return res.status(404).json({ error: 'Rate not found' });

    await rate.update({
      erate_perKwH: erate_perKwH ?? rate.erate_perKwH,
      e_vat: e_vat ?? rate.e_vat,
      emin_con: emin_con ?? rate.emin_con,
      wmin_con: wmin_con ?? rate.wmin_con,
      wrate_perCbM: wrate_perCbM ?? rate.wrate_perCbM,
      wnet_vat: wnet_vat ?? rate.wnet_vat,
      w_vat: w_vat ?? rate.w_vat,
      l_rate: l_rate ?? rate.l_rate,
      last_updated: lastUpdated,
      updated_by: updatedBy
    });

    res.json({ message: `Rate with ID ${rateId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /rates/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE RATE
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;

  try {
    const deleted = await Rate.destroy({ where: { rate_id: rateId } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }
    res.json({ message: `Rate with ID ${rateId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /rates/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
