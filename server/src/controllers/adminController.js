import { asyncHandler } from '../middleware/error.js';
import Ride from '../models/Ride.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Location from '../models/Location.js';
import RefreshToken from '../models/RefreshToken.js';
import { getSettings, updateSettings } from '../services/settingsService.js';
import * as rideService from '../services/rideService.js';
import * as adminRideService from '../services/adminRideService.js';
import * as adminUserService from '../services/adminUserService.js';
import * as contentService from '../services/contentService.js';
import { notify } from '../services/notificationService.js';

// True for every role outside passenger/driver — i.e. admin, super_admin,
// dispatcher, manager, finance, support. Mirrors isStaff() in adminUserService,
// which updateUser already used; suspend/delete bypassed it entirely.
const isStaffRole = (role) => !['passenger', 'driver'].includes(role);

const ioOf = (req) => req.app.get('io');

// Escape user-supplied search text before building a RegExp — prevents regex
// injection / ReDoS on untrusted input reaching the query layer.
const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageOf = (v, fallback = 1) => Math.max(1, Math.floor(Number(v)) || fallback);
const limitOf = (v, fallback = 20, max = 100) =>
  Math.min(max, Math.max(1, Math.floor(Number(v)) || fallback));

// GET /api/admin/analytics
export const analytics = asyncHandler(async (req, res) => {
  const [
    totalRides,
    activeRides,
    scheduledRides,
    totalDrivers,
    approvedDrivers,
    onlineDrivers,
    totalPassengers,
    revenue,
    ratingAgg,
    recentRides,
  ] = await Promise.all([
    Ride.countDocuments(),
    Ride.countDocuments({ status: { $in: ['pending', 'accepted', 'arriving', 'in_progress'] } }),
    Ride.countDocuments({ status: 'scheduled' }),
    User.countDocuments({ role: 'driver' }),
    User.countDocuments({ role: 'driver', isApproved: true }),
    User.countDocuments({ role: 'driver', isApproved: true, 'driverDetails.isAvailable': true }),
    User.countDocuments({ role: 'passenger' }),
    // Revenue is money actually collected, not the sum of quoted fares. Cash
    // counts only after the driver records collection.
    Payment.aggregate([
      { $match: { status: { $in: ['succeeded', 'cash_collected', 'cash'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    User.aggregate([
      { $match: { role: 'driver', 'driverDetails.stats.ratingCount': { $gt: 0 } } },
      {
        $group: {
          _id: null,
          rating: { $avg: '$driverDetails.stats.rating' },
          reviews: { $sum: '$driverDetails.stats.ratingCount' },
        },
      },
    ]),
    Ride.find().sort({ createdAt: -1 }).limit(10).populate('passenger driver', 'name'),
  ]);

  res.json({
    totalRides,
    activeRides,
    scheduledRides,
    totalDrivers,
    approvedDrivers,
    onlineDrivers,
    totalPassengers,
    revenue: revenue[0]?.total || 0,
    averageRating: ratingAgg[0]?.rating ? Math.round(ratingAgg[0].rating * 10) / 10 : 0,
    ratingCount: ratingAgg[0]?.reviews || 0,
    recentRides,
  });
});

// GET /api/admin/rides?status=&page=&limit=
export const rides = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = pageOf(req.query.page);
  const limit = limitOf(req.query.limit);
  const query = status ? { status } : {};
  const [rides, total] = await Promise.all([
    Ride.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('passenger driver', 'name phone avatar'),
    Ride.countDocuments(query),
  ]);
  res.json({ rides, total, page, limit });
});

// GET /api/admin/drivers
export const drivers = asyncHandler(async (req, res) => {
  // pushSubscriptions carries live VAPID keys - never send it to a client.
  const drivers = await User.find({ role: 'driver' })
    .select('-password -pushSubscriptions')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  res.json({ drivers });
});

// PATCH /api/admin/drivers/:id/approve { approved: boolean }
export const approveDriver = asyncHandler(async (req, res) => {
  const approved = req.body.approved !== false;
  const update = { isApproved: approved };
  // Un-approving a driver must also take them off the road immediately.
  if (!approved) update['driverDetails.isAvailable'] = false;
  const driver = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'driver' },
    { $set: update },
    { new: true }
  ).select('-password -pushSubscriptions');
  if (!driver) return res.status(404).json({ message: 'Driver not found' });
  res.json({ driver });
});

// PATCH /api/admin/rides/:id/driver { driverId } - assign a driver to a ride,
// or { driverId: null } to remove the assigned driver and return to the board.
export const assignDriver = asyncHandler(async (req, res) => {
  const { ride, removedDriverId } = await rideService.assignDriver(
    req.params.id,
    req.body.driverId ?? null
  );
  const io = ioOf(req);

  io.to(`ride:${ride._id}`).emit('ride:update', { ride, status: ride.status });
  io.to('admins').emit('ride:update', { ride, status: ride.status });

  if (ride.driver) {
    await Promise.all([
      notify({
        user: ride.passenger._id,
        type: 'ride',
        title: 'Driver assigned',
        message: `${ride.driver.name} has been assigned to your ride.`,
        data: { rideId: ride._id },
        io,
      }),
      notify({
        user: ride.driver._id,
        type: 'ride',
        title: 'New ride assigned',
        message: `Pick up ${ride.passenger.name} at ${ride.pickup.address}.`,
        data: { rideId: ride._id },
        io,
      }),
    ]);
  } else if (removedDriverId) {
    await Promise.all([
      notify({
        user: ride.passenger._id,
        type: 'ride',
        title: 'Driver reassigned',
        message: 'Your ride is back on the board; dispatch is finding you another driver.',
        data: { rideId: ride._id },
        io,
      }),
notify({
        user: removedDriverId,
        type: 'ride',
        title: 'Assignment removed',
        message: 'Your assignment to a ride was reassigned by dispatch.',
        data: { rideId: ride._id },
        io,
      }),
    ]);
  }

  res.json({ ride });
});

// PATCH /api/admin/drivers/:id { driverDetails.isAvailable }
export const toggleDriver = asyncHandler(async (req, res) => {
  const driver = await User.findOne({ _id: req.params.id, role: 'driver' }).select('isApproved');
  if (!driver) return res.status(404).json({ message: 'Driver not found' });
  if (req.body.isAvailable && !driver.isApproved) {
    return res.status(400).json({ message: 'Approve the driver before placing them on duty' });
  }
  const updated = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { 'driverDetails.isAvailable': !!req.body.isAvailable } },
    { new: true }
  ).select('-password -pushSubscriptions');
  res.json({ driver: updated });
});

