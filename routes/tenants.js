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


// GET ALL TENANTS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM tenant_list');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET TENANT BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;
  try {
    const results = await query('SELECT * FROM tenant_list WHERE tenant_id = ?', [tenantId]);

    if (results.length === 0) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    res.json(results[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});


// CREATE NEW TENANT
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { tenant_sn, tenant_name, building_id, bill_start } = req.body;

  if (!tenant_sn || !tenant_name || !building_id || !bill_start) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check for duplicate tenant_sn
    const sqlCheckSn = `SELECT tenant_id FROM tenant_list WHERE tenant_sn = ? LIMIT 1`;
    const snResults = await query(sqlCheckSn, [tenant_sn]);
    if (snResults.length > 0) {
      return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
    }
    // Find the highest TNT-numbered id
    const sqlFind = `
      SELECT tenant_id FROM tenant_list
      WHERE tenant_id LIKE 'TNT-%'
      ORDER BY CAST(SUBSTRING(tenant_id, 5) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].tenant_id;
      const lastNumber = parseInt(lastId.slice(4), 10); // 'TNT-' is 4 chars
      nextNumber = lastNumber + 1;
    }

    const newTenantId = `TNT-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user?.user_fullname;

    const sqlInsert = `
      INSERT INTO tenant_list (tenant_id, tenant_sn, tenant_name, building_id, bill_start, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
      newTenantId,
      tenant_sn,
      tenant_name,
      building_id,
      bill_start,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Tenant created successfully', tenantId: newTenantId });
  } catch (err) {
    console.error('Error in POST /tenants:', err);
    res.status(500).json({ error: 'Server error, could not create tenant.' });
  }
});


//UPDATE TENANT BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;
  const { tenant_sn, tenant_name, building_id, bill_start } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing record to support partial updates
    const sqlGet = 'SELECT * FROM tenant_list WHERE tenant_id = ?';
    const results = await query(sqlGet, [tenantId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const existing = results[0];

    // Only check for uniqueness if tenant_sn is being updated and is different
    if (tenant_sn && tenant_sn !== existing.tenant_sn) {
      const sqlCheckSn = `SELECT tenant_id FROM tenant_list WHERE tenant_sn = ? AND tenant_id <> ? LIMIT 1`;
      const snResults = await query(sqlCheckSn, [tenant_sn, tenantId]);
      if (snResults.length > 0) {
        return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
      }
    }

    // Determine final values (use new if given, else old)
    const finalSn = tenant_sn || existing.tenant_sn;
    const finalName = tenant_name || existing.tenant_name;
    const finalBuilding = building_id || existing.building_id;
    const finalBillPeriodStart = bill_start || existing.bill_start;

    // Perform the update
    const sqlUpdate = `
      UPDATE tenant_list
      SET tenant_sn = ?, tenant_name = ?, building_id = ?, bill_start = ?, last_updated = ?, updated_by = ?
      WHERE tenant_id = ?
    `;

    await query(sqlUpdate, [
      finalSn,
      finalName,
      finalBuilding,
      finalBillPeriodStart,
      lastUpdated,
      updatedBy,
      tenantId
    ]);

    res.json({ message: `Tenant with ID ${tenantId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /tenants/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

//DELETE TENANT BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID is required' });
  }

  try {
    const sqlDelete = 'DELETE FROM tenant_list WHERE tenant_id = ?';
    const result = await query(sqlDelete, [tenantId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    res.json({ message: `Tenant with ID ${tenantId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /tenants/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
