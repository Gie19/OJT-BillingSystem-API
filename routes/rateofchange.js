// routes/rateofchange.js
'use strict';

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole     = require('../middleware/authorizeRole');
const authorizeUtilityRole = require('../middleware/authorizeUtilityRole');
const {
  authorizeBuildingParam,
  enforceRecordBuilding,
  attachBuildingScope
} = require('../middleware/authorizeBuilding');

// Models used purely for listing/IDs in routes
const Meter    = require('../models/Meter');
const Stall    = require('../models/Stall');
const Building = require('../models/Building');

// Utils (all helpers + core compute live here now)
const {
  sendErr,
  isYMD,
  getDisplayRollingPeriods,
  computeROCForMeter,
  getBuildingIdForRequest
} = require('../utils/rocUtils');

/* Middleware */
router.use(authenticateToken);

/**
 * PER-METER
 * GET /rateofchange/meters/:meter_id/period-end/:endDate
 */
router.get(
  '/meters/:meter_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller', 'reader'),
  authorizeUtilityRole({ roles: ['operator','biller','reader'] }),
  authorizeBuildingParam(),
  enforceRecordBuilding(getBuildingIdForRequest),
  async (req, res) => {
    try {
      const { meter_id, endDate } = req.params;
      if (!isYMD(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }
      const result = await computeROCForMeter({ meterId: meter_id, endDate });
      return res.json(result);
    } catch (err) {
      sendErr(res, err, 'Rate-of-change (meter) error');
    }
  }
);

/**
 * PER-TENANT (lists all meters; shows stall per meter)
 * GET /rateofchange/tenants/:tenant_id/period-end/:endDate
 */
router.get(
  '/tenants/:tenant_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller', 'reader'),
  authorizeUtilityRole({
    roles: ['operator','biller','reader'],
    anyOf: ['electric','water','lpg'],
  }),
  attachBuildingScope(),
  async (req, res) => {
    try {
      const { tenant_id, endDate } = req.params;
      if (!isYMD(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      const stalls = await Stall.findAll({
        where: {
          tenant_id,
          ...req.buildingWhere('building_id'),
        },
        attributes: ['stall_id', 'building_id'],
        raw: true
      });
      if (!stalls.length) {
        return res.status(404).json({ error: 'No accessible stalls found for this tenant' });
      }

      const stallIds = stalls.map(s => s.stall_id);
      const meters = await Meter.findAll({
        where: { stall_id: { [Op.in]: stallIds } },
        attributes: ['meter_id'],
        raw: true
      });
      if (!meters.length) {
        return res.status(404).json({ error: 'No meters found for this tenant (within your scope)' });
      }

      const perMeter = [];
      for (const m of meters) {
        try {
          perMeter.push(await computeROCForMeter({ meterId: m.meter_id, endDate }));
        } catch (e) {
          perMeter.push({
            meter_id: m.meter_id,
            error: (e && e.message) || 'Failed to compute rate of change'
          });
        }
      }

      const display = getDisplayRollingPeriods(endDate);
      return res.json({
        tenant_id,
        period: { current: display.curr, previous: display.prev },
        meters: perMeter
      });
    } catch (err) {
      sendErr(res, err, 'Rate-of-change (tenant) error');
    }
  }
);

/**
 * PER-BUILDING grouped by tenant
 * GET /rateofchange/buildings/:building_id/period-end/:endDate
 */
router.get(
  '/buildings/:building_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller', 'reader'),
  authorizeUtilityRole({
    roles: ['operator','biller','reader'],
    anyOf: ['electric','water','lpg'],
  }),
  authorizeBuildingParam(),
  async (req, res) => {
    try {
      const { building_id, endDate } = req.params;
      if (!isYMD(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      const building = await Building.findOne({
        where: { building_id },
        attributes: ['building_id', 'building_name'],
        raw: true
      });
      if (!building) return res.status(404).json({ error: 'Building not found' });

      const stalls = await Stall.findAll({
        where: { building_id },
        attributes: ['stall_id', 'tenant_id'],
        raw: true
      });
      if (!stalls.length) {
        return res.status(404).json({ error: 'No stalls found for this building' });
      }

      // Group stall_ids by tenant_id
      const byTenant = new Map();
      for (const st of stalls) {
        const tId = st.tenant_id || 'UNASSIGNED';
        if (!byTenant.has(tId)) byTenant.set(tId, []);
        byTenant.get(tId).push(st.stall_id);
      }

      // Load meters per tenant group
      const tenantsOut = [];
      for (const [tenant_id, stallIds] of byTenant.entries()) {
        const meters = await Meter.findAll({
          where: { stall_id: { [Op.in]: stallIds } },
          attributes: ['meter_id'],
          raw: true
        });

        const perMeter = [];
        for (const m of meters) {
          try {
            perMeter.push(await computeROCForMeter({ meterId: m.meter_id, endDate }));
          } catch (e) {
            perMeter.push({
              meter_id: m.meter_id,
              error: (e && e.message) || 'Failed to compute rate of change'
            });
          }
        }

        const aggCurrent  = perMeter.reduce((a, r) => a + (Number(r.current_consumption)  || 0), 0);
        const aggPrevious = perMeter.reduce((a, r) => a + (Number(r.previous_consumption) || 0), 0);
        const rate = aggPrevious > 0 ? Math.ceil(((aggCurrent - aggPrevious) / aggPrevious) * 100) : null;

        tenantsOut.push({
          tenant_id: tenant_id === 'UNASSIGNED' ? null : tenant_id,
          meters: perMeter,
          totals: {
            current_consumption: Math.round(aggCurrent * 100) / 100,
            previous_consumption: Math.round(aggPrevious * 100) / 100,
            rate_of_change: rate
          }
        });
      }

      const display = getDisplayRollingPeriods(endDate);
      return res.json({
        building_id,
        building_name: building.building_name || null,
        period: { current: display.curr, previous: display.prev },
        tenants: tenantsOut
      });
    } catch (err) {
      sendErr(res, err, 'Rate-of-change (building) error');
    }
  }
);

module.exports = router;
