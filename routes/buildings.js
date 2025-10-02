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
const Meter = require('../models/Meter');
const Building = require('../models/Building');

// All routes below require a valid token
router.use(authenticateToken);

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

/** CREATE building (admin) */
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { building_name } = req.body;

  if (!building_name) {
    return res.status(400).json({ error: 'building_name is required' });
  }

  try {
    // Get next BLDG- ID (cross-dialect; MSSQL-safe)
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

    const now = getCurrentDateTime();
    const created = await Building.create({
      building_id: newBuildingId,
      building_name,
      erate_perKwH: 0.00, emin_con: 0.00,
      wrate_perCbM: 0.00, wmin_con: 0.00,
      lrate_perKg:  0.00,
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
  authorizeUtilityRole(), // biller must have utility_role matching submitted fields
  async (req, res) => {
    try {
      const building = await Building.findByPk(req.params.building_id);
      if (!building) return res.status(404).json({ error: 'Building not found' });

      let updates = {};
      if (req.user.user_level === 'biller') {
        updates = filterBuildingBaseRatesByUtility(req.body, req.user.utility_role || []);
        if (Object.keys(updates).length === 0) {
          return res.status(403).json({ error: 'No allowed rate fields to update for your utilities' });
        }
      } else {
        updates = req.body || {};
      }

      updates.last_updated = getCurrentDateTime();
      updates.updated_by = req.user?.user_fullname || 'system';

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
