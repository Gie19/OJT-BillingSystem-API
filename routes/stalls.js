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


//GET ALL STALLS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM stalls');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});


//GET STALL BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
    const stallId = req.params.id;
    try {
        const results = await query('SELECT * FROM stalls WHERE id = ?', [stallId]);
    
        if (results.length === 0) {
        return res.status(404).json({ message: 'Stall not found' });
        }
    
        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// CREATE NEW STALL
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { stall_id, tenant_id, building_name, stall_status } = req.body;

  if (!stall_id || !building_name || !stall_status) {
    return res.status(400).json({ error: 'stall_id, building_name, and stall_status are required' });
  }

  try {
    // Determine actual tenant_id value (null if "available")
    let finalTenantId = tenant_id;
    if (stall_status === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenantCheckSql = 'SELECT tenant_id FROM tenants WHERE tenant_id = ?';
      const tenantResults = await query(tenantCheckSql, [finalTenantId]);

      if (tenantResults.length === 0) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    // Generate custom "S" ID
    const sqlFind = `
      SELECT id FROM stalls
      WHERE id LIKE 'S%'
      ORDER BY CAST(SUBSTRING(id, 2) AS UNSIGNED) DESC
      LIMIT 1
    `;

    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].id;
      const lastNumber = parseInt(lastId.slice(1), 10);
      nextNumber = lastNumber + 1;
    }

    const newId = `S${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const sqlInsert = `
      INSERT INTO stalls (id, stall_id, tenant_id, building_name, stall_status, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await query(sqlInsert, [
      newId,
      stall_id,
      finalTenantId,
      building_name,
      stall_status,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Stall created successfully', stallId: newId });
  } catch (err) {
    console.error('Error in POST /stalls:', err);
    res.status(500).json({ error: err.message });
  }
});



// UPDATE STALL BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;
  const { stall_id, tenant_id, building_name, stall_status } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing record
    const sqlGet = 'SELECT * FROM stalls WHERE id = ?';
    const results = await query(sqlGet, [stallId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Stall not found' });
    }

    const existing = results[0];

    // Determine final field values
    const finalStallId = stall_id || existing.stall_id;
    let finalTenantId = tenant_id !== undefined ? tenant_id : existing.tenant_id;
    const finalBuildingName = building_name || existing.building_name;
    const finalStallStatus = stall_status || existing.stall_status;

    // If status is "available" → tenant_id must be null
    if (finalStallStatus === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenantCheckSql = 'SELECT tenant_id FROM tenants WHERE tenant_id = ?';
      const tenantResults = await query(tenantCheckSql, [finalTenantId]);

      if (tenantResults.length === 0) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    // Perform the update
    const sqlUpdate = `
      UPDATE stalls
      SET stall_id = ?, tenant_id = ?, building_name = ?, stall_status = ?, last_updated = ?, updated_by = ?
      WHERE id = ?
    `;

    await query(sqlUpdate, [
      finalStallId,
      finalTenantId,
      finalBuildingName,
      finalStallStatus,
      lastUpdated,
      updatedBy,
      stallId
    ]);

    res.json({ message: `Stall with ID ${stallId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /stalls/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


// DELETE STALL BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;

  if (!stallId) {
    return res.status(400).json({ error: 'Stall ID is required' });
  }

  try {
    const sqlDelete = 'DELETE FROM stalls WHERE id = ?';
    const result = await query(sqlDelete, [stallId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Stall not found' });
    }

    res.json({ message: `Stall with ID ${stallId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /stalls/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;