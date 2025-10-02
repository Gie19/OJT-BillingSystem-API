const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

const { Op } = require('sequelize');

// Models
const Tenant = require('../models/Tenant');

router.use(authenticateToken);

/** GET tenants by building */
router.get('/buildings/:building_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const rows = await Tenant.findAll({ where: { building_id: req.params.building_id } });
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** CREATE tenant */
router.post('/',
  authorizeRole('admin'),
  async (req, res) => {
    try {
      const { tenant_sn, tenant_name, building_id, bill_start } = req.body || {};
      if (!tenant_sn || !tenant_name || !building_id || !bill_start) {
        return res.status(400).json({ error: 'tenant_sn, tenant_name, building_id, bill_start are required' });
      }

      // Generate TNT-<n> (cross-dialect; MSSQL-safe)
      const rows = await Tenant.findAll({
        where: { tenant_id: { [Op.like]: 'TNT-%' } },
        attributes: ['tenant_id'],
        raw: true
      });
      const maxNum = rows.reduce((max, r) => {
        const m = String(r.tenant_id).match(/^TNT-(\d+)$/);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const newTenantId = `TNT-${maxNum + 1}`;

      const created = await Tenant.create({
        tenant_id: newTenantId,
        tenant_sn,
        tenant_name,
        building_id,
        bill_start,
        tenant_status: 'active',
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.status(201).json(created);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** UPDATE tenant (name/status) */
router.put('/:tenant_id',
  authorizeRole('admin'),
  async (req, res) => {
    try {
      const tenant = await Tenant.findByPk(req.params.tenant_id);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const { tenant_name, tenant_status } = req.body || {};
      const updates = {};
      if (tenant_name) updates.tenant_name = tenant_name;
      if (tenant_status) updates.tenant_status = tenant_status;

      updates.last_updated = getCurrentDateTime();
      updates.updated_by = req.user?.user_fullname || 'system';

      await tenant.update(updates);
      res.json(tenant);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

module.exports = router;
