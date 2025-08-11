// middleware/authorizeBuilding.js

/**
 * Centralized building authorization & scoping helpers.
 * - Admins bypass all building checks.
 * - Employees are restricted to req.user.building_id (from JWT via authenticateToken).
 *
 * Exported helpers:
 *  1) authorizeBuildingParam(): if a request *provides* building_id (body/params/query),
 *     ensure employees only act within their assigned building.
 *  2) attachBuildingScope(): for list/index GETs, attaches:
 *        - req.restrictToBuildingId: employee building id (undefined for admin)
 *        - req.buildingWhere(key='building_id'): returns { [key]: buildingId } or {}
 *  3) enforceRecordBuilding(getBuildingIdForRequest): for single-record endpoints where
 *     the resource’s building is derived indirectly (e.g., Meter → Stall.building_id).
 */

function isAdmin(req) {
  return ((req.user?.user_level) || '').toLowerCase() === 'admin';
}

function authorizeBuildingParam() {
  return (req, res, next) => {
    const userBuildingId = req.user?.building_id; // from JWT
    // also allow a controller to pre-set a building (e.g., from a path segment)
    const requestBuildingId =
      req.requestedBuildingId ||
      req.body?.building_id ||
      req.params?.building_id ||
      req.query?.building_id;

    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }

    if (isAdmin(req)) return next();

    if (requestBuildingId && userBuildingId !== requestBuildingId) {
      return res.status(403).json({ error: 'Forbidden: Building mismatch' });
    }

    next();
  };
}

function attachBuildingScope() {
  return (req, _res, next) => {
    const userBuildingId = req.user?.building_id;

    if (!isAdmin(req)) {
      req.restrictToBuildingId = userBuildingId;
      req.buildingWhere = (key = 'building_id') =>
        userBuildingId ? { [key]: userBuildingId } : {};
    } else {
      req.restrictToBuildingId = undefined;
      req.buildingWhere = () => ({});
    }

    next();
  };
}

function enforceRecordBuilding(getBuildingIdForRequest) {
  return async (req, res, next) => {
    const userBuildingId = req.user?.building_id;

    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }

    if (isAdmin(req)) return next();

    try {
      const recordBuildingId = await getBuildingIdForRequest(req);

      // Let the route handler decide 404 if not found; we only enforce when we know the building.
      if (!recordBuildingId) return next();

      if (recordBuildingId !== userBuildingId) {
        return res.status(403).json({ error: 'Forbidden: Resource not in your assigned building' });
      }

      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = {
  authorizeBuildingParam,
  attachBuildingScope,
  enforceRecordBuilding
};
