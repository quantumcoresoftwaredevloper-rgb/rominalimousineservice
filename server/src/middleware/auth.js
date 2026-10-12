import passport from '../config/passport.js';

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
  // Support expanded CRM roles; legacy 'admin' is super_admin equivalent
  const role = req.user?.role;
  const effective = role === 'admin' ? ['admin', 'super_admin'] : [role];
  const allowed = roles.flatMap((r) => (r === 'admin' ? ['admin', 'super_admin'] : [r]));
  if (!allowed.some((r) => effective.includes(r) || roles.includes(role))) {
    if (!roles.includes(role) && !allowed.includes(role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
  }
  next();
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