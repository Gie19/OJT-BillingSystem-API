// middleware/authorizeUtilityRole.js
'use strict';

const Meter = require('../models/Meter');
const Stall = require('../models/Stall');

/**
 * authorizeUtilityRole(options)
 * options:
 *  - roles: string[]        -> caller must have ANY of these top-level roles (e.g., operator/biller/reader)
 *  - anyOf: string[]        -> caller must have ANY of these utilities (e.g., ['electric','water','lpg'])
 *  - requireAll: boolean    -> if true, caller must have ALL in anyOf (default false)
 *  - meterIdFields: string[]-> where to look for meter id (default: ['params.meter_id','params.id','body.meter_id'])
 *
 * Expects user payload:
 *  - req.user.user_roles?        : string[] (top-level roles; 'admin' bypasses)
 *  - req.user.utility_roles?     : string[] of utilities (e.g., ['electric','water'])
 */
module.exports = function authorizeUtilityRole(opts = {}) {
  const {
    roles = [],
    anyOf = [],
    requireAll = false,
    meterIdFields = ['params.meter_id', 'params.id', 'body.meter_id'],
  } = opts;

  function hasAnyRole(user, allowed) {
    const roles = Array.isArray(user?.user_roles) ? user.user_roles : [];
    const set = new Set(roles.map(r => String(r).toLowerCase()));
    return allowed.some(r => set.has(String(r).toLowerCase()));
  }

  function isAdmin(user) {
    const roles = Array.isArray(user?.user_roles) ? user.user_roles.map(r => String(r).toLowerCase()) : [];
    return roles.includes('admin');
  }

  function hasUtilities(user, list, allRequired) {
    if (!list.length) return true;
    const u = Array.isArray(user?.utility_roles) ? user.utility_roles.map(s => String(s).toLowerCase()) : [];
    if (allRequired) return list.every(x => u.includes(String(x).toLowerCase()));
    return list.some(x => u.includes(String(x).toLowerCase()));
  }

  async function pickMeterId(req) {
    for (const path of meterIdFields) {
      const [root, key] = path.split('.');
      if (root && key && req[root] && req[root][key]) return req[root][key];
    }
    return null;
  }

  return async function (req, res, next) {
    try {
      // Admin bypasses utility checks; role gate still applied earlier by authorizeRole
      if (isAdmin(req.user)) return next();

      // If high-level roles are required (operator/biller/reader), enforce
      if (roles.length && !hasAnyRole(req.user, roles)) {
        return res.status(403).json({ error: 'Insufficient role to access this utility' });
      }

      // If we need a specific utility but none specified yet, try to resolve via meter_id
      let utility = null;
      let requestedBuildingId = null;

      const meterId = await pickMeterId(req);
      if (meterId) {
        const meter = await Meter.findOne({ where: { meter_id: meterId }, attributes: ['stall_id', 'meter_type'], raw: true });
        if (!meter) return res.status(404).json({ error: 'Meter not found for utility check' });

        const stall = await Stall.findOne({ where: { stall_id: meter.stall_id }, attributes: ['building_id'], raw: true });
        requestedBuildingId = stall?.building_id || null;

        utility = String(meter.meter_type || '').toLowerCase();
        req.meterUtility = utility;
        if (requestedBuildingId) req.requestedBuildingId = requestedBuildingId;
      }

      // Enforce utility permission if asked
      if (anyOf.length) {
        const need = requireAll ? 'all' : 'any';
        const ok = hasUtilities(req.user, anyOf, requireAll) || (utility && anyOf.includes(utility));
        if (!ok) {
          return res.status(403).json({ error: `Requires ${need} of utilities: ${anyOf.join(', ')}` });
        }
      }

      next();
    } catch (err) {
      console.error('authorizeUtilityRole error:', err);
      res.status(500).json({ error: 'Utility authorization failed' });
    }
  };
};
