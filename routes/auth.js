const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const util = require('util');
require('dotenv').config();

const { comparePassword } = require('../utils/hashPassword');

// Promisify DB queries
const query = util.promisify(db.query).bind(db);

// POST /auth/login
router.post('/login', async (req, res) => {
  const { user_id, user_password } = req.body;

  if (!user_id || !user_password) {
    return res.status(400).json({ error: 'user_id and password required' });
  }

  try {
    // Look up user in the database
    const results = await query('SELECT * FROM useraccounts WHERE user_id = ?', [user_id]);

    if (results.length === 0) {
      return res.status(401).json({ error: 'No existing credentials' });
    }

    const user = results[0];

    console.log('Inputted password:', user_password);
    console.log('Stored hash:', user.user_password);

    // Compare password using utility function
    const match = await comparePassword(user_password, user.user_password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT payload
    const payload = {
      user_id: user.user_id,
      user_level: user.user_level,
      user_fullname: user.user_fullname
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
