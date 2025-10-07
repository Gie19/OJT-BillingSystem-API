// routes/buildings.js
const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

// Sequelize helpers
const { Op } = require('sequelize');

// Models
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Stall = require('../models/Stall');
const Building = require('../models/Building');

// All routes below require a valid token
router.use(authenticateToken);

// ---------- helpers ----------

const NUM_FIELDS = ['erate_perKwH', 'emin_con', 'wrate_perCbM', 'wmin_con', 'lrate_perKg'];

// map common variations -> canonical keys
const KEY_MAP = new Map([
  // electric rate + min
  ['erate_perkwh', 'erate_perKwH'],
  ['e_rate_per_kwh', 'erate_perKwH'],
  ['emin_con', 'emin_con'],
  ['e_min_con', 'emin_con'],

  // water rate + min
  ['wrate_percbm', 'wrate_perCbM'],
  ['w_rate_per_cbm', 'wrate_perCbM'],
  ['wmin_con', 'wmin_con'],
  ['w_min_con', 'wmin_con'],

  // lpg
  ['lrate_perkg', 'lrate_perKg'],
  ['l_rate_per_kg', 'lrate_perKg'],
]);

// normalize an object’s keys to canonical model field names
function normalizeRateKeys(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = KEY_MAP.get(k.toLowerCase().replace(/\s+/g, '').replace(/__/g, '_')) || k;
    out[nk] = v;
  }
  return out;
}

// coerce numeric fields, return {ok, data|error}
function coerceRateNumbers(candidate) {
  const updates = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (NUM_FIELDS.includes(k)) {
      if (v === '' || v == null) {
        return { ok: false, error: `Field ${k} is required and must be a number` };
      }
      const num = Number(v);
      if (!Number.isFinite(num)) {
        return { ok: false, error: `Field ${k} must be a valid number` };
      }
      updates[k] = Math.round(num * 100) / 100; // match DECIMAL(10,2)
    } else {
      updates[k] = v;
    }
  }
  return { ok: true, data: updates };
}

