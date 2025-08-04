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



//CREATE NEW TENANT
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { tenant_id, tenant_name, bill_start, bill_end } = req.body;

  if (!tenant_id || !tenant_name || !bill_start || !bill_end) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Fix: get the highest existing number
    const sqlFind = `
      SELECT id FROM tenants
      WHERE id LIKE 'T%'
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

    const newId = `T${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const sqlInsert = `
      INSERT INTO tenants (id, tenant_id, tenant_name, bill_start, bill_end, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [newId, tenant_id, tenant_name, bill_start, bill_end, today, updatedBy]);

    res.status(201).json({ message: 'Tenant created successfully', tenantId: newId });
  } catch (err) {
    console.error('Error in POST /tenants:', err);
    res.status(500).json({ error: err.message });
  }
});


//UPDATE TENANT BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;
  const { tenant_id, tenant_name, bill_start, bill_end } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

   try {
    // Fetch existing record to support partial updates
    const sqlGet = 'SELECT * FROM tenants WHERE id = ?';
    const results = await query(sqlGet, [tenantId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const existing = results[0];

    // Determine final values (use new if given, else old)
    const finalId = tenant_id || existing.tenant_id;
    const finalName = tenant_name || existing.tenant_name;
    const finalBillStart = bill_start || existing.bill_start;
    const finalBillEnd = bill_end || existing.bill_end;

    // Perform the update
    const sqlUpdate = `
      UPDATE tenants
      SET tenant_id = ?, tenant_name = ?, bill_start = ?, bill_end = ?, last_updated = ?, updated_by = ?
      WHERE id = ?
    `;

    await query(sqlUpdate, [
        finalId,
        finalName,
        finalBillStart,
        finalBillEnd,
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
    const sqlDelete = 'DELETE FROM tenants WHERE id = ?';
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
