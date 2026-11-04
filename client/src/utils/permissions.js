const PERMISSIONS = {
  admin: ['*'],
  super_admin: ['*'],
  manager: [
    'analytics.read', 'rides.read', 'rides.update', 'rides.dispatch',
    'drivers.read', 'users.read', 'passengers.read', 'fleet.read', 'fleet.write',
    'tickets.read', 'tickets.write', 'audit.read', 'content.read',
    'payments.read', 'ops.live',
  ],
  dispatcher: [
    'analytics.read', 'rides.read', 'rides.update', 'rides.dispatch',
    'drivers.read', 'users.read', 'passengers.read',
    'tickets.read', 'tickets.write', 'ops.live',
  ],
  finance: [
    'analytics.read', 'rides.read', 'passengers.read',
    'payments.read', 'payments.refund', 'refunds.decide', 'audit.read',
  ],
  support: [
    'rides.read', 'users.read', 'passengers.read', 'drivers.read',
    'tickets.read', 'tickets.write', 'ops.live',
  ],
};

const normalize = (role) => (role === 'admin' ? 'super_admin' : role);

export const hasPermission = (role, permission) => {
  const perms = PERMISSIONS[normalize(role)] || [];
  return perms.includes('*') || perms.includes(permission);
};
