const express = require('express');
const router = express.Router();
const { hashPassword } = require('../utils/hashPassword');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { Op, literal } = require('sequelize');
const User = require('../models/User');

// All routes below require a valid token
router.use(authenticateToken);

// GET ALL USERS
router.get('/', authorizeRole('admin'), async (req, res) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET USER BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
  try {
    const user = await User.findOne({ where: { user_id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
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
      user_level,
      building_id
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

// DELETE USER BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const userId = req.params.id;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const deletedRows = await User.destroy({ where: { user_id: userId } });
    if (deletedRows === 0) {
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
    const user = await User.findOne({ where: { user_id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedFields = {
      user_fullname: user_fullname || user.user_fullname,
      user_level: user_level || user.user_level,
      building_id: building_id || user.building_id,
    };

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
