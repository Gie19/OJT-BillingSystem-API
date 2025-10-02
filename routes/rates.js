const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

// Sequelize
const { Op } = require('sequelize');

// Models
const Tenant = require('../models/Tenant');
const Rate = require('../models/Rate');

router.use(authenticateToken);

/** Helper: restrict which fields biller can touch based on utility */
function filterRateFieldsByUtility(reqBody, utilityRole) {
  const map = {
    electric: ['e_vat'],
    water:    ['wnet_vat', 'w_vat'],
  };
  const allowed = new Set();
  (utilityRole || []).forEach(u => (map[u] || []).forEach(f => allowed.add(f)));
  const out = {};
  for (const [k, v] of Object.entries(reqBody || {})) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

/** GET all rates for a building (admin or biller scoped to their building) */
router.get(
  '/buildings/:building_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(), // non-admin must match :building_id
  async (req, res) => {
    try {
      // find all tenants in that building, then their rate rows
      const tenants = await Tenant.findAll({
        where: { building_id: req.params.building_id },
        attributes: ['tenant_id']
      });
      const ids = tenants.map(t => t.tenant_id);
      const rates = await Rate.findAll({ where: { tenant_id: { [Op.in]: ids } } });
      res.json(rates);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** UPSERT a tenant's rate (admin or biller for their building) */
router.put(
  '/buildings/:building_id/tenants/:tenant_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(), // non-admin must match :building_id
  async (req, res) => {
    try {
      const { tenant_id } = req.params;
      const tenant = await Tenant.findByPk(tenant_id);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      if (tenant.building_id !== req.params.building_id) {
        return res.status(403).json({ error: 'Tenant does not belong to this building' });
      }

      let updates = {};
      if (req.user.user_level === 'biller') {
        updates = filterRateFieldsByUtility(req.body, req.user.utility_role || []);
        if (Object.keys(updates).length === 0) {
          return res.status(403).json({ error: 'No allowed rate fields to update for your utilities' });
        }
      } else {
        updates = req.body || {};
      }

      const found = await Rate.findOne({ where: { tenant_id } });

      // Create if not exists
      if (!found) {
        // Generate RATE-<n>
        const rows = await Rate.findAll({
          where: { rate_id: { [Op.like]: 'RATE-%' } },
          attributes: ['rate_id'],
          raw: true,
        });
        const maxNum = rows.reduce((max, r) => {
          const m = String(r.rate_id).match(/^RATE-(\d+)$/);
          return m ? Math.max(max, Number(m[1])) : max;
        }, 0);
        const newRateId = `RATE-${maxNum + 1}`;

        await Rate.create({
          rate_id: newRateId,
          tenant_id: tenant_id,
          last_updated: getCurrentDateTime(),
          updated_by: req.user?.user_fullname || 'system',
          ...updates,
        });
        const created = await Rate.findOne({ where: { tenant_id } });
        return res.status(201).json(created);
      }

      // Update existing
      await found.update({
        ...updates,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.json(found);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

module.exports = router;
