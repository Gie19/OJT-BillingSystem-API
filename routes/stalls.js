const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const {
  authorizeBuildingParam,
  attachBuildingScope,
  enforceRecordBuilding
} = require('../middleware/authorizeBuilding');

const { Op, literal } = require('sequelize');

const Stall = require('../models/Stall');
const Tenant = require('../models/Tenant');
const Meter = require('../models/Meter');

// All routes require a valid token
router.use(authenticateToken);

/**
 * GET /stalls
 * - admin: all stalls
 * - operator: stalls in their assigned building only
 */
router.get('/',
  authorizeRole('admin', 'operator'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      const stalls = await Stall.findAll({ where: req.buildingWhere() });
      // Return 200 with [] if none
      return res.json(stalls);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /stalls/:id
 * - admin: full access
 * - operator: only if stall.building_id === req.user.building_id
 */
router.get('/:id',
  authorizeRole('admin', 'operator'),
  enforceRecordBuilding(async (req) => {
    const stall = await Stall.findOne({
      where: { stall_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return stall ? stall.building_id : null; // null lets handler 404 if not found
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

/**
 * POST /stalls
 * - admin: can create for any building
 * - operator: can create only within their building (authorizeBuildingParam enforces)
 *   - if body.building_id is omitted, default to operator's building
 * - if stall_status = 'available', tenant_id is forced to NULL
 * - if tenant_id is provided, tenant must exist AND belong to the same building
 */
router.post('/',
  authorizeRole('admin', 'operator'),
  authorizeBuildingParam(),
  async (req, res) => {
    const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
    const { stall_sn, tenant_id, stall_status } = req.body;
    const building_id = req.body.building_id || (!isAdmin ? req.user.building_id : undefined);

    if (!stall_sn || !building_id || !stall_status) {
      return res.status(400).json({ error: 'stall_sn, building_id, and stall_status are required' });
    }

    try {
      // unique stall_sn
      const exists = await Stall.findOne({ where: { stall_sn } });
      if (exists) {
        return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
      }

      // new ID
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

      // tenant checks
      let finalTenantId = tenant_id ?? null;
      if (stall_status === 'available') {
        finalTenantId = null;
      } else if (finalTenantId) {
        const tenant = await Tenant.findOne({
          where: { tenant_id: finalTenantId },
          attributes: ['tenant_id', 'building_id'],
          raw: true
        });
        if (!tenant) {
          return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
        }
        if (tenant.building_id !== building_id) {
          return res.status(400).json({ error: 'Tenant must belong to the same building as the stall.' });
        }
      }

      await Stall.create({
        stall_id: newStallId,
        stall_sn,
        tenant_id: finalTenantId,
        building_id,
        stall_status,
        last_updated: getCurrentDateTime(),
        updated_by: req.user.user_fullname
      });

      res.status(201).json({ message: 'Stall created successfully', stallId: newStallId });
    } catch (err) {
      console.error('Error in POST /stalls:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PUT /stalls/:id
 * - admin: can update anything (including moving building)
 * - operator: only if stall is in their building; cannot change building_id
 * - tenant consistency: if setting tenant_id (and status ≠ 'available'), tenant must exist and be in the (final) building
 */
router.put('/:id',
  authorizeRole('admin', 'operator'),
  enforceRecordBuilding(async (req) => {
    const s = await Stall.findOne({
      where: { stall_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return s?.building_id || null;
  }),
  async (req, res) => {
    const stallId = req.params.id;
    const { stall_sn, tenant_id, building_id, stall_status } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
      const stall = await Stall.findOne({ where: { stall_id: stallId } });
      if (!stall) return res.status(404).json({ error: 'Stall not found' });

      // unique stall_sn if changed
      if (stall_sn && stall_sn !== stall.stall_sn) {
        const exists = await Stall.findOne({
          where: { stall_sn, stall_id: { [Op.ne]: stallId } }
        });
        if (exists) {
          return res.status(409).json({ error: 'stall_sn already exists. Please use a unique stall_sn.' });
        }
      }

      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';

      // Determine final target values
      const finalStallSn = stall_sn ?? stall.stall_sn;
      const finalStallStatus = stall_status ?? stall.stall_status;
      const finalBuildingId = isAdmin ? (building_id ?? stall.building_id) : stall.building_id;

      // Operators are not allowed to change building_id
      if (!isAdmin && building_id && building_id !== stall.building_id) {
        return res.status(403).json({ error: 'No access: cannot move stall to a different building.' });
      }

      // tenant handling
      let finalTenantId = (tenant_id !== undefined) ? tenant_id : stall.tenant_id;
      if (finalStallStatus === 'available') {
        finalTenantId = null;
      } else if (finalTenantId) {
        const tenant = await Tenant.findOne({
          where: { tenant_id: finalTenantId },
          attributes: ['tenant_id', 'building_id'],
          raw: true
        });
        if (!tenant) {
          return res.status(400).json({ error: 'Invalid tenant_id: Tenant does not exist.' });
        }
        if (tenant.building_id !== finalBuildingId) {
          return res.status(400).json({ error: 'Tenant must belong to the same building as the stall.' });
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
  }
);

/**
 * DELETE /stalls/:id
 * - admin: unrestricted
 * - operator: only if stall is in their building
 * - blocks delete if meters still reference this stall
 */
router.delete('/:id',
  authorizeRole('admin', 'operator'),
  enforceRecordBuilding(async (req) => {
    const s = await Stall.findOne({
      where: { stall_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return s?.building_id || null;
  }),
  async (req, res) => {
    const stallId = req.params.id;
    if (!stallId) return res.status(400).json({ error: 'Stall ID is required' });

    try {
      const meters = await Meter.findAll({ where: { stall_id: stallId }, attributes: ['meter_id'] });

      const errors = [];
      if (meters.length) errors.push(`Meter(s): [${meters.map(m => m.meter_id).join(', ')}]`);

      if (errors.length) {
        return res.status(400).json({
          error: `Cannot delete stall. It is still referenced by: ${errors.join('; ')}`
        });
      }

      const deleted = await Stall.destroy({ where: { stall_id: stallId } });
      if (deleted === 0) return res.status(404).json({ error: 'Stall not found' });

      res.json({ message: `Stall with ID ${stallId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /stalls/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
