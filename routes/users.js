const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const sql = 'SELECT * FROM useraccounts';

  db.query(sql, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: err.message });  // Include error message in response
    }

    res.json(results);
  });
});

module.exports = router;
