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

const Tenant = require('../models/Tenant');
const Stall = require('../models/Stall');

// All routes below require valid token
router.use(authenticateToken);

/**
 * GET ALL TENANTS
 * - Admins: return all tenants
 * - Operators: only tenants in their assigned building_id
 * - If none visible for operator, return 403 with message
 */
router.get('/',
  authorizeRole('admin','operator'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      const where = req.buildingWhere ? req.buildingWhere() : {};
      const tenants = await Tenant.findAll({ where });

      if (!tenants.length && req.restrictToBuildingId) {
        return res.status(403).json({
          error: 'No access: There are no tenants under your assigned building.'
        });
      }

      res.json(tenants);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET TENANT BY ID
 * - Admins: full access
 * - Operators: only if tenant.building_id === req.user.building_id
 */
router.get('/:id',
  authorizeRole('admin','operator'),
  enforceRecordBuilding(async (req) => {
    const tenant = await Tenant.findOne({
      where: { tenant_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return tenant ? tenant.building_id : null; // null lets handler 404 if not found
  }),
  async (req, res) => {
    try {
      const tenant = await Tenant.findOne({ where: { tenant_id: req.params.id } });
      if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
      res.json(tenant);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * CREATE NEW TENANT
 * - Admins: unrestricted
 * - Operators: must stay within their building (checked via authorizeBuildingParam)
 *   If body.building_id is omitted, default to req.user.building_id
 */
router.post('/',
  authorizeRole('admin','operator'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
      const {
        tenant_sn,
        tenant_name,
        bill_start
      } = req.body;
      // Compute building_id: operators may omit and we default to their building
      const building_id = req.body.building_id || (!isAdmin ? req.user.building_id : undefined);

      if (!tenant_sn || !tenant_name || !building_id || !bill_start) {
        return res.status(400).json({ error: 'tenant_sn, tenant_name, building_id, bill_start are required' });
      }

      // Ensure unique tenant_sn
      const exists = await Tenant.findOne({ where: { tenant_sn } });
      if (exists) {
        return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
      }

      // Generate new tenant_id (TNT-<n>)
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
  }
);

/**
 * UPDATE TENANT BY ID
 * - Admins: unrestricted
 * - Operators: only if tenant is in their building; cannot move tenant to another building
 */
router.put('/:id',
  authorizeRole('admin','operator'),
  enforceRecordBuilding(async (req) => {
    const t = await Tenant.findOne({
      where: { tenant_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return t?.building_id || null;
  }),
  async (req, res) => {
    const tenantId = req.params.id;
    const { tenant_sn, tenant_name, building_id, bill_start } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
      const tenant = await Tenant.findOne({ where: { tenant_id: tenantId } });
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // tenant_sn uniqueness (if changed)
      if (tenant_sn && tenant_sn !== tenant.tenant_sn) {
        const snExists = await Tenant.findOne({
          where: { tenant_sn, tenant_id: { [Op.ne]: tenantId } }
        });
        if (snExists) {
          return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
        }
      }

      // Operators cannot move tenant to another building
      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
      if (!isAdmin && building_id && building_id !== tenant.building_id) {
        return res.status(403).json({ error: 'No access: cannot move tenant to a different building.' });
      }

      await tenant.update({
        tenant_sn: tenant_sn ?? tenant.tenant_sn,
        tenant_name: tenant_name ?? tenant.tenant_name,
        building_id: isAdmin ? (building_id ?? tenant.building_id) : tenant.building_id,
        bill_start: bill_start ?? tenant.bill_start,
        last_updated: lastUpdated,
        updated_by: updatedBy,
      });

      res.json({ message: `Tenant with ID ${tenantId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /tenants/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE TENANT BY ID
 * - Admins: unrestricted
 * - Operators: only if tenant is in their building
 * - Blocks delete if there are referencing stalls
 */
router.delete('/:id',
  authorizeRole('admin','operator'),
  enforceRecordBuilding(async (req) => {
    const t = await Tenant.findOne({
      where: { tenant_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return t?.building_id || null;
  }),
  async (req, res) => {
    const tenantId = req.params.id;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID is required' });
    }
    try {
      const stalls = await Stall.findAll({ where: { tenant_id: tenantId }, attributes: ['stall_id'] });

      const errors = [];
      if (stalls.length) errors.push(`Stall(s): [${stalls.map(s => s.stall_id).join(', ')}]`);

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
  }
);

module.exports = router;
