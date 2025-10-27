// middleware/authorizeRole.js
function authorizeRole(...allowedRoles) {
  const allowed = allowedRoles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized: No user info' });

    const roles = Array.isArray(req.user.user_roles) ? req.user.user_roles : [];
    const normalized = roles.map(r => String(r || '').toLowerCase());

    const ok = normalized.some(r => allowed.includes(r));
    if (!ok) return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });

    next();
  };
}
module.exports = authorizeRole;
