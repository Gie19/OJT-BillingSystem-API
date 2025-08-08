const express = require('express');
const router = express.Router();
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');


const { Op, literal } = require('sequelize');

//Models to be used for referencing
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Stall = require('../models/Stall');
const Rate = require('../models/Rate');
const Building = require('../models/Building');

// All routes below require valid token
router.use(authenticateToken);

// GET ALL BUILDINGS
router.get('/', authorizeRole('admin', 'user'), async (req, res) => {
  try {
    const buildings = await Building.findAll();
    res.json(buildings);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET BUILDING BY ID
router.get('/:id', authorizeRole('admin', 'user'), async (req, res) => {
  try {
    const building = await Building.findOne({ where: { building_id: req.params.id } });
    if (!building) return res.status(404).json({ message: 'Building not found' });
    res.json(building);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE A NEW BUILDING
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { building_name, rate_id } = req.body;

  if (!building_name || !rate_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if rate_id exists
    const rate = await Rate.findOne({ where: { rate_id } });
    if (!rate) {
      return res.status(400).json({ error: 'Invalid rate_id: Utility Rate ID does not exist.' });
    }

    // Get highest BLDG- ID
    const lastBuilding = await Building.findOne({
      where: { building_id: { [Op.like]: 'BLDG-%' } },
      order: [[literal("CAST(SUBSTRING(building_id, 6) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastBuilding) {
      const lastNumber = parseInt(lastBuilding.building_id.slice(5), 10); // skip 'BLDG-'
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }

    const newBuildingId = `BLDG-${nextNumber}`;
    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await Building.create({
      building_id: newBuildingId,
      building_name,
      rate_id,
      last_updated: today,
      updated_by: updatedBy
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

// UPDATE BUILDING BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const buildingId = req.params.id;
  const { building_name, rate_id } = req.body;

  if (!buildingId || !building_name || !rate_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if rate_id exists
    const rate = await Rate.findOne({ where: { rate_id } });
    if (!rate) {
      return res.status(400).json({ error: 'Invalid rate_id: Utility Rate ID does not exist.' });
    }

    const building = await Building.findOne({ where: { building_id: buildingId } });
    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    const today = getCurrentDateTime();
    const updatedBy = req.user.user_fullname;

    await building.update({
      building_name,
      rate_id,
      last_updated: today,
      updated_by: updatedBy
    });

    res.json({ message: 'Building updated successfully' });
  } catch (err) {
    console.error('Error in PUT /buildings/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE BUILDING BY ID with checker if it is still referenced by User, Tenant, Stall
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

    let errors = [];
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
