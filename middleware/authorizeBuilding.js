function authorizeBuilding(req, res, next) {
  const { building_id } = req.user;
  // Include requestedBuildingId for dynamic authorization
  const requestBuildingId = req.requestedBuildingId || req.body.building_id || req.params.building_id || req.query.building_id;

  if (!building_id) {
    return res.status(401).json({ error: 'Unauthorized: No building assigned' });
  }
  if (requestBuildingId && building_id !== requestBuildingId) {
    return res.status(403).json({ error: 'Forbidden: Building mismatch' });
  }
  next();
}

module.exports = authorizeBuilding;
