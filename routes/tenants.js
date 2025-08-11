const express = require('express');
const router = express.Router();

//Import utilities and middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

//Import for sequelize operations
const { Op, literal } = require('sequelize');

//Imported models
const Tenant = require('../models/Tenant');
const Stall = require('../models/Stall');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL TENANTS
router.get('/', authorizeRole('admin','employee'), async (req, res) => {
  try {
    const tenants = await Tenant.findAll();
    res.json(tenants);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET TENANT BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ where: { tenant_id: req.params.id } });
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }
    res.json(tenant);
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
    const exists = await Tenant.findOne({ where: { tenant_sn } });
    if (exists) {
      return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
    }

    // Find highest TNT-numbered id
    const lastTenant = await Tenant.findOne({
      where: { tenant_id: { [Op.like]: 'TNT-%' } },
      order: [[literal("CAST(SUBSTRING(tenant_id, 5) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastTenant) {
      const lastNumber = parseInt(lastTenant.tenant_id.slice(4), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newTenantId = `TNT-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user?.user_fullname;

    // Create new tenant
    await Tenant.create({
      tenant_id: newTenantId,
      tenant_sn,
      tenant_name,
      building_id,
      bill_start,
      last_updated: today,
      updated_by: updatedBy,
    });

    res.status(201).json({ message: 'Tenant created successfully', tenantId: newTenantId });
  } catch (err) {
    console.error('Error in POST /tenants:', err);
    res.status(500).json({ error: 'Server error, could not create tenant.' });
  }
});

// UPDATE TENANT BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;
  const { tenant_sn, tenant_name, building_id, bill_start } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    // Fetch existing record to support partial updates
    const tenant = await Tenant.findOne({ where: { tenant_id: tenantId } });
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Only check for uniqueness if tenant_sn is being updated and is different
    if (tenant_sn && tenant_sn !== tenant.tenant_sn) {
      const snExists = await Tenant.findOne({
        where: {
          tenant_sn,
          tenant_id: { [Op.ne]: tenantId }
        }
      });
      if (snExists) {
        return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
      }
    }

    // Update
    await tenant.update({
      tenant_sn: tenant_sn || tenant.tenant_sn,
      tenant_name: tenant_name || tenant.tenant_name,
      building_id: building_id || tenant.building_id,
      bill_start: bill_start || tenant.bill_start,
      last_updated: lastUpdated,
      updated_by: updatedBy,
    });

    res.json({ message: `Tenant with ID ${tenantId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /tenants/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE TENANT BY ID with dependency checks
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const tenantId = req.params.id;
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID is required' });
  }
  try {
    const stalls = await Stall.findAll({ where: { tenant_id: tenantId }, attributes: ['stall_id'] });

    let errors = [];
    if (stalls.length) errors.push(`Stall(s): [${stalls.map(stall => stall.stall_id).join(', ')}]`);

    if (errors.length) {
      return res.status(400).json({
        error: `Cannot delete tenant. It is still referenced by: ${errors.join('; ')}`
      });
    }

    const deleted = await Tenant.destroy({ where: { tenant_id: tenantId } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    res.json({ message: `Tenant with ID ${tenantId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /tenants/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
