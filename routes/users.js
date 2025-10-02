const express = require('express');
const router = express.Router();

// Utilities & middleware
const { hashPassword } = require('../utils/hashPassword');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

// Sequelize
const { Op } = require('sequelize');

// Models
const User = require('../models/User');

router.use(authenticateToken);

/** GET all users (admin) */
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** CREATE user (admin) */
router.post('/', authorizeRole('admin'), async (req, res) => {
  try {
    const { user_password, user_fullname, user_level, building_id = null, utility_role = null } = req.body || {};
    if (!user_password || !user_fullname || !user_level) {
      return res.status(400).json({ error: 'user_password, user_fullname, user_level are required' });
    }

    // Build next USER-<n> (cross-dialect; MSSQL-safe)
    const rows = await User.findAll({
      where: { user_id: { [Op.like]: 'USER-%' } },
      attributes: ['user_id'],
      raw: true
    });
    const maxNum = rows.reduce((max, r) => {
      const m = String(r.user_id).match(/^USER-(\d+)$/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const newUserId = `USER-${maxNum + 1}`;

    // Hash outside model (as per your setup)
    const hashed = await hashPassword(user_password);

    const created = await User.create({
      user_id: newUserId,
      user_password: hashed,
      user_fullname,
      user_level,
      building_id,
      utility_role
    });
    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** UPDATE user (admin) */
router.put('/:user_id', authorizeRole('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { user_password, user_fullname, user_level, building_id, utility_role } = req.body || {};
    const updates = {};

    if (user_password) updates.user_password = await hashPassword(user_password);
    if (user_fullname) updates.user_fullname = user_fullname;
    if (user_level) updates.user_level = user_level;
    if (building_id !== undefined) updates.building_id = building_id;
    if (utility_role !== undefined) updates.utility_role = utility_role;

    await user.update(updates);
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** DELETE user (admin) */
router.delete('/:user_id', authorizeRole('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await user.destroy();
    res.json({ message: 'User deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
