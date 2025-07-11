const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const { hashPassword } = require('../utils/hashPassword');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');


const query = util.promisify(db.query).bind(db);

// All routes below require valid token
router.use(authenticateToken);

// GET ALL USERS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const results = await query('SELECT * FROM useraccounts');
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
    const results = await query('SELECT * FROM useraccounts WHERE user_id = ?', [userId]);

    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(results[0]);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});


// CREATE NEW USER WITH PREFIXED ID
router.post('/',authorizeRole('admin'), async (req, res) => {
  const { user_password, user_fullname, user_level, building_name } = req.body;

  if (!user_password || !user_fullname || !user_level || !building_name) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  let prefix;
  if (user_level.toLowerCase() === 'admin') {
    prefix = 'A';
  } else if (user_level.toLowerCase() === 'personnel') {
    prefix = 'P';
  } else {
    return res.status(400).json({ error: 'Invalid user level' });
  }

  try {
    // Get highest existing ID for this prefix
    const sqlFind = `
      SELECT user_id FROM useraccounts
      WHERE user_id LIKE ?
      ORDER BY CAST(SUBSTRING(user_id, 2) AS UNSIGNED) DESC
      LIMIT 1
    `;
    const results = await query(sqlFind, [`${prefix}%`]);

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].user_id;
      const lastNumber = parseInt(lastId.slice(1), 10);
      nextNumber = lastNumber + 1;
    }

    const newUserId = `${prefix}${nextNumber}`;

    // Hash password
    const hashedPassword = await hashPassword(user_password);

    // Insert new user
    const sqlInsert = `
      INSERT INTO useraccounts (user_id, user_password, user_fullname, user_level, building_name)
      VALUES (?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [newUserId, hashedPassword, user_fullname, user_level, building_name]);

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
    const sqlDelete = 'DELETE FROM useraccounts WHERE user_id = ?';
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
  const { user_password, user_fullname, user_level, building_name } = req.body;

  try {
    // Get existing user
    const sqlGet = 'SELECT * FROM useraccounts WHERE user_id = ?';
    const results = await query(sqlGet, [userId]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const existing = results[0];

    // Determine final values (preserve existing if not provided)
    const finalFullname = user_fullname || existing.user_fullname;
    const finalLevel = user_level || existing.user_level;
    const finalBuilding = building_name || existing.building_name;

    let finalPassword = existing.user_password;
    if (user_password) {
      finalPassword = await hashPassword(user_password);
    }

    // Update user
    const sqlUpdate = `
      UPDATE useraccounts
      SET user_password = ?, user_fullname = ?, user_level = ?, building_name = ?
      WHERE user_id = ?
    `;
    await query(sqlUpdate, [finalPassword, finalFullname, finalLevel, finalBuilding, userId]);

    res.json({ message: `User with ID ${userId} updated successfully` });
  } catch (err) {
    console.error('Error in PUT /users/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
