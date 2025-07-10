const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');


//GET ALL USERS IN THE TABLE
router.get('/', (req, res) => {
  const sql = 'SELECT * FROM useraccounts';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }

    res.json(results);
  });
});

//GET USER BY ID
router.get('/:id', (req, res) => {
  const userId = req.params.id;
  const sql = 'SELECT * FROM useraccounts WHERE user_id = ?';

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(results[0]);
  });
});

//CREATE A NEW USER WITH AUTO INCREMENTING ID
// ID will be prefixed with 'A' for admin and 'P' for personnel
router.post('/', (req, res) => {
  const { user_password, user_fullname, user_level, building_name } = req.body;

  if (!user_password || !user_fullname || !user_level || !building_name) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Choose prefix based on level
  let prefix;
  if (user_level.toLowerCase() === 'admin') {
    prefix = 'A';
  } else if (user_level.toLowerCase() === 'personnel') {
    prefix = 'P';
  } else {
    return res.status(400).json({ error: 'Invalid user level' });
  }

  // Find highest existing ID with that prefix
  const sqlFind = `
    SELECT user_id FROM useraccounts
    WHERE user_id LIKE ?
    ORDER BY CAST(SUBSTRING(user_id, 2) AS UNSIGNED) DESC
    LIMIT 1
  `;

  db.query(sqlFind, [`${prefix}%`], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }

    let nextNumber = 1;
    if (results.length > 0) {
      const lastId = results[0].user_id;
      const lastNumber = parseInt(lastId.slice(1), 10);
      nextNumber = lastNumber + 1;
    }

    const newUserId = `${prefix}${nextNumber}`;

    // Now hash password
    const saltRounds = 10;
    bcrypt.hash(user_password, saltRounds, (err, hashedPassword) => {
      if (err) {
        console.error('Hash error:', err);
        return res.status(500).json({ error: 'Error hashing password' });
      }

      const sqlInsert = `
        INSERT INTO useraccounts (user_id, user_password, user_fullname, user_level, building_name)
        VALUES (?, ?, ?, ?, ?)
      `;

      db.query(sqlInsert, [newUserId, hashedPassword, user_fullname, user_level, building_name], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: err.message });
        }

        res.status(201).json({
          message: 'User created successfully',
          userId: newUserId
        });
      });
    });
  });
});




// DELETE /users/:id - delete user by user_id
router.delete('/:id', (req, res) => {
  const userId = req.params.id;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const sql = 'DELETE FROM useraccounts WHERE user_id = ?';
  db.query(sql, [userId], (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: `User with ID ${userId} deleted successfully` });
  });
});


//UPDATE USER BY ID
// PUT /users/:id - update a user
router.put('/:id', (req, res) => {
  const userId = req.params.id;
  const { user_password, user_fullname, user_level, building_name } = req.body;

  if (!user_fullname || !user_level || !building_name) {
    return res.status(400).json({ error: 'Fullname, level, and building are required' });
  }

  // Helper function to do the DB update
  const doUpdate = (hashedPassword) => {
    const sql = `
      UPDATE useraccounts
      SET user_password = ?, user_fullname = ?, user_level = ?, building_name = ?
      WHERE user_id = ?
    `;

    db.query(sql, [hashedPassword, user_fullname, user_level, building_name, userId], (err, result) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: err.message });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ message: `User with ID ${userId} updated successfully` });
    });
  };

  // Handle password hashing if password is provided
  if (user_password) {
    const saltRounds = 10;
    bcrypt.hash(user_password, saltRounds, (err, hashedPassword) => {
      if (err) {
        console.error('Hash error:', err);
        return res.status(500).json({ error: 'Error hashing password' });
      }
      doUpdate(hashedPassword);
    });
  } else {
    // No new password provided — keep existing
    // Typically you'd SELECT current password from DB
    const sqlGet = 'SELECT user_password FROM useraccounts WHERE user_id = ?';
    db.query(sqlGet, [userId], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: err.message });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const existingPassword = results[0].user_password;
      doUpdate(existingPassword);
    });
  }
});





module.exports = router;