/** Helper: filter which base-rate fields a biller may edit */
function filterBuildingBaseRatesByUtility(reqBody, userUtilities) {
  const map = {
    electric: ['erate_perKwH', 'emin_con'],
    water:    ['wrate_perCbM', 'wmin_con'],
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

function normalizeUtilityRole(uraw) {
  if (Array.isArray(uraw)) return uraw;
  if (uraw == null) return [];
  if (typeof uraw === 'string') {
    try {
      const parsed = JSON.parse(uraw);
      return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch {
      return uraw.trim() ? [uraw.trim()] : [];
    }
  }
  return [uraw];
}

// ---------- routes ----------

/**
 * GET /buildings
 * Admin-only: list all buildings
 */
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const buildings = await Building.findAll();
    res.json(buildings);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /buildings/:id
 * Admin-only: fetch a building by id
 */
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const building = await Building.findOne({ where: { building_id: req.params.id } });
    if (!building) return res.status(404).json({ message: 'Building not found' });
    res.json(building);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /buildings
 * Admin-only: create a new building
 * Body: { building_name, [erate_perKwH, emin_con, wrate_perCbM, wmin_con, lrate_perKg] }
 */
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { building_name, ...rest } = req.body || {};
  if (!building_name) {
    return res.status(400).json({ error: 'building_name is required' });
  }

  try {
    // Generate next BLDG-<n> (cross-dialect; MSSQL-safe)
    const rows = await Building.findAll({
      where: { building_id: { [Op.like]: 'BLDG-%' } },
      attributes: ['building_id'],
      raw: true
    });
    const maxNum = rows.reduce((max, r) => {
      const m = String(r.building_id).match(/^BLDG-(\d+)$/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const newBuildingId = `BLDG-${maxNum + 1}`;

    // optional base rates on create (normalize + coerce)
    const normalized = normalizeRateKeys(rest);
    const candidate = {};
    for (const f of NUM_FIELDS) if (normalized[f] !== undefined) candidate[f] = normalized[f];
    const coerced = coerceRateNumbers(candidate);
    if (!coerced.ok) return res.status(400).json({ error: coerced.error });

    const now = getCurrentDateTime();
    await Building.create({
      building_id: newBuildingId,
      building_name,
      // defaults exist in model; we also allow overrides via body
      ...coerced.data,
      last_updated: now,
      updated_by: req.user.user_fullname
    });

    res.status(201).json({
      message: 'Building created successfully',
      buildingId: newBuildingId
    });
  } catch (err) {
    console.error('Error in POST /buildings:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /buildings/:id
 * Admin-only: update name and/or any base rates
 * Body: { building_name?, erate_perKwH?, emin_con?, wrate_perCbM?, wmin_con?, lrate_perKg? }
 */
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const buildingId = req.params.id;

  if (!buildingId) {
    return res.status(400).json({ error: 'building_id is required' });
  }

  try {
    const building = await Building.findOne({ where: { building_id: buildingId } });
    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    // normalize + pick allowed
    const normalized = normalizeRateKeys(req.body || {});
    const up = {};
    if (normalized.building_name !== undefined) up.building_name = normalized.building_name;
    for (const f of NUM_FIELDS) if (normalized[f] !== undefined) up[f] = normalized[f];

    // coerce numeric rate fields
    const coerced = coerceRateNumbers(up);
    if (!coerced.ok) return res.status(400).json({ error: coerced.error });

    await building.update({
      ...coerced.data,
      last_updated: getCurrentDateTime(),
      updated_by: req.user.user_fullname
    });

    res.json({ message: 'Building updated successfully' });
  } catch (err) {
    console.error('Error in PUT /buildings/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /buildings/:id/base-rates
 * Admin or biller (scoped): fetch only base-rate fields
 */
router.get(
  '/:id/base-rates',
  authorizeRole('admin','biller'),
  authorizeBuildingParam(), // for non-admin, must match their building
  async (req, res) => {
    try {
      const building = await Building.findOne({
        where: { building_id: req.params.id },
        attributes: [
          'building_id','erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg','last_updated','updated_by'
        ]
      });
      if (!building) return res.status(404).json({ message: 'Building not found' });
      res.json(building);
    } catch (err) {
      console.error('GET /buildings/:id/base-rates error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * PUT /buildings/:id/base-rates
 * Admin or biller (scoped): update base-rate fields only
 * - Admin may edit any base-rate field
 * - Biller may only edit fields for utilities in their utility_role
 */
router.put(
  '/:id/base-rates',
  authorizeRole('admin','biller'),
  authorizeBuildingParam(),
  authorizeUtilityRole({ roles: ['biller'], anyOf: ['electric','water','lpg'], requireAll: false }),
  async (req, res) => {
    try {
      const building = await Building.findOne({ where: { building_id: req.params.id } });
      if (!building) return res.status(404).json({ error: 'Building not found' });

      const isAdmin = (req.user.user_level || '').toLowerCase() === 'admin';
      const normalized = normalizeRateKeys(req.body || {});
      let candidate = {};
      for (const f of NUM_FIELDS) if (normalized[f] !== undefined) candidate[f] = normalized[f];

      if (!isAdmin) {
        const allowed = filterBuildingBaseRatesByUtility(candidate, normalizeUtilityRole(req.user.utility_role));
        if (Object.keys(allowed).length === 0) {
          return res.status(400).json({ error: 'No permitted base-rate fields to update for your utility access.' });
        }
        candidate = allowed;
      }

      const coerced = coerceRateNumbers(candidate);
      if (!coerced.ok) return res.status(400).json({ error: coerced.error });

      await building.update({
        ...coerced.data,
        last_updated: getCurrentDateTime(),
        updated_by: req.user.user_fullname
      });

      res.json({ message: 'Building base rates updated' });
    } catch (err) {
      console.error('PUT /buildings/:id/base-rates error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE /buildings/:id
 * Admin-only: delete building if not referenced
 */
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const buildingId = req.params.id;

  if (!buildingId) {
    return res.status(400).json({ error: 'Building ID is required' });
  }

  try {
    // Check for referencing records in User, Tenant, Stall
    const [userRefs, tenantRefs, stallRefs] = await Promise.all([
      User.findAll({ where: { building_id: buildingId }, attributes: ['user_id'] }),
      Tenant.findAll({ where: { building_id: buildingId }, attributes: ['tenant_id'] }),
      Stall.findAll({ where: { building_id: buildingId }, attributes: ['stall_id'] }),
    ]);

    const users = userRefs.map(u => u.user_id);
    const tenants = tenantRefs.map(t => t.tenant_id);
    const stalls = stallRefs.map(s => s.stall_id);

    const errors = [];
    if (users.length) errors.push(`User(s): [${users.join(', ')}]`);
    if (tenants.length) errors.push(`Tenant(s): [${tenants.join(', ')}]`);
    if (stalls.length) errors.push(`Stall(s): [${stalls.join(', ')}]`);

    if (errors.length) {
      return res.status(400).json({
        error: `Cannot delete building. It is still referenced by: ${errors.join('; ')}`
      });
    }

    // Safe to delete
    const deleted = await Building.destroy({ where: { building_id: buildingId } });
    if (deleted === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    res.json({ message: `Building with ID ${buildingId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /buildings/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
