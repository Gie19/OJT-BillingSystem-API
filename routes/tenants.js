// routes/tenants.js
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

// Models
const Tenant = require('../models/Tenant');
const Stall  = require('../models/Stall');
const Rate   = require('../models/Rate');

// Sequelize instance for transactions
const sequelize = require('../models/index');

// All routes require a valid token
router.use(authenticateToken);

// Allowed status enum (must match your model/migration)
const ALLOWED_STATUS = new Set(['active', 'inactive']);

/**
 * GET ALL TENANTS
 * - admin: all
 * - operator/biller: only their building (via attachBuildingScope)
 * - supports filter: ?status=active|inactive
 */
router.get('/',
  authorizeRole('admin', 'operator', 'biller'),
  attachBuildingScope(),
  async (req, res) => {
    try {
      const where = req.buildingWhere();
      const qStatus = (req.query.status || '').toLowerCase();

      if (qStatus) {
        if (!ALLOWED_STATUS.has(qStatus)) {
          return res.status(400).json({ error: "Invalid status. Use 'active' or 'inactive'." });
        }
        where.tenant_status = qStatus;
      }

      const tenants = await Tenant.findAll({ where });
      return res.json(tenants);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET TENANT BY ID
 * - admin: full access
 * - operator/biller: only if tenant.building_id === req.user.building_id
 */
router.get('/:id',
  authorizeRole('admin', 'operator', 'biller'),
  enforceRecordBuilding(async (req) => {
    const tenant = await Tenant.findOne({
      where: { tenant_id: req.params.id },
      attributes: ['building_id'],
      raw: true
    });
    return tenant ? tenant.building_id : null;
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
 * CREATE TENANT
 * - admin: any building
 * - operator: only within their building (authorizeBuildingParam)
 * - accepts optional tenant_status (default 'active')
 */
router.post('/',
  authorizeRole('admin', 'operator'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
      const {
        tenant_sn,
        tenant_name,
        bill_start,
        tenant_status
      } = req.body;

      const building_id = req.body.building_id || (!isAdmin ? req.user.building_id : undefined);

      if (!tenant_sn || !tenant_name || !building_id || !bill_start) {
        return res.status(400).json({ error: 'tenant_sn, tenant_name, building_id, bill_start are required' });
      }

      // validate status (if provided)
      const finalStatus = (tenant_status || 'active').toLowerCase();
      if (!ALLOWED_STATUS.has(finalStatus)) {
        return res.status(400).json({ error: "Invalid tenant_status. Use 'active' or 'inactive'." });
      }

      // unique tenant_sn
      const dup = await Tenant.findOne({ where: { tenant_sn } });
      if (dup) return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });

      // generate TNT-<n>
      const lastTenant = await Tenant.findOne({
        where: { tenant_id: { [Op.like]: 'TNT-%' } },
        order: [[literal("CAST(SUBSTRING(tenant_id, 5) AS UNSIGNED)"), "DESC"]],
      });
      let nextNumber = 1;
      if (lastTenant) {
        const n = parseInt(String(lastTenant.tenant_id).slice(4), 10);
        if (!isNaN(n)) nextNumber = n + 1;
      }
      const newTenantId = `TNT-${nextNumber}`;

      await Tenant.create({
        tenant_id: newTenantId,
        tenant_sn,
        tenant_name,
        building_id,
        bill_start,
        tenant_status: finalStatus,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname
      });

      res.status(201).json({ message: 'Tenant created successfully', tenantId: newTenantId });
    } catch (err) {
      console.error('Error in POST /tenants:', err);
      res.status(500).json({ error: 'Server error, could not create tenant.' });
    }
  }
);

/**
 * UPDATE TENANT
 * - admin: unrestricted
 * - operator: only if tenant is in their building; cannot move tenant to another building
 * - if tenant_status changes to 'inactive', free all occupied stalls for that tenant:
 *     - set stall_status = 'available'
 *     - set tenant_id = null
 *     - stamp last_updated / updated_by
 *   (done inside a single transaction)
 */
router.put('/:id',
  authorizeRole('admin', 'operator'),
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
    const {
      tenant_sn,
      tenant_name,
      building_id,
      bill_start,
      tenant_status
    } = req.body;

    const isAdmin = (req.user?.user_level || '').toLowerCase() === 'admin';
    const updatedBy = req.user.user_fullname;
    const now = getCurrentDateTime();

    const tx = await sequelize.transaction();
    try {
      const tenant = await Tenant.findOne({ where: { tenant_id: tenantId }, transaction: tx });
      if (!tenant) {
        await tx.rollback();
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // unique tenant_sn if changed
      if (tenant_sn && tenant_sn !== tenant.tenant_sn) {
        const snExists = await Tenant.findOne({
          where: { tenant_sn, tenant_id: { [Op.ne]: tenantId } },
          transaction: tx
        });
        if (snExists) {
          await tx.rollback();
          return res.status(409).json({ error: 'Tenant SN already exists. Please use a unique tenant SN.' });
        }
      }

      // operators cannot move tenant to another building
      if (!isAdmin && building_id && building_id !== tenant.building_id) {
        await tx.rollback();
        return res.status(403).json({ error: 'No access: cannot move tenant to a different building.' });
      }

      // validate status if provided and detect state change
      let finalStatus = tenant.tenant_status;
      if (tenant_status !== undefined) {
        const s = String(tenant_status).toLowerCase();
        if (!ALLOWED_STATUS.has(s)) {
          await tx.rollback();
          return res.status(400).json({ error: "Invalid tenant_status. Use 'active' or 'inactive'." });
        }
        finalStatus = s;
      }
      const becameInactive = tenant.tenant_status !== 'inactive' && finalStatus === 'inactive';

      // update tenant
      await tenant.update({
        tenant_sn: tenant_sn ?? tenant.tenant_sn,
        tenant_name: tenant_name ?? tenant.tenant_name,
        building_id: isAdmin ? (building_id ?? tenant.building_id) : tenant.building_id,
        bill_start: bill_start ?? tenant.bill_start,
        tenant_status: finalStatus,
        last_updated: now,
        updated_by: updatedBy,
      }, { transaction: tx });

      // cascade: free stalls if tenant became inactive
      let freedCount = 0;
      if (becameInactive) {
        const [affected] = await Stall.update({
          tenant_id: null,
          stall_status: 'available',
          last_updated: now,
          updated_by: updatedBy
        }, {
          where: { tenant_id: tenantId },
          transaction: tx
        });
        freedCount = affected || 0;
      }

      await tx.commit();
      return res.json({
        message: `Tenant with ID ${tenantId} updated successfully`,
        ...(becameInactive ? { stalls_freed: freedCount } : {})
      });
    } catch (err) {
      await tx.rollback();
      console.error('Error in PUT /tenants/:id:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE TENANT
 * - admin: unrestricted
 * - operator: only if tenant is in their building
 * - blocks delete if stalls still reference the tenant or if a rate row exists
 */
router.delete('/:id',
  authorizeRole('admin', 'operator'),
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
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    try {
      const [stalls, rate] = await Promise.all([
        Stall.findAll({ where: { tenant_id: tenantId }, attributes: ['stall_id'] }),
        Rate.findOne({ where: { tenant_id: tenantId }, attributes: ['rate_id'] }),
      ]);

      const blockers = [];
      if (stalls.length) blockers.push(`Stall(s): [${stalls.map(s => s.stall_id).join(', ')}]`);
      if (rate) blockers.push(`Rate: [${rate.rate_id}]`);

      if (blockers.length) {
        return res.status(400).json({
          error: `Cannot delete tenant. It is still referenced by: ${blockers.join('; ')}`
        });
      }

      const deleted = await Tenant.destroy({ where: { tenant_id: tenantId } });
      if (deleted === 0) return res.status(404).json({ error: 'Tenant not found' });

      res.json({ message: `Tenant with ID ${tenantId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /tenants/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
