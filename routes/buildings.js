const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

// Sequelize helpers
const { Op, literal } = require('sequelize');

// Models
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Stall = require('../models/Stall');
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
  const { building_name } = req.body;

  if (!building_name) {
    return res.status(400).json({ error: 'building_name is required' });
  }

  try {
    // Get highest BLDG- ID
    const lastBuilding = await Building.findOne({
      where: { building_id: { [Op.like]: 'BLDG-%' } },
      order: [[literal("CAST(SUBSTRING(building_id, 6) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastBuilding) {
      const lastNumber = parseInt(lastBuilding.building_id.slice(5), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }

    const newBuildingId = `BLDG-${nextNumber}`;
    const now = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const payload = {
      building_id: newBuildingId,
      building_name,
      last_updated: now,
      updated_by: updatedBy,
    };

    // Allow optional base rates on create
    const baseFields = ['erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg'];
    for (const f of baseFields) {
      if (f in req.body) payload[f] = req.body[f];
    }

    await Building.create(payload);

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

    const now = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    const up = {
      last_updated: now,
      updated_by: updatedBy
    };

    const allowed = ['building_name','erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg'];
    allowed.forEach(f => {
      if (f in req.body) up[f] = req.body[f];
    });

    await building.update(up);
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
        attributes: ['building_id','erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg','last_updated','updated_by']
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
      const userUtils = Array.isArray(req.user.utility_role)
        ? req.user.utility_role.map(s => String(s).toLowerCase())
        : [];

      let up = {};
      if (isAdmin) {
        const baseFields = ['erate_perKwH','emin_con','wrate_perCbM','wmin_con','lrate_perKg'];
        baseFields.forEach(f => { if (f in req.body) up[f] = req.body[f]; });
      } else {
        up = filterBuildingBaseRatesByUtility(req.body, userUtils);
        if (Object.keys(up).length === 0) {
          return res.status(400).json({ error: 'No permitted base-rate fields to update for your utility access.' });
        }
      }

      const now = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      await building.update({
        ...up,
        last_updated: now,
        updated_by: updatedBy
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
