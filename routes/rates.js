const express = require('express');
const router = express.Router();

const { Op, literal } = require('sequelize');

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');
const {
  authorizeBuildingParam,
  enforceRecordBuilding
} = require('../middleware/authorizeBuilding');

const Tenant = require('../models/Tenant');
const Rate = require('../models/Rate');

// All routes require login
router.use(authenticateToken);

/** helper: limit editable fields to biller’s allowed utilities */
function filterRateFieldsByUtility(reqBody, userUtilities) {
  const map = {
    electric: ['erate_perKwH', 'e_vat', 'emin_con'],
    water:    ['wrate_perCbM', 'w_vat', 'wnet_vat', 'wmin_con'],
    lpg:      ['lrate_perKg'],
  };
  const allowed = new Set();
  (userUtilities || []).forEach(u => (map[u] || []).forEach(f => allowed.add(f)));

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
        attributes: ['tenant_id', 'tenant_name'],
        raw: true
      });
      if (!tenants.length) return res.json([]);

      const tIds = tenants.map(t => t.tenant_id);
      const rates = await Rate.findAll({ where: { tenant_id: tIds } });

      // optional join-like response
      const tenantMap = Object.fromEntries(tenants.map(t => [t.tenant_id, t.tenant_name]));
      const payload = rates.map(r => ({
        ...r.toJSON(),
        tenant_name: tenantMap[r.tenant_id] || null
      }));

      res.json(payload);
    } catch (err) {
      console.error('GET /rates/buildings/:building_id error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** GET a tenant’s rate (admin | biller in-building) */
router.get(
  '/buildings/:building_id/tenants/:tenant_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  enforceRecordBuilding(async (req) => {
    const t = await Tenant.findOne({
      where: { tenant_id: req.params.tenant_id },
      attributes: ['building_id'],
      raw: true
    });
    return t?.building_id || null;
  }),
  async (req, res) => {
    try {
      const rate = await Rate.findOne({ where: { tenant_id: req.params.tenant_id } });
      if (!rate) return res.status(404).json({ message: 'No rate found for this tenant.' });
      res.json(rate);
    } catch (err) {
      console.error('GET tenant rate error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** PUT create/update a tenant’s rate (admin | biller in-building + utility scope) */
router.put(
  '/buildings/:building_id/tenants/:tenant_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  authorizeUtilityRole({ roles: ['biller'], anyOf: ['electric', 'water', 'lpg'], requireAll: false }),
  enforceRecordBuilding(async (req) => {
    const t = await Tenant.findOne({
      where: { tenant_id: req.params.tenant_id },
      attributes: ['building_id'],
      raw: true
    });
    return t?.building_id || null;
  }),
  async (req, res) => {
    try {
      const tenantId = req.params.tenant_id;

      // Pull only fields allowed for this biller’s utilities
      const userUtils = Array.isArray(req.user.utility_role)
        ? req.user.utility_role.map(s => String(s).toLowerCase())
        : [];
      const allowedBody = filterRateFieldsByUtility(req.body, userUtils);

      if (Object.keys(allowedBody).length === 0 && (req.user.user_level || '').toLowerCase() !== 'admin') {
        return res.status(400).json({ error: 'No permitted rate fields to update for your utility access.' });
      }

      let rate = await Rate.findOne({ where: { tenant_id: tenantId } });
      const now = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      if (!rate) {
        // create new rate row with generated rate_id
        const last = await Rate.findOne({
          where: { rate_id: { [Op.like]: 'RATE-%' } },
          order: [[literal("CAST(SUBSTRING(rate_id, 6) AS UNSIGNED)"), 'DESC']],
          raw: true,
        });
        let nextNum = 1;
        if (last) {
          const n = parseInt(String(last.rate_id).slice(5), 10);
          if (!isNaN(n)) nextNum = n + 1;
        }
        const newRateId = `RATE-${nextNum}`;

        // Admin may set any field; biller restricted to allowedBody
        const toCreate = {
          rate_id: newRateId,
          tenant_id: tenantId,
          last_updated: now,
          updated_by: updatedBy,
          ...( (req.user.user_level || '').toLowerCase() === 'admin' ? req.body : allowedBody )
        };
        rate = await Rate.create(toCreate);
        return res.status(201).json({ message: 'Rate created for tenant', rate_id: newRateId });
      }

      const toUpdate = {
        last_updated: now,
        updated_by: updatedBy,
        ...( (req.user.user_level || '').toLowerCase() === 'admin' ? req.body : allowedBody )
      };
      await rate.update(toUpdate);

      res.json({ message: 'Rate updated for tenant', rate_id: rate.rate_id });
    } catch (err) {
      console.error('PUT tenant rate error:', err);
      if (err?.original?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'This tenant already has a rate.' });
      }
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/** DELETE a tenant’s rate (admin | biller in-building) */
router.delete(
  '/buildings/:building_id/tenants/:tenant_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  enforceRecordBuilding(async (req) => {
    const t = await Tenant.findOne({
      where: { tenant_id: req.params.tenant_id },
      attributes: ['building_id'],
      raw: true
    });
    return t?.building_id || null;
  }),
  async (req, res) => {
    try {
      const deleted = await Rate.destroy({ where: { tenant_id: req.params.tenant_id } });
      if (deleted === 0) return res.status(404).json({ error: 'No rate found for this tenant.' });
      res.json({ message: 'Tenant rate deleted' });
    } catch (err) {
      console.error('DELETE tenant rate error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
