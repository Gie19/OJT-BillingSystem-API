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


// GET ALL METERS
router.get('/', authorizeRole('admin'), async (req, res) => {
    try {
        const results = await query('SELECT * FROM meters');
        res.json(results);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});


//GET METER BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
    const meterId = req.params.id;
    try {
        const results = await query('SELECT * FROM meters WHERE meter_id = ?', [meterId]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'Meter not found' });
        }

        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// CREATE NEW METER
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { meter_type, meter_sn, stall_id, meter_status } = req.body;

  // Field validation
  if (!meter_type || !meter_sn || !stall_id || !meter_status) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Validate that stall_id exists in stalls table
    const stallCheckSql = 'SELECT stall_id FROM stalls WHERE stall_id = ?';
    const stallResults = await query(stallCheckSql, [stall_id]);

    if (stallResults.length === 0) {
      return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
    }

    // Get last meter_id like M1, M2, ...
    const sqlFind = `
      SELECT meter_id FROM meters
      WHERE meter_id LIKE 'M%'
      ORDER BY CAST(SUBSTRING(meter_id, 2) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].meter_id;
      const lastNumber = parseInt(lastId.slice(1), 10);
      nextNumber = lastNumber + 1;
    }

    const newMeterId = `M${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    // Insert new meter
    const sqlInsert = `
      INSERT INTO meters (meter_id, meter_type, meter_sn, stall_id, meter_status, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
      newMeterId,
      meter_type,
      meter_sn,
      stall_id,
      meter_status,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Meter created successfully', meterId: newMeterId });
  } catch (err) {
    console.error('Error in POST /meters:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE METER BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const meterId = req.params.id;
  const { meter_type, meter_sn, stall_id, meter_status } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing record
    const sqlGet = 'SELECT * FROM meters WHERE meter_id = ?';
    const results = await query(sqlGet, [meterId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    const existing = results[0];

    // Determine final field values
    const finalMeterType = meter_type || existing.meter_type;
    const finalMeterSn = meter_sn || existing.meter_sn;
    const finalStallId = stall_id || existing.stall_id;
    const finalMeterStatus = meter_status || existing.meter_status;

    // If there's a stall_id, validate it exists
    if (finalStallId) {
      const stallCheckSql = 'SELECT stall_id FROM stalls WHERE stall_id = ?';
      const stallResults = await query(stallCheckSql, [finalStallId]);

      if (stallResults.length === 0) {
        return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
      }
    }

    // Perform the update
    const sqlUpdate = `
      UPDATE meters
      SET meter_type = ?, meter_sn = ?, stall_id = ?, meter_status = ?, last_updated = ?, updated_by = ?
      WHERE meter_id = ?
    `;

    await query(sqlUpdate, [
      finalMeterType,
      finalMeterSn,
      finalStallId,
      finalMeterStatus,
      lastUpdated,
      updatedBy,
      meterId
    ]);

    res.json({ message: `Meter with ID ${meterId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /meters/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


// DELETE METER BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const meterId = req.params.id;

  if (!meterId) {
    return res.status(400).json({ error: 'Meter ID is required' });
  }

  try {
    const sqlDelete = 'DELETE FROM meters WHERE meter_id = ?';
    const result = await query(sqlDelete, [meterId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    res.json({ message: `Meter with ID ${meterId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /meters/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;