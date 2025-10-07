// routes/rates.js
const express = require('express');
const router = express.Router();

const { Op } = require('sequelize');

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

/** helper: limit editable fields to biller’s allowed utilities (Rate-level only) */
function filterRateFieldsByUtility(reqBody, userUtilities) {
  // With the current model, Rate exposes tenant-specific VAT/net fields
  const map = {
    electric: ['e_vat'],
    water:    ['wnet_vat', 'w_vat'],
    lpg:      [] // no rate-level fields for LPG
  };
  const allowed = new Set();
  (userUtilities || []).forEach(u => (map[u] || []).forEach(f => allowed.add(f)));

  // Build filtered object from req body
  const out = {};
  for (const [k, v] of Object.entries(reqBody || {})) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

/** helper: coerce numeric VAT fields to DECIMAL(10,2)-friendly numbers */
function coerceNumericFields(obj) {
  const keys = ['e_vat', 'wnet_vat', 'w_vat'];
  const out = { ...obj };
  for (const k of keys) {
    if (out[k] !== undefined) {
      const n = Number(out[k]);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${k} must be a non-negative number` };
      }
      out[k] = Math.round(n * 100) / 100;
    }
  }
  return { ok: true, data: out };
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
      const rates = await Rate.findAll({ where: { tenant_id: { [Op.in]: tIds } } });

      // join-like response (optional)
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

/**
 * PUT (create/update) a tenant's rate via URL params
 * Path: /rates/buildings/:building_id/tenants/:tenant_id
 */
router.put(
  '/buildings/:building_id/tenants/:tenant_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),  // non-admin must match :building_id
  authorizeUtilityRole({ roles: ['biller'], anyOf: ['electric','water','lpg'], requireAll: false }),
  enforceRecordBuilding(async (req) => {
    // ensure the tenant truly belongs to the path building
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

      // Admin can touch any rate fields; biller limited by utility_role
      const isAdmin = (req.user.user_level || '').toLowerCase() === 'admin';
      const userUtils = Array.isArray(req.user.utility_role)
        ? req.user.utility_role.map(s => String(s).toLowerCase())
        : [];

      const candidate = isAdmin ? (req.body || {}) : filterRateFieldsByUtility(req.body, userUtils);
      if (!isAdmin && Object.keys(candidate).length === 0) {
        return res.status(400).json({ error: 'No permitted rate fields to update for your utility access.' });
      }

      // numeric coercion/validation
      const coerced = coerceNumericFields(candidate);
      if (!coerced.ok) return res.status(400).json({ error: coerced.error });
      const updates = coerced.data;

      // Upsert by tenant_id
      let rate = await Rate.findOne({ where: { tenant_id: tenantId } });
      const now = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      if (!rate) {
        // Generate RATE-<n> (cross-dialect; scan + increment)
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
          tenant_id: tenantId,
          last_updated: now,
          updated_by: updatedBy,
          ...updates
        });

        return res.status(201).json({ message: 'Rate created for tenant', rate_id: newRateId });
      }

      await rate.update({
        last_updated: now,
        updated_by: updatedBy,
        ...updates
      });

      res.json({ message: 'Rate updated for tenant', rate_id: rate.rate_id });
    } catch (err) {
      console.error('PUT tenant rate (param) error:', err);
      res.status(500).json({ error: err.message });
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
