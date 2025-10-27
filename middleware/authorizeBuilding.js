// middleware/authorizeBuilding.js

// Helpers
const isAdmin = (req) => {
  const roles = Array.isArray(req.user?.user_roles) ? req.user.user_roles : [];
  return roles.map(x => String(x || '').toLowerCase()).includes('admin');
};

const getUserBuildings = (req) => {
  const b = req.user?.building_ids;
  return Array.isArray(b) ? b : [];
};

/**
 * If a request *provides* a building_id (body/params/query or req.requestedBuildingId),
 * ensure non-admin users only act within their assigned buildings.
 */
function authorizeBuildingParam() {
  return (req, res, next) => {
    if (isAdmin(req)) return next();

    const buildings = getUserBuildings(req);
    if (!buildings.length) {
      return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
    }

    const requested =
      req.requestedBuildingId ||
      req.body?.building_id ||
      req.params?.building_id ||
      req.query?.building_id;

    if (requested && !buildings.includes(requested)) {
      return res.status(403).json({ error: 'Forbidden: Building mismatch' });
    }

    next();
  };
}

/**
 * For list/index GETs:
 *  - Admins: no restriction.
 *  - Non-admins: attaches helpers tied to their building_ids:
 *       req.restrictToBuildingIds
 *       req.buildingWhere(key='building_id') -> { [key]: building_ids } or {}
 */
function attachBuildingScope() {
  return (req, _res, next) => {
    if (isAdmin(req)) {
      req.restrictToBuildingIds = undefined;
      req.buildingWhere = () => ({});
      return next();
    }

    const buildings = getUserBuildings(req);
    if (!buildings.length) {
      return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
    }

    req.restrictToBuildingIds = buildings;
    req.buildingWhere = (key = 'building_id') => ({ [key]: buildings });

    next();
  };
}

/**
 * For single-record endpoints where the record’s building is derived indirectly
 * (e.g., Meter -> Stall.building_id).
 * Pass a function that returns a Promise resolving to the record’s building_id (or null).
 */
function enforceRecordBuilding(getBuildingIdForRequest) {
  return async (req, res, next) => {
    if (isAdmin(req)) return next();

    const buildings = getUserBuildings(req);
    if (!buildings.length) {
      return res.status(401).json({ error: 'Unauthorized: No buildings assigned' });
    }

    try {
      const recordBuildingId = await getBuildingIdForRequest(req);
      if (!recordBuildingId) return next(); // let route decide 404 vs empty

      if (!buildings.includes(recordBuildingId)) {
        return res.status(403).json({ error: 'Forbidden: Resource not in your buildings' });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  authorizeBuildingParam,
  attachBuildingScope,
  enforceRecordBuilding,
};
