const express = require('express');
const router = express.Router();

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam } = require('../middleware/authorizeBuilding');

const { Op } = require('sequelize');

// Models
const Stall = require('../models/Stall');

router.use(authenticateToken);

/** GET stalls by building */
router.get('/buildings/:building_id',
  authorizeRole('admin', 'biller'),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const rows = await Stall.findAll({ where: { building_id: req.params.building_id } });
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** CREATE stall */
router.post('/',
  authorizeRole('admin'),
  async (req, res) => {
    try {
      const { stall_sn, building_id, tenant_id = null } = req.body || {};
      if (!stall_sn || !building_id) {
        return res.status(400).json({ error: 'stall_sn and building_id are required' });
      }

      // Generate STL-<n> (cross-dialect; MSSQL-safe)
      const rows = await Stall.findAll({
        where: { stall_id: { [Op.like]: 'STL-%' } },
        attributes: ['stall_id'],
        raw: true
      });
      const maxNum = rows.reduce((max, r) => {
        const m = String(r.stall_id).match(/^STL-(\d+)$/);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      const newStallId = `STL-${maxNum + 1}`;

      const created = await Stall.create({
        stall_id: newStallId,
        stall_sn,
        tenant_id,
        building_id,
        stall_status: 'available',
        last_updated: getCurrentDateTime(),
        updated_by: req.user?.user_fullname || 'system',
      });
      res.status(201).json(created);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/** UPDATE stall status/tenant */
router.put('/:stall_id',
  authorizeRole('admin'),
  async (req, res) => {
    try {
      const stall = await Stall.findByPk(req.params.stall_id);
      if (!stall) return res.status(404).json({ error: 'Stall not found' });

      const { stall_status, tenant_id } = req.body || {};
      const updates = {};
      if (stall_status) updates.stall_status = stall_status;
      if (tenant_id !== undefined) updates.tenant_id = tenant_id;

      updates.last_updated = getCurrentDateTime();
      updates.updated_by = req.user?.user_fullname || 'system';

      await stall.update(updates);
      res.json(stall);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

module.exports = router;
