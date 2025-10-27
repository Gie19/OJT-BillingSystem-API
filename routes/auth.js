const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('../models/User');
const { comparePassword } = require('../utils/hashPassword');

// POST /auth/login
router.post('/login', async (req, res) => {
  const { user_id, user_password } = req.body;

  if (!user_id || !user_password) {
    return res.status(400).json({ error: 'user_id and password required' });
  }

  try {
    const user = await User.findOne({ where: { user_id } });
    if (!user) return res.status(401).json({ error: 'No existing credentials' });

    const match = await comparePassword(user_password, user.user_password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Arrays-only payload
    const payload = {
      user_id: user.user_id,
      user_fullname: user.user_fullname,
      user_roles: Array.isArray(user.user_roles) ? user.user_roles : [],
      building_ids: Array.isArray(user.building_ids) ? user.building_ids : [],
      utility_role: Array.isArray(user.utility_role) ? user.utility_role : []
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1h'
    });

    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
