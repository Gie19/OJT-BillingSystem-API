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

// GET ALL STALLS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM stall_list');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET STALL BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;
  try {
    const results = await query('SELECT * FROM stall_list WHERE stall_id = ?', [stallId]);

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
  const { stall_sn, tenant_id, building_id, stall_status } = req.body;

  if (!stall_sn || !building_id || !stall_status) {
    return res.status(400).json({ error: 'stall_sn, building_id, and stall_status are required' });
  }

  try {
    // Uniqueness check for stall_sn
    const snCheck = await query('SELECT stall_id FROM stall_list WHERE stall_sn = ? LIMIT 1', [stall_sn]);
    if (snCheck.length > 0) {
      return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
    }

    // Generate custom S ID (stall_id)
    const sqlFind = `
      SELECT stall_id FROM stall_list
      WHERE stall_id LIKE 'S%'
      ORDER BY CAST(SUBSTRING(stall_id, 2) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].stall_id;
      const lastNumber = parseInt(lastId.slice(1), 10);
      nextNumber = lastNumber + 1;
    }
    const newStallId = `S${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    // tenant_id is nullable if status is 'available'
    let finalTenantId = tenant_id;
    if (stall_status === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenantCheckSql = 'SELECT tenant_id FROM tenant_list WHERE tenant_id = ?';
      const tenantResults = await query(tenantCheckSql, [finalTenantId]);
      if (tenantResults.length === 0) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    const sqlInsert = `
      INSERT INTO stall_list (stall_id, stall_sn, tenant_id, building_id, stall_status, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await query(sqlInsert, [
      newStallId,
      stall_sn,
      finalTenantId,
      building_id,
      stall_status,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Stall created successfully', stallId: newStallId });
  } catch (err) {
    console.error('Error in POST /stalls:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE STALL BY stall_id
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;
  const { stall_sn, tenant_id, building_id, stall_status } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing record
    const sqlGet = 'SELECT * FROM stall_list WHERE stall_id = ?';
    const results = await query(sqlGet, [stallId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Stall not found' });
    }

    const existing = results[0];

    // If stall_sn is being changed, ensure uniqueness
    if (stall_sn && stall_sn !== existing.stall_sn) {
      const snCheck = await query('SELECT stall_id FROM stall_list WHERE stall_sn = ? AND stall_id <> ? LIMIT 1', [stall_sn, stallId]);
      if (snCheck.length > 0) {
        return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
      }
    }

    // Determine final field values
    const finalStallSn = stall_sn || existing.stall_sn;
    let finalTenantId = tenant_id !== undefined ? tenant_id : existing.tenant_id;
    const finalBuildingId = building_id || existing.building_id;
    const finalStallStatus = stall_status || existing.stall_status;

    // If status is "available" → tenant_id must be null
    if (finalStallStatus === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenantCheckSql = 'SELECT tenant_id FROM tenant_list WHERE tenant_id = ?';
      const tenantResults = await query(tenantCheckSql, [finalTenantId]);
      if (tenantResults.length === 0) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    // Perform the update
    const sqlUpdate = `
      UPDATE stall_list
      SET stall_sn = ?, tenant_id = ?, building_id = ?, stall_status = ?, last_updated = ?, updated_by = ?
      WHERE stall_id = ?
    `;

    await query(sqlUpdate, [
      finalStallSn,
      finalTenantId,
      finalBuildingId,
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
    const sqlDelete = 'DELETE FROM stall_list WHERE stall_id = ?';
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
