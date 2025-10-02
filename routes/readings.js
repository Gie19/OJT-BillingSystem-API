const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const { Op } = require('sequelize');

// Models
const Reading = require('../models/Reading');
const Meter = require('../models/Meter');

router.use(authenticateToken);

/** GET readings for a meter (optionally by date) */
router.get('/:meter_id', async (req, res) => {
  try {
    const where = { meter_id: req.params.meter_id };
    if (req.query.lastread_date) where.lastread_date = req.query.lastread_date;
    const rows = await Reading.findAll({ where, order: [['lastread_date', 'DESC']] });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** CREATE a reading (admin or operator), enforces unique meter+date */
router.post('/',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { meter_id, reading_value, read_by, lastread_date } = req.body || {};
      if (!meter_id || reading_value == null || !read_by || !lastread_date) {
        return res.status(400).json({ error: 'meter_id, reading_value, read_by, lastread_date are required' });
      }

      const meter = await Meter.findByPk(meter_id);
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      const exists = await Reading.findOne({ where: { meter_id, lastread_date } });
      if (exists) return res.status(409).json({ error: 'Reading for this meter and date already exists' });

      // Generate MR-<n> (cross-dialect; MSSQL-safe)
      const rows = await Reading.findAll({
        where: { reading_id: { [Op.like]: 'MR-%' } },
        attributes: ['reading_id'],
        raw: true
      });
      const maxNum = rows.reduce((max, r) => {
        const m = String(r.reading_id).match(/^MR-(\d+)$/);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const newReadingId = `MR-${maxNum + 1}`;

      const created = await Reading.create({
        reading_id: newReadingId,
        meter_id,
        reading_value,
        read_by,
        lastread_date,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.status(201).json(created);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** DELETE a reading (admin) */
router.delete('/:reading_id', authorizeRole('admin'), async (req, res) => {
  try {
    const reading = await Reading.findByPk(req.params.reading_id);
    if (!reading) return res.status(404).json({ error: 'Reading not found' });
    await reading.destroy();
    res.json({ message: 'Reading deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
