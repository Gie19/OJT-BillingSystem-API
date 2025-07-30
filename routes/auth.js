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
    const results = await query('SELECT * FROM user_accounts WHERE user_id = ?', [user_id]);

    if (results.length === 0) {
      return res.status(401).json({ error: 'No existing credentials' });
    }

    const user = results[0];

    const match = await comparePassword(user_password, user.user_password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const payload = {
      user_id: user.user_id,
      user_level: user.user_level,
      user_fullname: user.user_fullname
    };

    //Generate short-lived access token
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '15m'
    });

    //Generate long-lived refresh token
    const refreshToken = jwt.sign(payload, process.env.REFRESH_SECRET, {
      expiresIn: process.env.REFRESH_EXPIRES_IN || '7d'
    });

    //Save refresh token to DB
    await query('INSERT INTO user_refresh_tokens (user_id, token) VALUES (?, ?)', [user.user_id, refreshToken]);

    //Return both tokens
    res.json({ accessToken, refreshToken });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/refresh-token
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    //Check if the token exists in DB
    const result = await query('SELECT * FROM user_refresh_tokens WHERE token = ?', [refreshToken]);
    if (result.length === 0) {
      return res.status(403).json({ error: 'Refresh token not recognized' });
    }

    //Verify refresh token
    jwt.verify(refreshToken, process.env.REFRESH_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: 'Invalid or expired refresh token' });

      const payload = {
        user_id: user.user_id,
        user_level: user.user_level,
        user_fullname: user.user_fullname
      };

      //Generate new access token
      const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '15m'
      });

      res.json({ accessToken });
    });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// POST /auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    //Delete token from DB
    await query('DELETE FROM user_refresh_tokens WHERE token = ?', [refreshToken]);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});




module.exports = router;
