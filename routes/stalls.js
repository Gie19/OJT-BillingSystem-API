const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { attachBuildingScope, enforceRecordBuilding } = require('../middleware/authorizeBuilding');

const { Op, literal } = require('sequelize');

const Stall = require('../models/Stall');
const Tenant = require('../models/Tenant');
const Meter = require('../models/Meter');

// All routes below require valid token
router.use(authenticateToken);

/**
 * GET ALL STALLS
 * - Admins: return all stalls
 * - Employees: only stalls in their assigned building_id
 * - If none visible, return 403 with message
 */
router.get('/',
  authorizeRole('admin','employee'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      const where = req.buildingWhere ? req.buildingWhere() : {};
      const stalls = await Stall.findAll({ where });

      if (!stalls.length && req.restrictToBuildingId) {
        return res.status(403).json({
          error: 'No access: There are no stalls under your assigned building.'
        });
      }

      res.json(stalls);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET STALL BY ID
 * - Admins: full access
 * - Employees: only if stall.building_id === req.user.building_id
 * - If exists but not in building → 403 with message
 */
router.get('/:id',
  authorizeRole('admin','employee'),
  enforceRecordBuilding(async (req) => {
    const stall = await Stall.findOne({
      where: { stall_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return stall ? stall.building_id : null;
  }),
  async (req, res) => {
    try {
      const stall = await Stall.findOne({ where: { stall_id: req.params.id } });
      if (!stall) return res.status(404).json({ message: 'Stall not found' });
      res.json(stall);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// CREATE NEW STALL (kept your roles)
router.post('/', authorizeRole('admin','employee'), async (req, res) => {
  const { stall_sn, tenant_id, building_id, stall_status } = req.body;

  if (!stall_sn || !building_id || !stall_status) {
    return res.status(400).json({ error: 'stall_sn, building_id, and stall_status are required' });
  }

  try {
    const exists = await Stall.findOne({ where: { stall_sn } });
    if (exists) {
      return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
    }

    const lastStall = await Stall.findOne({
      where: { stall_id: { [Op.like]: 'STL-%' } },
      order: [[literal("CAST(SUBSTRING(stall_id, 5) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastStall) {
      const lastNumber = parseInt(lastStall.stall_id.slice(4), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newStallId = `STL-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    let finalTenantId = tenant_id;
    if (stall_status === 'available') {
      finalTenantId = null;
    }

    if (finalTenantId) {
      const tenant = await Tenant.findOne({ where: { tenant_id: finalTenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

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

// UPDATE STALL BY ID (admin)
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;
  const { stall_sn, tenant_id, building_id, stall_status } = req.body;
  const updatedBy = req.user.user_fullname;
  const lastUpdated = getCurrentDateTime();

  try {
    const stall = await Stall.findOne({ where: { stall_id: stallId } });
    if (!stall) {
      return res.status(404).json({ error: 'Stall not found' });
    }

    if (stall_sn && stall_sn !== stall.stall_sn) {
      const exists = await Stall.findOne({
        where: { stall_sn, stall_id: { [Op.ne]: stallId } }
      });
      if (exists) {
        return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
      }
    }

    const finalStallSn = stall_sn || stall.stall_sn;
    let finalTenantId = tenant_id !== undefined ? tenant_id : stall.tenant_id;
    const finalBuildingId = building_id || stall.building_id;
    const finalStallStatus = stall_status || stall.stall_status;

    if (finalStallStatus === 'available') {
      finalTenantId = null;
    }

    if (finalTenantId) {
      const tenant = await Tenant.findOne({ where: { tenant_id: finalTenantId } });
      if (!tenant) {
        return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
      }
    }

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

// DELETE STALL BY ID (admin) with dependency check
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const stallId = req.params.id;

  if (!stallId) {
    return res.status(400).json({ error: 'Stall ID is required' });
  }

  try {
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
