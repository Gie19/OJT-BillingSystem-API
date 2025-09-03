const express = require('express');
const router = express.Router();

// Utilities & middleware
const { hashPassword } = require('../utils/hashPassword');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

// Sequelize
const { Op, literal } = require('sequelize');

// Model
const User = require('../models/User');

// Allowed roles (reader removed; operator kept; biller kept)
const ALLOWED_ROLES = new Set(['admin', 'operator', 'biller']);
const ALLOWED_UTILS = new Set(['electric', 'water', 'lpg']);

// All routes below require a valid token
router.use(authenticateToken);

// GET ALL USERS (admin only)
router.get('/', authorizeRole('admin'), async (_req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET USER BY ID (admin only)
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const user = await User.findOne({ where: { user_id: req.params.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW USER WITH 'USER-' PREFIXED ID (admin only)
router.post('/', authorizeRole('admin'), async (req, res) => {
  const {
    user_password,
    user_fullname,
    user_level,
    building_id,
    utility_role
  } = req.body;

  // Basic presence checks (building_id required for non-admins)
  if (!user_password || !user_fullname || !user_level) {
    return res.status(400).json({ error: 'user_password, user_fullname, and user_level are required' });
  }
  const role = String(user_level).toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid user_level' });
  }
  if (role !== 'admin' && !building_id) {
    return res.status(400).json({ error: 'building_id is required for non-admin users' });
  }

  // utility_role is ONLY meaningful for biller now; operators ignore it
  let utilPayload = null;
  if (utility_role != null && role === 'biller') {
    if (!Array.isArray(utility_role)) {
      return res.status(400).json({ error: 'utility_role must be an array of strings' });
    }
    const clean = utility_role.map(x => String(x).toLowerCase());
    if (!clean.every(v => ALLOWED_UTILS.has(v))) {
      return res.status(400).json({ error: 'utility_role contains invalid utility. Allowed: electric, water, lpg' });
    }
    utilPayload = clean;
  }

  try {
    // Find highest USER- ID and generate the next one
    const lastUser = await User.findOne({
      where: { user_id: { [Op.like]: 'USER-%' } },
      order: [[literal("CAST(SUBSTRING(user_id, 6) AS UNSIGNED)"), "DESC"]],
    });

    let nextNumber = 1;
    if (lastUser) {
      const lastNumber = parseInt(lastUser.user_id.slice(5), 10);
      if (!isNaN(lastNumber)) nextNumber = lastNumber + 1;
    }
    const newUserId = `USER-${nextNumber}`;

    // Hash password
    const hashedPassword = await hashPassword(user_password);

    // Create user
    await User.create({
      user_id: newUserId,
      user_password: hashedPassword,
      user_fullname,
      user_level: role,
      building_id: role === 'admin' ? null : building_id,
      utility_role: role === 'biller' ? utilPayload : null
    });

    res.status(201).json({
      message: 'User created successfully',
      userId: newUserId
    });
  } catch (err) {
    console.error('Error in POST /users:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE USER BY ID (admin only)
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    const deletedRows = await User.destroy({ where: { user_id: userId } });
    if (deletedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `User with ID ${userId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /users/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE USER BY ID (admin only)
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;
  const {
    user_password,
    user_fullname,
    user_level,
    building_id,
    utility_role
  } = req.body;

  try {
    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updatedFields = {};

    // Fullname
    if (user_fullname != null) updatedFields.user_fullname = user_fullname;

    // Role change
    if (user_level != null) {
      const lvl = String(user_level).toLowerCase();
      if (!ALLOWED_ROLES.has(lvl)) {
        return res.status(400).json({ error: 'Invalid user_level' });
      }
      updatedFields.user_level = lvl;
    }
    const effectiveLevel = (updatedFields.user_level || user.user_level || '').toLowerCase();

    // Building rules
    if (building_id !== undefined) {
      if (effectiveLevel !== 'admin' && !building_id) {
        return res.status(400).json({ error: 'building_id is required for non-admin users' });
      }
      updatedFields.building_id = effectiveLevel === 'admin' ? null : building_id;
    }

    // Utility role rules — only biller uses it now
    if (utility_role !== undefined) {
      if (effectiveLevel !== 'biller') {
        // Ignore or clear for non-billers
        updatedFields.utility_role = null;
      } else if (utility_role === null) {
        updatedFields.utility_role = null;
      } else if (Array.isArray(utility_role)) {
        const clean = utility_role.map(x => String(x).toLowerCase());
        if (!clean.every(v => ALLOWED_UTILS.has(v))) {
          return res.status(400).json({ error: 'utility_role contains invalid utility. Allowed: electric, water, lpg' });
        }
        updatedFields.utility_role = clean;
      } else {
        return res.status(400).json({ error: 'utility_role must be an array or null' });
      }
    }

    // Password
    if (user_password) {
      updatedFields.user_password = await hashPassword(user_password);
    }

    await user.update(updatedFields);
    res.json({ message: `User with ID ${userId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /users/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
