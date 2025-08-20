// middleware/authorizeBuilding.js

/**
 * Centralized building authorization & scoping helpers.
 * - Admins bypass all building checks.
 * - Non-admins are restricted to req.user.building_id (from JWT via authenticateToken).
 *
 * Exports:
 *  1) authorizeBuildingParam()
 *  2) attachBuildingScope()
 *  3) enforceRecordBuilding(getBuildingIdForRequest)
 */

function isAdmin(req) {
  return ((req.user?.user_level) || '').toLowerCase() === 'admin';
}

/**
 * If a request *provides* a building_id (body/params/query or req.requestedBuildingId),
 * ensure non-admin users only act within their assigned building.
 */
function authorizeBuildingParam() {
  return (req, res, next) => {
    // Admins skip building checks
    if (isAdmin(req)) return next();

    const userBuildingId = req.user?.building_id; // from JWT
    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }

    // Controller may pre-set requested building (e.g., from path segments)
    const requestBuildingId =
      req.requestedBuildingId ||
      req.body?.building_id ||
      req.params?.building_id ||
      req.query?.building_id;

    if (requestBuildingId && userBuildingId !== requestBuildingId) {
      return res.status(403).json({ error: 'Forbidden: Building mismatch' });
    }

    next();
  };
}

/**
 * For list/index GETs:
 *  - Admins: no restriction.
 *  - Non-admins: attaches helpers tied to their building_id:
 *       req.restrictToBuildingId
 *       req.buildingWhere(key='building_id') -> { [key]: buildingId } or {}
 */
function attachBuildingScope() {
  return (req, _res, next) => {
    if (!isAdmin(req)) {
      const userBuildingId = req.user?.building_id;
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

/**
 * For single-record endpoints where the record’s building is derived indirectly
 * (e.g., Meter -> Stall.building_id).
 * Pass a function that returns a Promise resolving to the record’s building_id (or null).
 */
function enforceRecordBuilding(getBuildingIdForRequest) {
  return async (req, res, next) => {
    // Admins skip building checks
    if (isAdmin(req)) return next();

    const userBuildingId = req.user?.building_id;
    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }

    try {
      const recordBuildingId = await getBuildingIdForRequest(req);

      // Let route handler 404 if the record doesn't exist; only enforce when we know the building.
      if (!recordBuildingId) return next();

      if (recordBuildingId !== userBuildingId) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Resource not in your assigned building' });
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
