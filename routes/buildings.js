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

//GET ALL BUIDLINGS
router.get('/', authorizeRole('admin', 'user'), async (req, res) => {
  try { 
    const results = await query('SELECT * FROM building_list');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

//GET BUILDING BY ID
router.get('/:id', authorizeRole('admin', 'user'), async (req, res) => {
  const buildingId = req.params.id;
  try {
    const results = await query('SELECT * FROM building_list WHERE building_id = ?', [buildingId]);
    if (results.length === 0) {
      return res.status(404).json({ message: 'Building not found' });
    }
    res.json(results[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});
  

//CREATE A NEW BUILDING
router.post('/',  async (req, res) => {
    const { building_name, rate_id } = req.body;
    
    if (!building_name || !rate_id) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {

      // Check if rate_id exists
      const rateIdCheckSql = 'SELECT rate_id FROM utility_rate WHERE rate_id = ?';
      const rateIdCheckResults = await query(rateIdCheckSql, [rate_id]);
      if (rateIdCheckResults.length === 0) {
          return res.status(400).json({ error: 'Invalid rate_id: Utility Rate ID does not exist.' });
        }
      // Get highest BLDG- ID
      const sqlFind = `
        SELECT building_id FROM building_list
        WHERE building_id LIKE 'BLDG-%'
        ORDER BY CAST(SUBSTRING(building_id, 6) AS UNSIGNED) DESC
        LIMIT 1
      `;
      const results = await query(sqlFind);

      let nextNumber = 1;
      if (results.length > 0) {
        const lastId = results[0].building_id;
        const lastNumber = parseInt(lastId.slice(5), 10); // skip 'BLDG-'
        nextNumber = lastNumber + 1;
      }

      const newBuildingId = `BLDG-${nextNumber}`;
      const today = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;


      const sqlInsert = `
        INSERT INTO building_list (building_id, building_name, rate_id, last_updated, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `;
      await query(sqlInsert, [newBuildingId, building_name, rate_id, today, updatedBy]);

      res.status(201).json({
        message: 'Building created successfully',
        buildingId: newBuildingId
      });
  } catch (err) {
    console.error('Error in POST /buildings:', err);
    res.status(500).json({ error: err.message });
  }

});

//UPDATE BUILDING BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const buildingId = req.params.id;
  const { building_name, rate_id } = req.body;

  if (!buildingId || !building_name || !rate_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if rate_id exists
    const rateIdCheckSql = 'SELECT rate_id FROM utility_rate WHERE rate_id = ?';
    const rateIdCheckResults = await query(rateIdCheckSql, [rate_id]);
    if (rateIdCheckResults.length === 0) {
      return res.status(400).json({ error: 'Invalid rate_id: Utility Rate ID does not exist.' });
    }

    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const sqlUpdate = `
      UPDATE building_list
      SET building_name = ?, rate_id = ?, last_updated = ?, updated_by = ?
      WHERE building_id = ?
    `;
    await query(sqlUpdate, [building_name, rate_id, today, updatedBy, buildingId]);

    res.json({ message: 'Building updated successfully' });
  } catch (err) {
    console.error('Error in PUT /buildings/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


//DELETE BUILDING BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const buildingId = req.params.id;

  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }

  try {
    const sqlDelete = 'DELETE FROM building_list WHERE building_id = ?';
    const result = await query(sqlDelete, [buildingId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    res.json({ message: `Building with ID ${buildingId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /buildings/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;