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
const Building = require('../models/Building');

// All routes below require a valid token
router.use(authenticateToken);

// --- helpers --------------------------------------------------

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

// filter which base-rate fields a biller may edit
function filterByUtilities(reqBody, utilities) {
  const map = {
    electric: ['erate_perKwH', 'emin_con'],
    water: ['wrate_perCbM', 'wmin_con'],
    lpg: ['lrate_perKg'],
  };
  const allowed = new Set();
  (utilities || []).forEach(u => (map[u] || []).forEach(f => allowed.add(f)));
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

// --- routes ---------------------------------------------------

/** GET all buildings (admin only) */
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const buildings = await Building.findAll();
    res.json(buildings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET one building (admin or biller restricted to their building) */
router.get('/:building_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const building = await Building.findByPk(req.params.building_id);
      if (!building) return res.status(404).json({ error: 'Building not found' });
      res.json(building);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/** CREATE building (admin) — NOW accepts optional rate fields */
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { building_name, ...rest } = req.body || {};
  if (!building_name) {
    return res.status(400).json({ error: 'building_name is required' });
  }

  try {
    // next BLDG- id
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

    // normalize incoming keys and coerce numbers
    const normalized = normalizeRateKeys(rest);
    const picked = {};
    for (const f of NUM_FIELDS) if (normalized[f] !== undefined) picked[f] = normalized[f];
    const coerced = coerceRateNumbers(picked);
    if (!coerced.ok) return res.status(400).json({ error: coerced.error });

    const now = getCurrentDateTime();
    const created = await Building.create({
      building_id: newBuildingId,
      building_name,
      // defaults
      erate_perKwH: 0.00, emin_con: 0.00, wrate_perCbM: 0.00, wmin_con: 0.00, lrate_perKg: 0.00,
      // override with provided values (if any)
      ...coerced.data,
      last_updated: now,
      updated_by: req.user?.user_fullname || 'system'
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** UPDATE building base rates (biller restricted by utility or admin) */
router.put('/:building_id/rates',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  authorizeUtilityRole(),
  async (req, res) => {
    try {
      const building = await Building.findByPk(req.params.building_id);
      if (!building) return res.status(404).json({ error: 'Building not found' });

      // normalize keys and limit to numeric fields only
      const normalized = normalizeRateKeys(req.body || {});
      let candidate = {};
      for (const f of NUM_FIELDS) if (normalized[f] !== undefined) candidate[f] = normalized[f];

      // biller scoping
      if (req.user.user_level === 'biller') {
        const allowed = filterByUtilities(candidate, normalizeUtilityRole(req.user.utility_role));
        if (Object.keys(allowed).length === 0) {
          return res.status(403).json({ error: 'No allowed rate fields to update for your utilities' });
        }
        candidate = allowed;
      }

      // coerce numbers
      const coerced = coerceRateNumbers(candidate);
      if (!coerced.ok) return res.status(400).json({ error: coerced.error });

      const updates = {
        ...coerced.data,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system'
      };

      await building.update(updates);
      res.json(building);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/** DELETE building (admin) */
router.delete('/:building_id', authorizeRole('admin'), async (req, res) => {
  try {
    const building = await Building.findByPk(req.params.building_id);
    if (!building) return res.status(404).json({ error: 'Building not found' });
    await building.destroy();
    res.json({ message: 'Building deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