// GET /api/admin/users?search=&role=&page=&limit=
export const users = asyncHandler(async (req, res) => {
  const { search = '', role = '' } = req.query;
  const page = pageOf(req.query.page);
  const limit = limitOf(req.query.limit);
  const query = {};
  if (role) query.role = role;
  if (search) {
    const rx = new RegExp(escaped(search), 'i');
    query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);
  res.json({ users, total, page, limit });
});

// PATCH /api/admin/users/:id/suspend
export const suspendUser = asyncHandler(async (req, res) => {
  // This had no target-role check at all, and the route is open to support,
  // finance, dispatcher and manager — so any of them could suspend an admin
  // or super_admin and revoke that account's live sessions. Reuse the same
  // staff guard that updateUser already applies.
  const target = await User.findById(req.params.id).select('role');
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (isStaffRole(target.role)) {
    return res.status(400).json({ message: 'Staff & admin accounts cannot be suspended here' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isSuspended: true },
    { new: true }
  ).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  // Kick their active refresh sessions so they can't keep using the app.
  await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  res.json({ user });
});

// PATCH /api/admin/users/:id/unsuspend
export const unsuspendUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id).select('role');
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (isStaffRole(target.role)) {
    return res.status(400).json({ message: 'Staff & admin accounts cannot be suspended here' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isSuspended: false },
    { new: true }
  ).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user });
});

