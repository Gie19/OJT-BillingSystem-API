
function isAdmin(req) {
  return ((req.user?.user_level) || '').toLowerCase() === 'admin';
}

function authorizeBuildingParam() {
  return (req, res, next) => {
    // Admins bypass building checks entirely
    if (isAdmin(req)) return next();

    const userBuildingId = req.user?.building_id; // from JWT
    const requestBuildingId =
      req.requestedBuildingId ||
      req.body?.building_id ||
      req.params?.building_id ||
      req.query?.building_id;

    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }
    if (requestBuildingId && userBuildingId !== requestBuildingId) {
      return res.status(403).json({ error: 'Forbidden: Building mismatch' });
    }
    next();
  };
}

function enforceRecordBuilding(getBuildingIdForRequest) {
  return async (req, res, next) => {
    // Admins bypass building checks entirely
    if (isAdmin(req)) return next();

    const userBuildingId = req.user?.building_id;
    if (!userBuildingId) {
      return res.status(401).json({ error: 'Unauthorized: No building assigned' });
    }

    try {
      const recordBuildingId = await getBuildingIdForRequest(req);
      if (!recordBuildingId) return next(); // let handler 404 if needed
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
  attachBuildingScope,   // your existing function can stay as-is
  enforceRecordBuilding
};
