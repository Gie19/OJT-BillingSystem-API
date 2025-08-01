const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const getCurrentDateTime = require('../utils/getCurrentDateTime');

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const query = util.promisify(db.query).bind(db);

// All routes below require valid token
router.use(authenticateToken);

// GET ALL RATES
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM utility_rate');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET RATE BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;
  try {
    const results = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (results.length === 0) {
      return res.status(404).json({ message: 'Rate not found' });
    }
    res.json(results[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE FULL RATE
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { erate_perKwH, e_vat, emin_con, wmin_con, wrate_perCbM, wnet_vat, w_vat, l_rate } = req.body;

  if (!erate_perKwH || !e_vat || !emin_con || !wmin_con || !wrate_perCbM || !wnet_vat || !w_vat || !l_rate) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const sqlFind = `
      SELECT rate_id FROM utility_rate
      WHERE rate_id LIKE 'R-%'
      ORDER BY CAST(SUBSTRING(rate_id, 3) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);
    const nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(2), 10) + 1 : 1;
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const sqlInsert = `
      INSERT INTO utility_rate (
        rate_id, erate_perKwH, e_vat, emin_con, wmin_con,
        wrate_perCbM, wnet_vat, w_vat, l_rate, last_updated, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
      newRateId,
      erate_perKwH,
      e_vat,
      emin_con,
      wmin_con,
      wrate_perCbM,
      wnet_vat,
      w_vat,
      l_rate,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE ELECTRIC RATE
router.post('/electric', authorizeRole('admin'), async (req, res) => {
  const { erate_perKwH, emin_con, e_vat } = req.body;
  if (!erate_perKwH || !emin_con || !e_vat) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const results = await query(`
      SELECT rate_id FROM utility_rate
      WHERE rate_id LIKE 'R-%'
      ORDER BY CAST(SUBSTRING(rate_id, 3) AS UNSIGNED) DESC
      LIMIT 1
    `);
    const nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(2), 10) + 1 : 1;
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await query(`
      INSERT INTO utility_rate (
        rate_id, erate_perKwH, emin_con, e_vat, last_updated, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [newRateId, erate_perKwH, emin_con, e_vat, today, updatedBy]);

    res.status(201).json({ message: 'Electric rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates/electric:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE WATER RATE
router.post('/water', authorizeRole('admin'), async (req, res) => {
  const { wmin_con, wrate_perCbM, wnet_vat, w_vat } = req.body;
  if (!wmin_con || !wrate_perCbM || !wnet_vat || !w_vat) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const results = await query(`
      SELECT rate_id FROM utility_rate
      WHERE rate_id LIKE 'R-%'
      ORDER BY CAST(SUBSTRING(rate_id, 3) AS UNSIGNED) DESC
      LIMIT 1
    `);
    const nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(2), 10) + 1 : 1;
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await query(`
      INSERT INTO utility_rate (
        rate_id, wmin_con, wrate_perCbM, wnet_vat, w_vat, last_updated, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [newRateId, wmin_con, wrate_perCbM, wnet_vat, w_vat, today, updatedBy]);

    res.status(201).json({ message: 'Water rate created successfully', rateId: newRateId });
  } catch (err) {
    console.error('Error in POST /rates/water:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE LPG RATE
router.post('/lpg', authorizeRole('admin'), async (req, res) => {
  const { l_rate } = req.body;
  if (!l_rate) {
    return res.status(400).json({ error: 'LPG rate is required' });
  }

  try {
    const results = await query(`
      SELECT rate_id FROM utility_rate
      WHERE rate_id LIKE 'R-%'
      ORDER BY CAST(SUBSTRING(rate_id, 3) AS UNSIGNED) DESC
      LIMIT 1
    `);
    const nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(2), 10) + 1 : 1;
    const newRateId = `R-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await query(`
      INSERT INTO utility_rate (
        rate_id, l_rate, last_updated, updated_by
      ) VALUES (?, ?, ?, ?)
    `, [newRateId, l_rate, today, updatedBy]);

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
    const [existing] = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (!existing) return res.status(404).json({ error: 'Rate not found' });

    await query(`
      UPDATE utility_rate SET
        erate_perKwH = ?, emin_con = ?, e_vat = ?, last_updated = ?, updated_by = ?
      WHERE rate_id = ?
    `, [
      erate_perKwH ?? existing.erate_perKwH,
      emin_con ?? existing.emin_con,
      e_vat ?? existing.e_vat,
      lastUpdated,
      updatedBy,
      rateId
    ]);

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
    const [existing] = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (!existing) return res.status(404).json({ error: 'Rate not found' });

    await query(`
      UPDATE utility_rate SET
        wmin_con = ?, wrate_perCbM = ?, wnet_vat = ?, w_vat = ?, last_updated = ?, updated_by = ?
      WHERE rate_id = ?
    `, [
      wmin_con ?? existing.wmin_con,
      wrate_perCbM ?? existing.wrate_perCbM,
      wnet_vat ?? existing.wnet_vat,
      w_vat ?? existing.w_vat,
      lastUpdated,
      updatedBy,
      rateId
    ]);

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
    const [existing] = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (!existing) return res.status(404).json({ error: 'Rate not found' });

    await query(`
      UPDATE utility_rate SET
        l_rate = ?, last_updated = ?, updated_by = ?
      WHERE rate_id = ?
    `, [l_rate ?? existing.l_rate, lastUpdated, updatedBy, rateId]);

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
    const [existing] = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (!existing) return res.status(404).json({ error: 'Rate not found' });

    await query(`
      UPDATE utility_rate SET
        erate_perKwH = ?, e_vat = ?, emin_con = ?,
        wmin_con = ?, wrate_perCbM = ?, wnet_vat = ?, w_vat = ?,
        l_rate = ?, last_updated = ?, updated_by = ?
      WHERE rate_id = ?
    `, [
      erate_perKwH ?? existing.erate_perKwH,
      e_vat ?? existing.e_vat,
      emin_con ?? existing.emin_con,
      wmin_con ?? existing.wmin_con,
      wrate_perCbM ?? existing.wrate_perCbM,
      wnet_vat ?? existing.wnet_vat,
      w_vat ?? existing.w_vat,
      l_rate ?? existing.l_rate,
      lastUpdated,
      updatedBy,
      rateId
    ]);

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
    const results = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }

    await query('DELETE FROM utility_rate WHERE rate_id = ?', [rateId]);
    res.json({ message: `Rate with ID ${rateId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /rates/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
