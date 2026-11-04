import User from '../models/User.js';
import Location from '../models/Location.js';
import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';
import { getRoute } from './rideService.js';

export const getDriverPosition = async (driverId) => {
  const loc = await Location.findOne({ driver: driverId });
  if (!loc) return null;
  return { lat: loc.coordinates.coordinates[1], lng: loc.coordinates.coordinates[0] };
};

// Route + ETA from the driver's last known position to a target point
export const getDriverEta = async (driverId, to) => {
  const from = await getDriverPosition(driverId);
  if (!from) {
    throw Object.assign(new Error('Driver location unknown'), { statusCode: 404 });
  }
  const { distanceKm, durationMin, polyline } = await getRoute(from, to);
  return { distanceKm, durationMin, route: polyline, from };
};

export const updateAvailability = async (driverId, isAvailable) => {
  const driver = await User.findById(driverId);
  if (!driver || driver.role !== 'driver') {
    throw Object.assign(new Error('Driver not found'), { statusCode: 404 });
  }

  driver.driverDetails.isAvailable = isAvailable;
  await driver.save();
  return driver;
};

export const updateLocation = async (driverId, { lat, lng, heading = 0, speed = 0 }) => {
  await Location.findOneAndUpdate(
    { driver: driverId },
    {
      driver: driverId,
      coordinates: { type: 'Point', coordinates: [lng, lat] },
      heading,
      speed,
      updatedAt: new Date(),
    },
    { upsert: true, new: true }
  );
};

const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE || 'America/New_York';
const dayKey = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

export const getDriverStats = async (driverId) => {
  const now = new Date();
  const todayKey = dayKey(now);
  const weekKey = dayKey(new Date(now.getTime() - 6 * 86400000));
  const monthKey = todayKey.slice(0, 7);

  const [ranges, totals, breakdown, daily, user] = await Promise.all([
    Ride.aggregate([
      { $match: { driver: driverId, status: 'completed', 'timestamps.completed': { $exists: true } } },
      {
        $addFields: {
          completedDay: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamps.completed', timezone: BUSINESS_TZ },
          },
          completedMonth: {
            $dateToString: { format: '%Y-%m', date: '$timestamps.completed', timezone: BUSINESS_TZ },
          },
        },
      },
      {
        $group: {
          _id: null,
          lifetime: { $sum: '$fare.final' },
          today: {
            $sum: { $cond: [{ $eq: ['$completedDay', todayKey] }, '$fare.final', 0] },
          },
          week: {
            $sum: { $cond: [{ $gte: ['$completedDay', weekKey] }, '$fare.final', 0] },
          },
          month: {
            $sum: { $cond: [{ $eq: ['$completedMonth', monthKey] }, '$fare.final', 0] },
          },
          todayTrips: {
            $sum: { $cond: [{ $eq: ['$completedDay', todayKey] }, 1, 0] },
          },
          weekTrips: {
            $sum: { $cond: [{ $gte: ['$completedDay', weekKey] }, 1, 0] },
          },
          monthTrips: {
            $sum: { $cond: [{ $eq: ['$completedMonth', monthKey] }, 1, 0] },
          },
        },
      },
    ]),
    Ride.aggregate([
      { $match: { driver: driverId } },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          completedRides: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          scheduledRides: {
            $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] },
          },
        },
      },
    ]),
    Payment.aggregate([
      {
        $lookup: {
          from: 'rides',
          localField: 'ride',
          foreignField: '_id',
          as: 'rideDoc',
        },
      },
      { $unwind: '$rideDoc' },
      {
        $match: {
          'rideDoc.driver': driverId,
          'rideDoc.status': 'completed',
          status: { $in: ['succeeded', 'cash_collected', 'cash', 'cash_due'] },
        },
      },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),
    Ride.aggregate([
      {
        $match: {
          driver: driverId,
          status: 'completed',
          'timestamps.completed': { $exists: true },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamps.completed', timezone: BUSINESS_TZ },
          },
          earnings: { $sum: '$fare.final' },
          trips: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    User.findById(driverId).select('driverDetails.stats').lean(),
  ]);

  const r = ranges[0] || {};
  const t = totals[0] || {};
  const byStatus = Object.fromEntries(breakdown.map((b) => [b._id, b.total]));
  const collected = (byStatus.cash || 0) + (byStatus.cash_collected || 0) + (byStatus.succeeded || 0);

  const dailyMap = Object.fromEntries(daily.map((d) => [d._id, d]));
  const dailySeries = Array.from({ length: 7 }).map((_, i) => {
    const key = dayKey(new Date(now.getTime() - (6 - i) * 86400000));
    return {
      date: key,
      earnings: Math.round((dailyMap[key]?.earnings || 0) * 100) / 100,
      trips: dailyMap[key]?.trips || 0,
    };
  }).filter((d) => d.date >= weekKey);

  const stats = user?.driverDetails?.stats || {};
  return {
    completedRides: t.completedRides || 0,
    totalRides: t.totalRides || 0,
    scheduledRides: t.scheduledRides || 0,
    totalFares: Math.round((r.lifetime || 0) * 100) / 100,
    todayEarnings: Math.round((r.today || 0) * 100) / 100,
    weekEarnings: Math.round((r.week || 0) * 100) / 100,
    monthEarnings: Math.round((r.month || 0) * 100) / 100,
    todayTrips: r.todayTrips || 0,
    weekTrips: r.weekTrips || 0,
    monthTrips: r.monthTrips || 0,
    collected: Math.round(collected * 100) / 100,
    cashCollected: Math.round(((byStatus.cash || 0) + (byStatus.cash_collected || 0)) * 100) / 100,
    cardCollected: Math.round((byStatus.succeeded || 0) * 100) / 100,
    cashDue: Math.round((byStatus.cash_due || 0) * 100) / 100,
    rating: stats.rating || 0,
    ratingCount: stats.ratingCount || 0,
    compliments: stats.compliments || {},
    daily: dailySeries,
  };
};
