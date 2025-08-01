const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const { hashPassword } = require('../utils/hashPassword');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const query = util.promisify(db.query).bind(db);

// All routes below require a valid token
router.use(authenticateToken);

// GET ALL USERS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM user_accounts');
    res.json(results);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET USER BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;
  try {
    const results = await query('SELECT * FROM user_accounts WHERE user_id = ?', [userId]);

    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(results[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW USER WITH 'USER-' PREFIXED ID
router.post('/', authorizeRole('admin'), async (req, res) => {
  const { user_password, user_fullname, user_level, building_id } = req.body;

  if (!user_password || !user_fullname || !user_level || !building_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Get highest USER- ID
    const sqlFind = `
      SELECT user_id FROM user_accounts
      WHERE user_id LIKE 'USER-%'
      ORDER BY CAST(SUBSTRING(user_id, 6) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].user_id;
      const lastNumber = parseInt(lastId.slice(5), 10); // skip 'USER-'
      nextNumber = lastNumber + 1;
    }

    const newUserId = `USER-${nextNumber}`;
    const hashedPassword = await hashPassword(user_password);

    const sqlInsert = `
      INSERT INTO user_accounts (user_id, user_password, user_fullname, user_level, building_id)
      VALUES (?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [newUserId, hashedPassword, user_fullname, user_level, building_id]);

    res.status(201).json({
      message: 'User created successfully',
      userId: newUserId
    });
  } catch (err) {
    console.error('Error in POST /users:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE USER BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const sqlDelete = 'DELETE FROM user_accounts WHERE user_id = ?';
    const result = await query(sqlDelete, [userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: `User with ID ${userId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /users/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE USER BY ID 
router.put('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;
  const { user_password, user_fullname, user_level, building_id } = req.body;

  try {
    const sqlGet = 'SELECT * FROM user_accounts WHERE user_id = ?';
    const results = await query(sqlGet, [userId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existing = results[0];
    const finalFullname = user_fullname || existing.user_fullname;
    const finalLevel = user_level || existing.user_level;
    const finalBuildingId = building_id || existing.building_id;

    let finalPassword = existing.user_password;
    if (user_password) {
      finalPassword = await hashPassword(user_password);
    }

    const sqlUpdate = `
      UPDATE user_accounts
      SET user_password = ?, user_fullname = ?, user_level = ?, building_id = ?
      WHERE user_id = ?
    `;
    await query(sqlUpdate, [finalPassword, finalFullname, finalLevel, finalBuildingId, userId]);

    res.json({ message: `User with ID ${userId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /users/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
