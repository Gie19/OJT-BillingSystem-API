const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

// Sequelize
const { Op } = require('sequelize');

// Models
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');
const Tenant = require('../models/Tenant');
const Building = require('../models/Building');

router.use(authenticateToken);

/** GET meters (admin or biller restricted by building) */
router.get('/buildings/:building_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const stalls = await Stall.findAll({
        where: { building_id: req.params.building_id },
        attributes: ['stall_id']
      });
      const stallIds = stalls.map(s => s.stall_id);
      const meters = await Meter.findAll({ where: { stall_id: { [Op.in]: stallIds } } });
      res.json(meters);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** CREATE meter (admin or biller with utility role that matches type) */
router.post('/',
  authorizeRole('admin', 'biller'),
  authorizeUtilityRole(),
  async (req, res) => {
    try {
      const { meter_type, meter_sn, meter_mult, stall_id } = req.body || {};
      if (!meter_type || !meter_sn || !meter_mult || !stall_id) {
        return res.status(400).json({ error: 'meter_type, meter_sn, meter_mult and stall_id are required' });
      }

      // Verify stall exists
      const stall = await Stall.findByPk(stall_id);
      if (!stall) return res.status(404).json({ error: 'Stall not found' });

      // Generate MTR-<n> (cross-dialect; MSSQL-safe)
      const rows = await Meter.findAll({
        where: { meter_id: { [Op.like]: 'MTR-%' } },
        attributes: ['meter_id'],
        raw: true
      });
      const maxNum = rows.reduce((max, r) => {
        const m = String(r.meter_id).match(/^MTR-(\d+)$/);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const newMeterId = `MTR-${maxNum + 1}`;

      const created = await Meter.create({
        meter_id: newMeterId,
        meter_type,
        meter_sn,
        meter_mult,
        meter_status: 'inactive',
        stall_id,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.status(201).json(created);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** ACTIVATE/DEACTIVATE meter */
router.put('/:meter_id/status',
  authorizeRole('admin', 'biller'),
  async (req, res) => {
    try {
      const meter = await Meter.findByPk(req.params.meter_id);
      if (!meter) return res.status(404).json({ error: 'Meter not found' });
      const { meter_status } = req.body || {};
      if (!['active','inactive'].includes(meter_status)) {
        return res.status(400).json({ error: 'meter_status must be active|inactive' });
      }
      await meter.update({
        meter_status,
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.json(meter);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

module.exports = router;
