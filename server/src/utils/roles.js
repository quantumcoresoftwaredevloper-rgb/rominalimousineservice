// Central role/permission matrix. Every privileged route resolves through this
// table instead of ad-hoc role lists, so a role can never inherit access by
// being omitted from a deny check.

export const STAFF_ROLES = [
  'admin',
  'super_admin',
  'dispatcher',
  'manager',
  'finance',
  'support',
];

export const RIDE_VIEW_ROLES = ['admin', 'super_admin', 'dispatcher', 'manager'];

const PERMISSIONS = {
  admin: ['*'],
  super_admin: ['*'],

  manager: [
    'analytics.read',
    'rides.read',
    'rides.update',
    'rides.dispatch',
    'drivers.read',
    'users.read',
    'passengers.read',
    'fleet.read',
    'fleet.write',
    'tickets.read',
    'tickets.write',
    'audit.read',
    'content.read',
    'payments.read',
    'ops.live',
  ],

  dispatcher: [
    'analytics.read',
    'rides.read',
    'rides.update',
    'rides.dispatch',
    'drivers.read',
    'users.read',
    'passengers.read',
    'tickets.read',
    'tickets.write',
    'ops.live',
  ],

  finance: [
    'analytics.read',
    'rides.read',
    'passengers.read',
    'payments.read',
    'payments.refund',
    'refunds.decide',
    'audit.read',
  ],

  support: [
    'rides.read',
    'users.read',
    'passengers.read',
    'drivers.read',
    'tickets.read',
    'tickets.write',
    'ops.live',
  ],
};

export const normalizeRole = (role) => (role === 'admin' ? 'super_admin' : role);

export const permissionsFor = (role) => {
  const normalized = normalizeRole(role);
  if (normalized === 'super_admin') return PERMISSIONS.super_admin;
  return PERMISSIONS[normalized] || [];
};

export const hasPermission = (role, permission) => {
  const perms = permissionsFor(role);
  return perms.includes('*') || perms.includes(permission);
};

export const hasAnyPermission = (role, permissions = []) =>
  permissions.some((permission) => hasPermission(role, permission));

/** Legacy helper used by `requireRole` — explicit role allow-lists only. */
export const hasRole = (role, allowed = []) => {
  const normalized = normalizeRole(role);
  return allowed.some((entry) => normalizeRole(entry) === normalized);
};
