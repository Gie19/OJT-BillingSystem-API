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

//GET ALL METER READINGS
router.get('/', authorizeRole('admin', 'personnel'), async (req, res) => {
    try {
        const results = await query('SELECT * FROM meter_reading');
        res.json(results);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET METER READING BY ID
router.get('/:id', authorizeRole('admin', 'personnel'), async (req, res) => {
    const readingId = req.params.id;
    try {
        const results = await query('SELECT * FROM meter_reading WHERE reading_id = ?', [readingId]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'Meter reading not found' });
        }
        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// CREATE NEW METER READING
router.post('/', authorizeRole('admin','personnel'), async (req, res) => {
  const { meter_id, prev_reading, curr_reading } = req.body;

  // Only meter_id is required
  if (!meter_id) {
    return res.status(400).json({ error: 'meter_id is required' });
  }

  // Default to 0.00 if not provided
  const safePrev = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '') ? prev_reading : 0.00;
  const safeCurr = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '') ? curr_reading : 0.00;

  try {
    // Validate that meter_id exists in meter_list table
    const meterCheckSql = 'SELECT meter_id FROM meter_list WHERE meter_id = ?';
    const meterResults = await query(meterCheckSql, [meter_id]);

    if (meterResults.length === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    // Get next reading_id (with MR- prefix)
    const sqlFind = `
      SELECT reading_id FROM meter_reading
      WHERE reading_id LIKE 'MR-%'
      ORDER BY CAST(SUBSTRING(reading_id, 4) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].reading_id;
      const lastNumber = parseInt(lastId.slice(3), 10); // after 'MR-'
      nextNumber = lastNumber + 1;
    }

    const newReadingId = `MR-${nextNumber}`;
    const now = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    // Determine lastread_date and read_by
    let lastread_date = null;
    let read_by = null;

    // Check if both readings are 0.00
    const bothZero = parseFloat(safePrev) === 0.00 && parseFloat(safeCurr) === 0.00;

    if (!bothZero) {
      lastread_date = now;
      read_by = updatedBy;
    }

    // Insert new reading
    const insertSql = `
      INSERT INTO meter_reading (
        reading_id,
        meter_id,
        prev_reading,
        curr_reading,
        lastread_date,
        read_by,
        last_updated,
        updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await query(insertSql, [
      newReadingId,
      meter_id,
      safePrev,
      safeCurr,
      lastread_date,
      read_by,
      now,
      updatedBy
    ]);

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
    // Fetch existing record
    const sqlGet = 'SELECT * FROM meter_reading WHERE reading_id = ?';
    const results = await query(sqlGet, [readingId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    const existing = results[0];

    // Detect if meter_id changed
    const isMeterIdChanged = meter_id && meter_id !== existing.meter_id;

    // Safely handle possible empty/undefined/null values for readings
    const finalPrevReading = (prev_reading !== undefined && prev_reading !== null && prev_reading !== '')
      ? prev_reading : (prev_reading === undefined ? existing.prev_reading : 0.00);

    const finalCurrReading = (curr_reading !== undefined && curr_reading !== null && curr_reading !== '')
      ? curr_reading : (curr_reading === undefined ? existing.curr_reading : 0.00);

    // Detect if readings changed
    const isReadingChanged = (
      (prev_reading !== undefined && finalPrevReading !== existing.prev_reading) ||
      (curr_reading !== undefined && finalCurrReading !== existing.curr_reading)
    );

    // Validate new meter_id if it's changing
    if (isMeterIdChanged) {
      const meterCheckSql = 'SELECT meter_id FROM meter_list WHERE meter_id = ?';
      const meterResults = await query(meterCheckSql, [meter_id]);
      if (meterResults.length === 0) {
        return res.status(400).json({ error: 'Invalid meter_id: Meter does not exist.' });
      }
    }

    // No changes?
    if (!isMeterIdChanged && !isReadingChanged) {
      return res.status(400).json({ message: 'No changes detected in the request body.' });
    }

    // Decide lastread_date and read_by if readings changed
    let lastread_date = existing.lastread_date;
    let read_by = existing.read_by;

    if (isReadingChanged) {
      if (parseFloat(finalPrevReading) === 0.00 && parseFloat(finalCurrReading) === 0.00) {
        lastread_date = null;
        read_by = null;
      } else {
        lastread_date = now;
        read_by = updatedBy;
      }
    }

    // Build SQL dynamically based on what changed
    let sqlUpdate;
    let params;

    if (isMeterIdChanged && isReadingChanged) {
      // Both changed
      sqlUpdate = `
        UPDATE meter_reading
        SET meter_id = ?, prev_reading = ?, curr_reading = ?, 
            lastread_date = ?, read_by = ?, 
            last_updated = ?, updated_by = ?
        WHERE reading_id = ?
      `;
      params = [
        meter_id,
        finalPrevReading,
        finalCurrReading,
        lastread_date,
        read_by,
        now,
        updatedBy,
        readingId
      ];
    } else if (isMeterIdChanged) {
      // Only meter_id changed
      sqlUpdate = `
        UPDATE meter_reading
        SET meter_id = ?, last_updated = ?, updated_by = ?
        WHERE reading_id = ?
      `;
      params = [
        meter_id,
        now,
        updatedBy,
        readingId
      ];
    } else if (isReadingChanged) {
      // Only readings changed
      sqlUpdate = `
        UPDATE meter_reading
        SET prev_reading = ?, curr_reading = ?, 
            lastread_date = ?, read_by = ?
        WHERE reading_id = ?
      `;
      params = [
        finalPrevReading,
        finalCurrReading,
        lastread_date,
        read_by,
        readingId
      ];
    }

    // Execute the update
    await query(sqlUpdate, params);

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
    const sqlDelete = 'DELETE FROM meter_reading WHERE reading_id = ?';
    const result = await query(sqlDelete, [readingId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Reading not found' });
    }

    res.json({ message: `Reading with ID ${readingId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /meter_reading/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
