// middleware/authorizeUtilityRole.js
const Meter = require('../models/Meter');
const Stall = require('../models/Stall');

/**
 * Enforce per-utility access (electric | water | lpg) for selected roles.
 *
 * Options:
 *  - roles:        roles this applies to (default ['biller'])
 *  - anyOf:        when no meter is involved, require these utilities
 *  - requireAll:   if true require ALL in anyOf, else ANY one (default true)
 *  - adminBypass:  admins skip the check (default true)
 *  - meterIdFields: dotted paths to search for meter_id (default ['body.meter_id','params.meter_id','params.id'])
 *
 * Behavior:
 *  - If a meter_id is present, resolve meter -> utility (+ stall -> building) and
 *    require the user's utility_role to include that utility. Also sets:
 *      req.meterUtility         (string: 'electric'|'water'|'lpg')
 *      req.requestedBuildingId  (so authorizeBuilding can scope)
 *  - If no meter_id, but anyOf is provided, enforce against that set.
 */
function authorizeUtilityRole(opts = {}) {
  const {
    roles = ['biller'],
    anyOf = null,
    requireAll = true,
    adminBypass = true,
    meterIdFields = ['body.meter_id', 'params.meter_id', 'params.id'],
  } = opts;

  const ALLOWED = new Set(['electric', 'water', 'lpg']);
  const ENFORCED_ROLES = roles.map(r => String(r).toLowerCase());

  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const userRoles = Array.isArray(user.user_roles) ? user.user_roles.map(r => String(r).toLowerCase()) : [];

      // Admin bypass
      if (adminBypass && userRoles.includes('admin')) return next();

      // If the caller's roles don't intersect the enforced set, skip checks
      const roleInScope = userRoles.some(r => ENFORCED_ROLES.includes(r));
      if (!roleInScope) return next();

      // Normalize user's allowed utilities
      const granted = Array.isArray(user.utility_role)
        ? user.utility_role.map(x => String(x).toLowerCase())
        : [];

      if (!granted.every(g => ALLOWED.has(g))) {
        return res.status(400).json({ error: 'User has invalid utility_role values' });
      }

      // 1) Meter-based enforcement
      let util = (req.meterUtility || '').toLowerCase();
      if (!util) {
        const meterId = findFirst(req, meterIdFields);
        if (meterId) {
          const meter = await Meter.findOne({
            where: { meter_id: meterId },
            attributes: ['meter_type', 'stall_id'],
          });
          if (!meter) return res.status(404).json({ error: 'Meter not found' });

          util = String(meter.meter_type || '').toLowerCase();
          if (!ALLOWED.has(util)) {
            return res.status(400).json({ error: `Unknown meter utility type: ${util}` });
          }

          // also set building for authorizeBuilding
          const stall = await Stall.findOne({
            where: { stall_id: meter.stall_id },
            attributes: ['building_id'],
          });
          if (stall?.building_id) req.requestedBuildingId = stall.building_id;

          req.meterUtility = util; // expose downstream
        }
      }

      if (util) {
        if (!granted.includes(util)) {
          return res.status(403).json({ error: `Forbidden: missing ${util} access` });
        }
        return next();
      }

      // 2) Non-meter endpoints: enforce anyOf (if provided)
      if (Array.isArray(anyOf) && anyOf.length > 0) {
        const needed = anyOf.map(x => String(x).toLowerCase());
        if (!needed.every(n => ALLOWED.has(n))) {
          return res.status(400).json({ error: 'Middleware misconfigured: invalid anyOf utility' });
        }
        const ok = requireAll
          ? needed.every(n => granted.includes(n))
          : needed.some(n => granted.includes(n));

        if (!ok) {
          const mode = requireAll ? 'all of' : 'one of';
          return res.status(403).json({ error: `Forbidden: requires ${mode} [${needed.join(', ')}]` });
        }
      }

      return next();
    } catch (err) {
      console.error('authorizeUtilityRole error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  };
}

// helpers
function findFirst(req, dottedPaths) {
  for (const p of dottedPaths) {
    const v = p.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), req);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

module.exports = authorizeUtilityRole;
