// middleware/authorizeBuilding.js
'use strict';

const { Op } = require('sequelize');

function isAdmin(user) {
  const roles = Array.isArray(user?.user_roles) ? user.user_roles.map(r => String(r).toLowerCase()) : [];
  return roles.includes('admin');
}

function getUserBuildings(user) {
  const arr = Array.isArray(user?.building_ids) ? user.building_ids : [];
  const single = user?.building_id ? [user.building_id] : [];
  return Array.from(new Set([...arr, ...single].map(String)));
}

/**
 * authorizeBuildingParam()
 * - Uses req.params.building_id if present.
 * - Otherwise uses req.requestedBuildingId (e.g., set by authorizeUtilityRole from meter).
 */
function authorizeBuildingParam() {
  return function (req, res, next) {
    if (isAdmin(req.user)) return next();

    const allowed = getUserBuildings(req.user);
    if (!allowed.length) {
      return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
    }

    const requested = String(req.params?.building_id || req.requestedBuildingId || '');
    if (!requested) {
      return res.status(400).json({ error: 'No building specified for authorization' });
    }

    if (!allowed.includes(requested)) {
      return res.status(403).json({ error: 'No access to this building' });
    }

    next();
  };
}

/**
 * attachBuildingScope()
 * - Adds:
 *   - req.restrictToBuildingIds: string[] | null (null for admin = no restriction)
 *   - req.buildingWhere(key): returns a where clause piece for Sequelize
 */
function attachBuildingScope() {
  return function (req, res, next) {
    if (isAdmin(req.user)) {
      req.restrictToBuildingIds = null;
      req.buildingWhere = () => ({});
      return next();
    }
    const ids = getUserBuildings(req.user);
    if (!ids.length) {
      return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
    }
    req.restrictToBuildingIds = ids;
    req.buildingWhere = (key) => ({ [key]: { [Op.in]: ids } });
    next();
  };
}

/**
 * enforceRecordBuilding(getBuildingIdForRequest)
 * - For single-record routes where the building is inferred (e.g., from meter_id).
 * - Calls await getBuildingIdForRequest(req) → building_id, then checks it.
 */
function enforceRecordBuilding(getBuildingIdForRequest) {
  return async function (req, res, next) {
    try {
      if (isAdmin(req.user)) return next();

      const allowed = getUserBuildings(req.user);
      if (!allowed.length) {
        return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
        }

      const recordBuildingId = await getBuildingIdForRequest(req);
      const candidate = String(recordBuildingId || req.requestedBuildingId || '');
      if (!candidate) {
        return res.status(400).json({ error: 'Unable to resolve building for this record' });
      }

      if (!allowed.includes(candidate)) {
        return res.status(403).json({ error: 'No access to this record’s building' });
      }

      next();
    } catch (err) {
      console.error('enforceRecordBuilding error:', err);
      res.status(500).json({ error: 'Building authorization failed' });
    }
  };
}

module.exports = {
  authorizeBuildingParam,
  attachBuildingScope,
  enforceRecordBuilding,
};
