import { asyncHandler } from '../middleware/error.js';
import Ride from '../models/Ride.js';
import User from '../models/User.js';
import Vehicle from '../models/Vehicle.js';
import Ticket from '../models/Ticket.js';
import AuditLog from '../models/AuditLog.js';
import Location from '../models/Location.js';

export const timeseries = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  const since = new Date(Date.now() - days * 86400000);
  const rows = await Ride.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, bookings: { $sum: 1 }, revenue: { $sum: '$fare.final' } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ series: rows.map((r) => ({ date: r._id, bookings: r.bookings, revenue: Math.round(r.revenue * 100) / 100 })) });
});

export const heatmap = asyncHandler(async (req, res) => {
  const rides = await Ride.find({ 'pickup.lat': { $exists: true } }).select('pickup dropoff status').limit(500).lean();
  res.json({ points: rides.map((r) => ({ lat: r.pickup.lat, lng: r.pickup.lng, status: r.status })) });
});

export const markNoShow = asyncHandler(async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, status: { $nin: ['completed', 'cancelled', 'refunded'] } });
  if (!ride) return res.status(404).json({ message: 'Ride not found or not markable' });
  ride.status = 'no_show';
  ride.noShowReason = req.body.reason || '';
  ride.timestamps.noShow = new Date();
  await ride.save();
  const io = req.app.get('io');
  io?.to(`ride:${ride._id}`).emit('ride:update', { ride, status: 'no_show' });
  res.json({ ride });
});

export const listVehicles = asyncHandler(async (req, res) => {
  const vehicles = await Vehicle.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ vehicles });
});
// Explicit field allowlists. These endpoints previously spread req.body
// straight into create/update, so every field was caller-controlled - including
// assignedDriver, status and priority. findByIdAndUpdate also skips schema
// validators unless runValidators is set, so Vehicle.type bypassed its enum
// entirely. Allowlist plus runValidators closes both.
const VEHICLE_WRITABLE = [
  'plateNumber', 'vin', 'make', 'model', 'year', 'type',
  'capacity', 'status', 'insuranceExpiry', 'inspectionExpiry', 'registrationExpiry',
];
const TICKET_WRITABLE = ['subject', 'description', 'category', 'priority'];
const only = (body, keys) =>
  Object.fromEntries(Object.entries(body || {}).filter(([k]) => keys.includes(k)));

export const createVehicle = asyncHandler(async (req, res) => {
  const v = await Vehicle.create(only(req.body, VEHICLE_WRITABLE));
  res.status(201).json({ vehicle: v });
});
export const updateVehicle = asyncHandler(async (req, res) => {
  const v = await Vehicle.findByIdAndUpdate(
    req.params.id,
    only(req.body, VEHICLE_WRITABLE),
    { new: true, runValidators: true },
  );
  if (!v) return res.status(404).json({ message: 'Vehicle not found' });
  res.json({ vehicle: v });
});
export const deleteVehicle = asyncHandler(async (req, res) => {
  const v = await Vehicle.findByIdAndDelete(req.params.id);
  if (!v) return res.status(404).json({ message: 'Vehicle not found' });
  res.json({ success: true, id: req.params.id });
});

export const listPassengers = asyncHandler(async (req, res) => {
  const escaped = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit)) || 20));
  const { search = '' } = req.query;
  const q = { role: 'passenger' };
  if (search) {
    const rx = new RegExp(escaped(search), 'i');
    q.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [passengers, total] = await Promise.all([
    User.find(q)
      .select('-password -resetToken -verificationToken -pushSubscriptions -tokenVersion')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(q),
  ]);
  res.json({ passengers, total });
});
export const getPassenger = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    // select:false covers `password`, but resetToken / verificationToken / pushSubscriptions
    // / tokenVersion are normal fields and were being returned. The push
    // subscription keys are live VAPID credentials: anyone holding them can
    // send arbitrary push payloads to that user.
    .select('-password -resetToken -verificationToken -pushSubscriptions -tokenVersion')
    .lean();
  if (!user) return res.status(404).json({ message: 'Passenger not found' });
  const rides = await Ride.find({ passenger: user._id }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ user, rides, ltv: rides.filter((r) => r.status === 'completed').reduce((s, r) => s + (r.fare.final || 0), 0) });
});

// Polled every 8 seconds by every admin with the Live Operations map open
// (useCrmQuery refetchInterval). It did an unfiltered, unsorted, unlimited
// Location.find with a populate per document — a full collection scan plus N
// populates, every 8 seconds, per admin, forever. Bounded now.
export const liveOps = asyncHandler(async (req, res) => {
  const [locations, activeRides] = await Promise.all([
    Location.find()
      // Drop offline docs (stale positions) and cap the result set.
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('driver', 'name driverDetails')
      .lean(),
    Ride.find({ status: { $in: ['accepted', 'arriving', 'in_progress'] } })
      .select('pickup dropoff driver passenger status')
      .limit(200)
      .lean(),
  ]);
  res.json({ drivers: locations, activeRides });
});

export const listTickets = asyncHandler(async (req, res) => {
  const tickets = await Ticket.find().sort({ createdAt: -1 }).limit(50).populate('passenger ride').lean();
  res.json({ tickets });
});
export const createTicket = asyncHandler(async (req, res) => {
  const t = await Ticket.create({
    ...only(req.body, TICKET_WRITABLE),
    assignee: req.user._id,
  });
  res.status(201).json({ ticket: t });
});
export const updateTicket = asyncHandler(async (req, res) => {
  const t = await Ticket.findByIdAndUpdate(
    req.params.id,
    only(req.body, [...TICKET_WRITABLE, 'status', 'assignee']),
    { new: true, runValidators: true },
  );
  if (!t) return res.status(404).json({ message: 'Ticket not found' });
  res.json({ ticket: t });
});

export const listAudit = asyncHandler(async (req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ logs });
});
