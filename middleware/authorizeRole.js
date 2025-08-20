function authorizeRole(...allowedRoles) {
  const allowed = allowedRoles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: No user info' });
    const level = String(req.user.user_level || '').toLowerCase();
    if (!allowed.includes(level)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
}


module.exports = authorizeRole;
