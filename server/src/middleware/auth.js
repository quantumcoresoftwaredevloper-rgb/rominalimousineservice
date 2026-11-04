import passport from '../config/passport.js';
import { hasPermission, hasRole } from '../utils/roles.js';

// Protects routes via the Passport JWT strategy (stateless Bearer token).
// Same 401 shape as before: { code: 'TOKEN_EXPIRED' } lets the client refresh.
export const protect = (req, res, next) =>
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      const expired = info?.name === 'TokenExpiredError';
      return res.status(401).json({
        message: expired ? 'Token expired' : 'Not authorized, invalid token',
        ...(expired ? { code: 'TOKEN_EXPIRED' } : {}),
      });
    }
    // Suspended accounts are rejected even with a valid token.
    if (user.isSuspended) {
      return res.status(403).json({ message: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
    }
    req.user = user;
    next();
  })(req, res, next);

export const requireRole = (...roles) => (req, res, next) => {
  if (!hasRole(req.user?.role, roles)) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  return next();
};

// Permission-based guard for privileged CRM/admin routes. Using a named
// permission (not a role list) keeps each endpoint's authority explicit and
// testable; `admin`/`super_admin` hold every permission.
export const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user?.role, permission)) {
    return res.status(403).json({ message: 'Insufficient permissions' });
  }
  return next();
};


// Drivers must be admin-approved before they can work (go online, accept rides,
// share location). Passengers/admins are unaffected.
export const requireApprovedDriver = (req, res, next) => {
  if (req.user?.role !== 'driver') return next();
  if (!req.user?.isApproved) {
    return res.status(403).json({
      message: 'Your driver account is awaiting admin approval.',
      code: 'DRIVER_NOT_APPROVED',
    });
  }
  return next();
};