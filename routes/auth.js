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
    // Use Sequelize to look up user in the database
    const user = await User.findOne({ where: { user_id } });

    if (!user) {
      return res.status(401).json({ error: 'No existing credentials' });
    }

    // Compare password using utility function
    const match = await comparePassword(user_password, user.user_password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT payload
    const payload = {
      user_id: user.user_id,
      user_level: user.user_level,
      user_fullname: user.user_fullname,
      building_id: user.building_id
    };

    // Sign JWT
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
