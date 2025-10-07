// routes/readings.js
const express = require('express');
const router = express.Router();

// Utilities & middleware
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const { Op } = require('sequelize');

// Models
const Reading = require('../models/Reading');
const Meter   = require('../models/Meter');
const Stall   = require('../models/Stall');

// All routes require a valid token
router.use(authenticateToken);

// --- helpers --------------------------------------------------

function isAdmin(req) {
  return (req.user?.user_level || '').toLowerCase() === 'admin';
}

async function getMeterBuildingId(meterId) {
  const meter = await Meter.findOne({
    where: { meter_id: meterId },
    attributes: ['stall_id'],
    raw: true
  });
  if (!meter) return null;

  const stall = await Stall.findOne({
    where: { stall_id: meter.stall_id },
    attributes: ['building_id'],
    raw: true
  });
  return stall?.building_id || null;
}

async function getReadingBuildingId(readingId) {
  const reading = await Reading.findOne({
    where: { reading_id: readingId },
    attributes: ['meter_id'],
    raw: true
  });
  if (!reading) return null;
  return getMeterBuildingId(reading.meter_id);
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function coerceReadingValue(val) {
  if (val === '' || val == null) return { ok: false, error: 'reading_value is required and must be a number' };
  const num = Number(val);
  if (!Number.isFinite(num)) return { ok: false, error: 'reading_value must be a valid number' };
  // match DECIMAL(30,2)
  return { ok: true, value: Math.round(num * 100) / 100 };
}

// --- routes ---------------------------------------------------

/**
 * GET ALL METER READINGS
 * - Admins: all readings
 * - Operators: readings for meters in stalls under their building
 */
router.get('/',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    try {
      if (isAdmin(req)) {
        const readings = await Reading.findAll();
        return res.json(readings);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) {
        return res.status(401).json({ error: 'Unauthorized: No building assigned' });
      }

      const stalls = await Stall.findAll({
        where: { building_id: buildingId },
        attributes: ['stall_id'],
        raw: true
      });
      const stallIds = stalls.map(s => s.stall_id);
      if (stallIds.length === 0) return res.json([]);

      const meters = await Meter.findAll({
        where: { stall_id: stallIds },
        attributes: ['meter_id'],
        raw: true
      });
      const meterIds = meters.map(m => m.meter_id);
      if (meterIds.length === 0) return res.json([]);

      const readings = await Reading.findAll({
        where: { meter_id: meterIds }
      });

      return res.json(readings);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET METER READING BY ID
 * - Admins: full access
 * - Operators: only if the reading’s meter’s stall is in their building
 */
router.get('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    try {
      const readingId = req.params.id;

      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) return res.status(404).json({ message: 'Meter reading not found' });

      if (isAdmin(req)) {
        return res.json(reading);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) {
        return res.status(401).json({ error: 'Unauthorized: No building assigned' });
      }

      const recordBuildingId = await getReadingBuildingId(readingId);
      if (recordBuildingId && recordBuildingId !== buildingId) {
        return res.status(403).json({
          error: 'No access: This meter reading is not under your assigned building.'
        });
      }

      res.json(reading);
    } catch (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET readings for a specific date (YYYY-MM-DD)
 * - Admin: all meters; Operator: only their building
 */
router.get('/by-date/:date',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    try {
      if (isAdmin(req)) {
        const rows = await Reading.findAll({ where: { lastread_date: date } });
        return res.json(rows);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) return res.status(401).json({ error: 'Unauthorized: No building assigned' });

      const stalls = await Stall.findAll({ where: { building_id: buildingId }, attributes: ['stall_id'], raw: true });
      const stallIds = stalls.map(s => s.stall_id);
      if (!stallIds.length) return res.json([]);

      const meters = await Meter.findAll({ where: { stall_id: stallIds }, attributes: ['meter_id'], raw: true });
      const meterIds = meters.map(m => m.meter_id);
      if (!meterIds.length) return res.json([]);

      const rows = await Reading.findAll({
        where: { meter_id: meterIds, lastread_date: date }
      });
      return res.json(rows);
    } catch (err) {
      console.error('by-date error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET today's readings
 */
router.get('/today',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const date = todayYMD();
    try {
      if (isAdmin(req)) {
        const rows = await Reading.findAll({ where: { lastread_date: date } });
        return res.json(rows);
      }

      const buildingId = req.user?.building_id;
      if (!buildingId) return res.status(401).json({ error: 'Unauthorized: No building assigned' });

      const stalls = await Stall.findAll({ where: { building_id: buildingId }, attributes: ['stall_id'], raw: true });
      const stallIds = stalls.map(s => s.stall_id);
      if (!stallIds.length) return res.json([]);

      const meters = await Meter.findAll({ where: { stall_id: stallIds }, attributes: ['meter_id'], raw: true });
      const meterIds = meters.map(m => m.meter_id);
      if (!meterIds.length) return res.json([]);

      const rows = await Reading.findAll({
        where: { meter_id: meterIds, lastread_date: date }
      });
      return res.json(rows);
    } catch (err) {
      console.error('today error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET all readings for a specific meter
 * - Admin: any meter
 * - Operator: only if the meter’s stall is under their building
 * - Optional query:
 *    ?from=YYYY-MM-DD   (inclusive)
 *    ?to=YYYY-MM-DD     (inclusive)
 *    ?order=ASC|DESC    (default DESC by lastread_date)
 *    ?limit=50&offset=0
 */
router.get('/by-meter/:meter_id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const meterId = req.params.meter_id;
    const { from, to, order = 'DESC', limit, offset } = req.query || {};

    try {
      const meter = await Meter.findOne({ where: { meter_id: meterId }, attributes: ['stall_id'], raw: true });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        const meterBldg = await getMeterBuildingId(meterId);
        if (!meterBldg || meterBldg !== userBldg) {
          return res.status(403).json({ error: 'No access: Meter not under your assigned building.' });
        }
      }

      const where = { meter_id: meterId };
      if (from || to) {
        const isYMD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
        if ((from && !isYMD(from)) || (to && !isYMD(to))) {
          return res.status(400).json({ error: 'Invalid from/to format. Use YYYY-MM-DD.' });
        }
        if (from && to)       where.lastread_date = { [Op.between]: [from, to] };
        else if (from)        where.lastread_date = { [Op.gte]: from };
        else if (to)          where.lastread_date = { [Op.lte]: to };
      }

      const ord = (String(order).toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
      const findOpts = {
        where,
        order: [['lastread_date', ord], ['reading_id', 'ASC']],
      };
      if (limit !== undefined)  findOpts.limit  = Math.max(0, Number(limit) || 0);
      if (offset !== undefined) findOpts.offset = Math.max(0, Number(offset) || 0);

      const rows = await Reading.findAll(findOpts);
      return res.json(rows);
    } catch (err) {
      console.error('Error in GET /meter_reading/by-meter/:meter_id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * CREATE NEW METER READING (daily)
 * - Admins and Operators
 * - Operator must create for meters under their own building
 * - Enforce DAILY: only one reading per meter per lastread_date
 * - lastread_date/read_by are NOT NULL → always set
 * - lastread_date: manual input; defaults to today (YYYY-MM-DD) if omitted
 */
router.post('/',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    let { meter_id, reading_value, lastread_date } = req.body || {};
    if (!meter_id || reading_value === undefined) {
      return res.status(400).json({ error: 'meter_id and reading_value are required' });
    }

    const coerced = coerceReadingValue(reading_value);
    if (!coerced.ok) return res.status(400).json({ error: coerced.error });
    reading_value = coerced.value;

    try {
      const meter = await Meter.findOne({ where: { meter_id } });
      if (!meter) return res.status(404).json({ error: 'Meter not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        const meterBldg = await getMeterBuildingId(meter_id);
        if (!meterBldg || meterBldg !== userBldg) {
          return res.status(403).json({ error: 'No access: You can only create readings for meters under your assigned building.' });
        }
      }

      const dateOnly = (lastread_date && /^\d{4}-\d{2}-\d{2}$/.test(lastread_date))
        ? lastread_date
        : todayYMD();

      const existing = await Reading.findOne({
        where: { meter_id, lastread_date: dateOnly },
        attributes: ['reading_id'],
        raw: true
      });
      if (existing) {
        return res.status(409).json({ error: `Reading already exists for ${meter_id} on ${dateOnly}` });
      }

      // Generate MR-<n> (cross-dialect; scan + increment)
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

      const now = getCurrentDateTime();
      const updatedBy = req.user.user_fullname;

      await Reading.create({
        reading_id: newReadingId,
        meter_id,
        reading_value,
        lastread_date: dateOnly,
        read_by: updatedBy,
        last_updated: now,
        updated_by: updatedBy
      });

      res.status(201).json({ message: 'Reading created successfully', readingId: newReadingId });
    } catch (err) {
      console.error('Error in POST /meter_reading:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * UPDATE METER READING BY ID
 * - Admins: unrestricted
 * - Operators: can only update readings under their building
 * - DAILY: if lastread_date changes, enforce uniqueness per meter/day
 */
router.put('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const readingId = req.params.id;
    let { meter_id, reading_value, lastread_date } = req.body || {};
    const updatedBy = req.user.user_fullname;
    const now = getCurrentDateTime();

    try {
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) return res.status(404).json({ error: 'Reading not found' });

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) return res.status(401).json({ error: 'Unauthorized: No building assigned' });

        const currentBldg = await getReadingBuildingId(readingId);
        if (!currentBldg || currentBldg !== userBldg) {
          return res.status(403).json({ error: 'No access: You can only update readings under your assigned building.' });
        }

        if (meter_id && meter_id !== reading.meter_id) {
          const newMeterExists = await Meter.findOne({ where: { meter_id } });
          if (!newMeterExists) return res.status(400).json({ error: 'Invalid meter_id: Meter does not exist.' });
          const newMeterBldg = await getMeterBuildingId(meter_id);
          if (!newMeterBldg || newMeterBldg !== userBldg) {
            return res.status(403).json({ error: 'No access: The new meter is not under your assigned building.' });
          }
        }
      }

      if (!meter_id && reading_value === undefined && lastread_date === undefined) {
        return res.status(400).json({ message: 'No changes detected in the request body.' });
      }

      if (lastread_date !== undefined) {
        const dateOnly = lastread_date
          ? (/^\d{4}-\d{2}-\d{2}$/.test(lastread_date) ? lastread_date : null)
          : todayYMD();

        if (!dateOnly) {
          return res.status(400).json({ error: 'Invalid lastread_date format. Use YYYY-MM-DD.' });
        }

        const targetMeterId = meter_id || reading.meter_id;
        const clash = await Reading.findOne({
          where: {
            meter_id: targetMeterId,
            lastread_date: dateOnly,
            reading_id: { [Op.ne]: readingId }
          },
          attributes: ['reading_id'],
          raw: true
        });
        if (clash) {
          return res.status(409).json({ error: `Reading already exists for ${targetMeterId} on ${dateOnly}` });
        }

        reading.lastread_date = dateOnly;
      }

      if (meter_id) reading.meter_id = meter_id;

      if (reading_value !== undefined) {
        const coerced = coerceReadingValue(reading_value);
        if (!coerced.ok) return res.status(400).json({ error: coerced.error });
        reading.reading_value = coerced.value;
      }

      reading.read_by = updatedBy;
      reading.last_updated = now;
      reading.updated_by = updatedBy;

      await reading.save();
      res.json({ message: `Reading with ID ${readingId} updated successfully` });
    } catch (err) {
      console.error('Error in PUT /meter_reading/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * DELETE METER READING BY ID
 * - Admins: unrestricted
 * - Operators: can only delete readings under their building
 */
router.delete('/:id',
  authorizeRole('admin', 'operator'),
  async (req, res) => {
    const readingId = req.params.id;
    if (!readingId) {
      return res.status(400).json({ error: 'Reading ID is required' });
    }
    try {
      const reading = await Reading.findOne({ where: { reading_id: readingId } });
      if (!reading) {
        return res.status(404).json({ error: 'Reading not found' });
      }

      if (!isAdmin(req)) {
        const userBldg = req.user?.building_id;
        if (!userBldg) {
          return res.status(401).json({ error: 'Unauthorized: No building assigned' });
        }
        const readingBldg = await getReadingBuildingId(readingId);
        if (!readingBldg || readingBldg !== userBldg) {
          return res.status(403).json({
            error: 'No access: You can only delete readings under your assigned building.'
          });
        }
      }

      const deleted = await Reading.destroy({ where: { reading_id: readingId } });
      if (deleted === 0) {
        return res.status(404).json({ error: 'Reading not found' });
      }
      res.json({ message: `Reading with ID ${readingId} deleted successfully` });
    } catch (err) {
      console.error('Error in DELETE /meter_reading/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
