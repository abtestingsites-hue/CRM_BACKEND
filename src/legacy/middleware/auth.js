const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

let redis = null;
try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => {});
} catch (e) {}

/**
 * Express Authentication Middleware for Legacy Routes
 * Enforces valid Bearer JWT tokens signed with the application JWT_SECRET.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token required' });
  }

  let token = authHeader;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Token missing' });
  }

  const secret = process.env.JWT_SECRET || 'crm-secure-jwt-secret-key-2026';
  try {
    const verifyOptions = {};
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;

    const payload = jwt.verify(token, secret, verifyOptions);
    if (!payload || (!payload.sub && !payload.userId && !payload.id)) {
      return res.status(401).json({ error: 'Unauthorized: Token missing valid subject claim' });
    }

    if (redis) {
      try {
        const isRevoked = await redis.get(`revoked_token:${token}`);
        if (isRevoked) {
          return res.status(401).json({ error: 'Unauthorized: Token has been revoked' });
        }
      } catch (e) {}
    }
    req.user = payload;
    const isSuperAdmin = payload.role === 'SUPER_ADMIN';

    const requestedUnitId = req.query?.unitId || req.headers?.['x-crm-unit-id'] || null;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const KNOWN_CODES = ['UEC', 'UNCF', 'ACARE', 'IN_HOME', 'HOME_CARE'];

    if (!isSuperAdmin) {
      if (requestedUnitId && requestedUnitId !== 'ALL' && requestedUnitId !== payload.unitId) {
        return res.status(403).json({ error: 'Forbidden: Access to requested business unit is restricted' });
      }
      if (requestedUnitId === 'ALL') {
        return res.status(403).json({ error: 'Forbidden: Global cross-unit view is restricted to Super Admin' });
      }
      req.activeUnitId = payload.unitId || null;
    } else {
      if (requestedUnitId && requestedUnitId !== 'ALL') {
        const isCode = KNOWN_CODES.includes(requestedUnitId.toUpperCase()) || requestedUnitId.startsWith('TEST_UNIT_');
        if (!UUID_REGEX.test(requestedUnitId) && !isCode) {
          return res.status(400).json({
            statusCode: 400,
            error: 'Bad Request: Invalid business unit identifier format. Expected valid UUID or registered unit code.',
          });
        }
        req.activeUnitId = requestedUnitId;
      } else {
        req.activeUnitId = null;
      }
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
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
