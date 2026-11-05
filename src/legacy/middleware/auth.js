/**
 * Authentication and authorization middleware for Express routes.
 * Verifies JWT token and checks role permissions against user payload.
 */
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkeyforerpsystem');

    // Attach decoded user payload to request
    req.user = decoded;
    
    // Normalize role on req.user for consistent checking across casing/naming
    if (req.user && req.user.role) {
      const r = String(req.user.role).toUpperCase().replace(/[\s-]+/g, '_');
      req.user.normalizedRole = r;
    }

    // Extract unit context header if present (supports both casing variants)
    const rawUnitId = req.headers['x-crm-unit-id'] || req.headers['x-unit-id'];
    const activeUnitId = typeof rawUnitId === 'string' ? rawUnitId.trim() : null;

    if (activeUnitId && activeUnitId !== 'ALL' && activeUnitId !== 'all') {
      req.activeUnitId = activeUnitId;
    } else {
      req.activeUnitId = null;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

/**
 * Role-Based Access Control (RBAC) middleware for Express routes.
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    const normalizeRole = (role) => (role || '').toUpperCase().replace(/[\s-]+/g, '_');
    const userRoleNorm = req.user.normalizedRole || normalizeRole(req.user.role);

    const hasPermission = allowedRoles.some((r) => {
      const allowedNorm = normalizeRole(r);
      return allowedNorm === userRoleNorm || (userRoleNorm === 'SUPER_ADMIN' && allowedNorm === 'ADMIN');
    });

    if (!hasPermission) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
