const express = require('express');
const router = express.Router();

//Import utilities and middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');


//Import for sequelize operations
const { Op, literal } = require('sequelize');

//Imported models
const Stall = require('../models/Stall');
const Tenant = require('../models/Tenant');
const Meter = require('../models/Meter');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL STALLS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const stalls = await Stall.findAll();
    res.json(stalls);
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
    const exists = await Stall.findOne({ where: { stall_sn } });
    if (exists) {
      return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
    }

    // Generate custom STL- ID (stall_id)
    const lastStall = await Stall.findOne({
      where: { stall_id: { [Op.like]: 'STL-%' } },
      order: [[literal("CAST(SUBSTRING(stall_id, 5) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastStall) {
      const lastNumber = parseInt(lastStall.stall_id.slice(4), 10); // skip 'STL-'
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newStallId = `STL-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    // tenant_id is nullable if status is 'available'
    let finalTenantId = tenant_id;
    if (stall_status === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenant = await Tenant.findOne({ where: { tenant_id: finalTenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    // Create new stall
    await Stall.create({
      stall_id: newStallId,
      stall_sn,
      tenant_id: finalTenantId,
      building_id,
      stall_status,
      last_updated: today,
      updated_by: updatedBy
    });

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
    const stall = await Stall.findOne({ where: { stall_id: stallId } });

    if (!stall) {
      return res.status(404).json({ error: 'Stall not found' });
    }

    // If stall_sn is being changed, ensure uniqueness
    if (stall_sn && stall_sn !== stall.stall_sn) {
      const exists = await Stall.findOne({
        where: {
          stall_sn,
          stall_id: { [Op.ne]: stallId }
        }
      });
      if (exists) {
        return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
      }
    }

    // Determine final field values
    const finalStallSn = stall_sn || stall.stall_sn;
    let finalTenantId = tenant_id !== undefined ? tenant_id : stall.tenant_id;
    const finalBuildingId = building_id || stall.building_id;
    const finalStallStatus = stall_status || stall.stall_status;

    // If status is "available" → tenant_id must be null
    if (finalStallStatus === 'available') {
      finalTenantId = null;
    }

    // If there's a tenant_id, validate it exists
    if (finalTenantId) {
      const tenant = await Tenant.findOne({ where: { tenant_id: finalTenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

    // Update
    await stall.update({
      stall_sn: finalStallSn,
      tenant_id: finalTenantId,
      building_id: finalBuildingId,
      stall_status: finalStallStatus,
      last_updated: lastUpdated,
      updated_by: updatedBy
    });

    res.json({ message: `Stall with ID ${stallId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /stalls/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE STALL BY ID with dependency check
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;

  if (!stallId) {
    return res.status(400).json({ error: 'Stall ID is required' });
  }

  try {
    // Check if the stall_id is being used in Meter
    const meters = await Meter.findAll({ where: { stall_id: stallId }, attributes: ['meter_id'] });

    let errors = [];
    if (meters.length) errors.push(`Meter(s): [${meters.map(m => m.meter_id).join(', ')}]`);

    if (errors.length) {
      return res.status(400).json({
        error: `Cannot delete stall. It is still referenced by: ${errors.join('; ')}`
      });
    }

    const deleted = await Stall.destroy({ where: { stall_id: stallId } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'Stall not found' });
    }
    res.json({ message: `Stall with ID ${stallId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /stalls/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