// DELETE /api/admin/users/:id — anonymises the account and preserves the
// financial record. Hard-deleting rides/payments destroyed the audit trail
// required for tax, disputes and chargebacks.
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  if (isStaffRole(user.role)) {
    return res.status(400).json({ message: 'Cannot delete a staff or admin account' });
  }

  // Free a driver from any in-flight ride before removing their identity.
  await Ride.updateMany(
    { driver: user._id, status: { $in: ['accepted', 'arriving', 'in_progress'] } },
    {
      $set: {
        driver: null,
        status: 'cancelled',
        cancelReason: 'Driver account removed',
        'timestamps.cancelled': new Date(),
      },
    },
  );

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        name: 'Deleted user',
        email: `deleted+${user._id}@invalid.local`,
        phone: '',
        avatar: '',
        isSuspended: true,
        isApproved: false,
        tokenVersion: (user.tokenVersion || 1) + 1,
      },
      $unset: {
        driverDetails: '',
        pushSubscriptions: '',
        verificationToken: '',
        resetToken: '',
      },
    },
  );

  await Promise.all([
    Location.deleteMany({ driver: user._id }),
    RefreshToken.deleteMany({ user: user._id }),
  ]);
  res.json({ success: true, anonymized: true });
});

// GET /api/admin/payments?status=&page=&limit=
export const payments = asyncHandler(async (req, res) => {
  const { status = '' } = req.query;
  const page = pageOf(req.query.page);
  const limit = limitOf(req.query.limit);
  const query = status ? { status } : {};
  const [payments, total, summary] = await Promise.all([
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name email')
      .populate('ride', 'pickup dropoff'),
    Payment.countDocuments(query),
    Payment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);
  res.json({
    payments,
    total,
    page,
    limit,
    summary: Object.fromEntries(summary.map((s) => [s._id, s])),
  });
});

// GET /api/admin/settings
export const settings = asyncHandler(async (req, res) => {
  res.json({ settings: await getSettings() });
});

// PATCH /api/admin/settings
export const updateAppSettings = asyncHandler(async (req, res) => {
  res.json({ settings: await updateSettings(req.body) });
});

// ----------------------- Content (CMS) -----------------------

// GET /api/admin/content — all stored site-content blocks
export const listContent = asyncHandler(async (req, res) => {
  res.json({ content: await contentService.getContentMap() });
});

// PATCH /api/admin/content — body { key, value }; value null clears the block
export const updateContent = asyncHandler(async (req, res) => {
  const { key, value } = req.body || {};
  const saved = await contentService.setContent(key, value);
  res.json({ key, value: saved });
});

// ----------------------- User management -----------------------

// POST /api/admin/users — create a passenger or driver
export const createUser = asyncHandler(async (req, res) => {
  res.status(201).json({ user: await adminUserService.createUser(req.body) });
});

// PATCH /api/admin/users/:id — full user/driver edit
export const updateUser = asyncHandler(async (req, res) => {
  res.json({ user: await adminUserService.updateUser(req.params.id, req.body) });
});

// ----------------------- Ride management -----------------------

// PATCH /api/admin/rides/:id — cancel / complete / re-open / adjust fare
export const updateRide = asyncHandler(async (req, res) => {
  const ride = await adminRideService.adminUpdateRide(req.params.id, req.body);
  const io = req.app.get('io');
  io?.to(`ride:${ride._id}`).emit('ride:update', { ride, status: ride.status });
  io?.to('admins').emit('ride:update', { ride, status: ride.status });
  if (ride.passenger) {
    await notify({
      user: ride.passenger._id,
      type: 'ride',
      title: 'Ride updated by dispatch',
      message: `Your ride is now "${ride.status.replace('_', ' ')}".`,
      data: { rideId: ride._id },
      io,
    }).catch(() => {});
  }
  res.json({ ride });
});