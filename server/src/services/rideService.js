import Ride from '../models/Ride.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { getSettings } from './settingsService.js';

const RADIUS_M = 5000;

// Radius used to notify nearby drivers about a new reservation (10 km).
export const NOTIFY_RADIUS_M = 10000;

// Simple in-memory cache for external APIs (Nominatim 1 req/s, OSRM)
const GEOCODE_CACHE = new Map(); // key: query -> {value, expiry}
const ROUTE_CACHE = new Map(); // key: from-to -> {value, expiry}
const cacheGet = (cache, key) => {
  const hit = cache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return null;
};
const cacheSet = (cache, key, value, ttlMs = 5 * 60 * 1000) => {
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiry: Date.now() + ttlMs });
};

// Geocoding via Nominatim (OpenStreetMap) - free, no API key
// e.g. GET https://nominatim.openstreetmap.org/search?q=...&format=json
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

export const geocode = async (query) => {
  const q = String(query).trim().toLowerCase();
  const cached = cacheGet(GEOCODE_CACHE, q);
  if (cached) return cached;
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, { headers: { 'User-Agent': 'RominaLimousine/1.0' } });
  if (!res.ok) throw Object.assign(new Error('Geocoding failed'), { statusCode: 502 });
  const data = await res.json();
  if (!data.length) throw Object.assign(new Error('Location not found'), { statusCode: 404 });
  const result = { address: data[0].display_name, lat: +data[0].lat, lng: +data[0].lon };
  cacheSet(GEOCODE_CACHE, q, result, 10 * 60 * 1000);
  return result;
};

// OSRM route calculation - returns distance, duration, and polyline
export const getRoute = async (from, to) => {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}-${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const cached = cacheGet(ROUTE_CACHE, key);
  if (cached) return cached;
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw Object.assign(new Error('Route calculation failed'), { statusCode: 502 });
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw Object.assign(new Error('No route found'), { statusCode: 404 });

  const distanceKm = Math.round(route.distance / 1000);
  const durationMin = Math.round(route.duration / 60);
  const polyline = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const result = { distanceKm, durationMin, polyline };
  cacheSet(ROUTE_CACHE, key, result, 5 * 60 * 1000);
  return result;
};

// Simple fare: base + per-km (vehicle-specific, overridable from Admin Settings).
const estimateFare = (distanceKm, durationMin, vehicleType, overrides = {}) => {
  const rates = {
    'executive-sedan': { base: 6, perKm: 1.9, perMin: 0.4 },
    'economy-sedan': { base: 3, perKm: 1.4, perMin: 0.3 },
    'economy-suv': { base: 5, perKm: 1.8, perMin: 0.4 },
    'premium-suv': { base: 7, perKm: 2.2, perMin: 0.45 },
    'luxury-suv': { base: 10, perKm: 2.6, perMin: 0.5 },
    SUV: { base: 7, perKm: 2.2, perMin: 0.45 },
    Chevrolet: { base: 8, perKm: 2.4, perMin: 0.5 },
    van: { base: 8, perKm: 2.0, perMin: 0.42 },
    'mini-coach': { base: 35, perKm: 3.5, perMin: 0.8 },
    'school-bus': { base: 45, perKm: 4.0, perMin: 0.9 },
    motorcoach: { base: 70, perKm: 5.0, perMin: 1.2 },
  };
  const rate = rates[vehicleType] || rates['economy-sedan'];
  // Global overrides (Admin Settings) take precedence when set.
  const base = overrides.baseFare ?? rate.base;
  const perKm = overrides.perKm ?? rate.perKm;
  const perMin = overrides.perMin ?? rate.perMin;
  const total = base + distanceKm * perKm + durationMin * perMin;
  return Math.round(total * 100) / 100;
};

// Seating capacity per vehicle type. The server is the authority: the client
// only ever *displays* a capacity, so a caller hitting the API directly
// bypasses any UI clamp entirely. Without this the schema's `min: 1` is the
// only bound and `passengerCount: 500` persists against a 4-seat sedan, which
// is discovered at the kerb.
const VEHICLE_CAPACITY = {
  'executive-sedan': 4,
  'economy-sedan': 4,
  'economy-suv': 6,
  'premium-suv': 6,
  'luxury-suv': 7,
  SUV: 6,
  Chevrolet: 6,
  van: 14,
  'mini-coach': 32,
  'school-bus': 48,
  motorcoach: 56,
};
const DEFAULT_CAPACITY = 4;

// Luggage scales with the vehicle, not with the party size. A sedan cannot
// take a group's worth of bags even when it is carrying four passengers.
const VEHICLE_BAG_CAPACITY = {
  'executive-sedan': 3,
  'economy-sedan': 3,
  'economy-suv': 4,
  'premium-suv': 4,
  'luxury-suv': 5,
  SUV: 4,
  Chevrolet: 4,
  van: 12,
  'mini-coach': 32,
  'school-bus': 20,
  motorcoach: 40,
};

// Clamp rather than reject. A stale client still sends its own count, and
// failing a legitimate booking is worse than landing it on the largest party
// the vehicle can actually carry. Non-numeric input resolves to the maximum,
// a negative number to zero.
const clampToVehicleCapacity = (vehicleType, passengerCount, bags) => {
  const maxPassengers = VEHICLE_CAPACITY[vehicleType] ?? DEFAULT_CAPACITY;
  const maxBags = VEHICLE_BAG_CAPACITY[vehicleType] ?? 3;
  const n = Number(passengerCount);
  const b = Number(bags);
  return {
    passengerCount: Math.min(Number.isFinite(n) ? Math.max(Math.floor(n), 1) : maxPassengers, maxPassengers),
    bags: Math.min(Number.isFinite(b) ? Math.max(Math.floor(b), 0) : 0, maxBags),
  };
};

// Straight-line distance in metres — good enough to decide "are these the same
// place", which only needs a threshold, not route accuracy.
const haversineM = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

// Two stops under this are the same kerbside. Booking it produces a zero-length
// route and a fare of nothing but the base fee, which reaches dispatch as a
// real reservation they cannot service.
const MIN_TRIP_M = 100;

const assertDistinctStops = (pickup, dropoff) => {
  const metres = haversineM(pickup, dropoff);
  if (metres < MIN_TRIP_M) {
    const err = new Error('Pickup and drop-off must be different locations');
    // The error handler reads `statusCode`; setting `status` meant an identical
    // pickup/dropoff returned 500 instead of 400.
    err.statusCode = 400;
    throw err;
  }
};

export const createRide = async (passengerId, input) => {
  // Dereferenced input.pickup.lat with no presence check, so a body without
  // pickup threw a raw TypeError and surfaced as a 500.
  if (!input?.pickup || !input?.dropoff) {
    throw Object.assign(new Error('Pickup and drop-off are required'), { statusCode: 400 });
  }
  const pickup = input.pickup.lat ? input.pickup : await geocode(input.pickup);
  const dropoff = input.dropoff.lat ? input.dropoff : await geocode(input.dropoff);

  assertDistinctStops(pickup, dropoff);

  const vehicleType = input.vehicleType || 'economy-sedan';
  const { passengerCount, bags } = clampToVehicleCapacity(
    vehicleType,
    input.passengerCount,
    input.bags,
  );

  const route = await getRoute(pickup, dropoff);
  const settings = await getSettings();
  const estimated = estimateFare(route.distanceKm, route.durationMin, vehicleType, settings);

  const ride = await Ride.create({
    passenger: passengerId,
    pickup,
    dropoff,
    vehicleType,
    serviceType: input.serviceType || '',
    passengerCount,
    bags,
    fare: {
      estimated,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
    },
    route: route.polyline,
  });

  const populated = await Ride.findById(ride._id).populate('passenger', 'name phone avatar');
  return populated;
};

// Progressive radius expansion so a passenger near Ellicott City still finds
// drivers within the service area.
const NEARBY_RADII = [25000, 50000];
const NEARBY_MAX_DRIVERS = 50;

// Hottest endpoint in the product: POST /api/rides calls it, and every
// visitor on /reservations polls it every 8 seconds.
//
// It previously ran up to SIX sequential geospatial round trips — the "exact
// vehicle match" query and the "fallback" query were identical whenever a
// vehicleType was supplied (which is always, from both callers), so the same
// work ran twice per radius. Neither query had a .limit(), so an empty 50km
// search scanned every Location document and populated every driver before
// returning nothing.
export const findNearbyDrivers = async ({ lat, lng, radius = RADIUS_M, vehicleType }) => {
  // Guard against NaN/Infinity from map clicks or geocoding edge
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  // Defence in depth: never let a non-finite or negative $maxDistance reach
  // Mongo, and cap the expansion so this endpoint cannot enumerate the fleet.
  const safeR = (r) => {
    const n = Number(r);
    if (!Number.isFinite(n) || n <= 0) return RADIUS_M;
    return Math.min(n, 50000);
  };

  const driverMatch = {
    role: 'driver',
    isApproved: true,
    'driverDetails.isAvailable': true,
    ...(vehicleType ? { 'driverDetails.vehicleType': vehicleType } : {}),
  };

  const haversineKm = (coordinates) => {
    const R = 6371;
    const dLat = (coordinates[1] - lat) * (Math.PI / 180);
    const dLon = (coordinates[0] - lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) *
        Math.cos((coordinates[1] * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  };

  const shape = (l) => ({
    _id: l.driver._id,
    name: l.driver.name,
    phone: l.driver.phone,
    avatar: l.driver.avatar,
    vehicleType: l.driver.driverDetails?.vehicleType,
    plateNumber: l.driver.driverDetails?.plateNumber,
    lat: l.coordinates.coordinates[1],
    lng: l.coordinates.coordinates[0],
    heading: l.heading ?? 0,
    speed: l.speed ?? 0,
    distanceKm: Math.round(haversineKm(l.coordinates.coordinates) * 10) / 10,
  });

  // Tightest radius first, then widen. Sequential is deliberate: the wider
  // queries only run when the narrow one comes back empty.
  for (const r of [radius, ...NEARBY_RADII]) {
    const found = await Location.find({
      coordinates: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: safeR(r),
        },
      },
    })
      .limit(NEARBY_MAX_DRIVERS)
      .populate({ path: 'driver', match: driverMatch });

    const matched = found.filter((l) => l.driver);
    if (matched.length > 0) return matched.map(shape);
  }

  // If still none, return empty — caller should show service-area warning (MD/DC/VA)
  return [];
};

export const acceptRide = async (rideId, driverId) => {
  // Both guards below used to be read-then-write, so two drivers hitting the
  // same pending ride both saw "available" and both saved — last write won,
  // but both were already sent ride:driverFound and both got a notification,
  // so two cars set off for one passenger. A driver could likewise accept a
  // second ride while the first was still active.
  // findOneAndUpdate with a state predicate makes each claim a single atomic
  // database operation: whoever flips pending -> accepted first owns the ride.
  const claimed = await Ride.findOneAndUpdate(
    { _id: rideId, status: 'pending', driver: null },
    { $set: { driver: driverId, status: 'accepted', 'timestamps.accepted': new Date() } },
    { new: true },
  );
  if (!claimed) {
    const current = await Ride.findById(rideId).select('driver status');
    if (!current) throw Object.assign(new Error('Ride not found'), { statusCode: 404 });
    // Re-accepting your own ride is idempotent rather than an error.
    if (String(current.driver) === String(driverId) && current.status === 'accepted') {
      return Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
    }
    throw Object.assign(new Error('Ride is no longer available'), { statusCode: 409 });
  }

  // Advisory check: it cannot be a hard invariant without a partial unique
  // index on Ride, so the claim above stays the authoritative gate.
  const busy = await Ride.findOne({
    driver: driverId,
    status: { $in: ['accepted', 'arriving', 'in_progress'] },
    _id: { $ne: rideId },
  }).select('_id');
  if (busy) {
    // Roll the claim back so a busy driver does not hold a ride they cannot service.
    await Ride.findOneAndUpdate(
      { _id: rideId, driver: driverId, status: 'accepted' },
      { $set: { driver: null, status: 'pending' }, $unset: { 'timestamps.accepted': '' } },
    );
    throw Object.assign(new Error('You already have an active ride'), { statusCode: 409 });
  }

  return Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
};

// Dispatch (admin) assigns or removes a driver on a ride. `driverId: null`
// returns the ride to the pending board. Returns the populated ride plus the
// id of the driver who was unassigned (if any).
export const assignDriver = async (rideId, driverId) => {
  const ride = await Ride.findOne({ _id: rideId, status: { $nin: ['completed', 'cancelled'] } });
  if (!ride) throw Object.assign(new Error('Ride not found or no longer assignable'), { statusCode: 404 });

  const removedDriverId = ride.driver ? String(ride.driver) : null;

  if (driverId) {
    if (removedDriverId === String(driverId)) {
      const populated = await Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
      return { ride: populated, removedDriverId: null };
    }
    const driver = await User.findOne({ _id: driverId, role: 'driver' });
    if (!driver) throw Object.assign(new Error('Driver not found'), { statusCode: 400 });
    if (driver.isSuspended) throw Object.assign(new Error('Driver is suspended'), { statusCode: 400 });

    const busy = await Ride.findOne({
      driver: driverId,
      status: { $in: ['accepted', 'arriving', 'in_progress'] },
      _id: { $ne: rideId },
    }).select('_id');
    if (busy) throw Object.assign(new Error('Driver already has an active ride'), { statusCode: 409 });

    ride.driver = driverId;
    ride.status = 'accepted';
    ride.timestamps.accepted = new Date();
  } else {
    ride.driver = null;
    ride.status = 'pending';
    ride.timestamps.accepted = undefined;
  }

  await ride.save();
  const populated = await Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
  return { ride: populated, removedDriverId };
};

export const findAdmins = () =>
  User.find({ role: 'admin', isSuspended: false }).select('_id').lean();

export const updateStatus = async (rideId, status, driverId) => {
  const allowed = ['arriving', 'in_progress', 'completed'];
  if (!allowed.includes(status)) {
    throw Object.assign(new Error('Invalid status transition'), { statusCode: 400 });
  }

  const ride = await Ride.findOne({ _id: rideId, driver: driverId, status: { $ne: 'completed' } });
  if (!ride) throw Object.assign(new Error('Ride not found or not assigned to you'), { statusCode: 404 });

  // Map driver-facing status to schema timestamp key (arriving -> arrived)
  const tsKey = status === 'arriving' ? 'arrived' : status === 'in_progress' ? 'started' : status;
  ride.status = status;
  ride.timestamps[tsKey] = new Date();
  if (status === 'completed') {
    ride.timestamps.completed = new Date();
    // Final fare: use the estimate at completion (no metering in sandbox).
    ride.fare.final = ride.fare.estimated;
  }

  await ride.save();
  return Ride.findById(rideId).populate('passenger driver', 'name phone avatar');
};

// Edit a ride while it's still pending (passenger only). Re-geocodes changed
// locations and recomputes route + fare. If a driver already accepted, editing
// is blocked (they'd be expecting the original job).
export const editRide = async (rideId, passengerId, input) => {
  const ride = await Ride.findOne({ _id: rideId, passenger: passengerId, status: 'pending' });
  if (!ride) {
    throw Object.assign(new Error('Ride can only be edited while pending'), { statusCode: 409 });
  }

  let pickup = ride.pickup;
  let dropoff = ride.dropoff;

  if (input.pickup !== undefined) {
    pickup = input.pickup.lat ? input.pickup : await geocode(input.pickup);
  }
  if (input.dropoff !== undefined) {
    dropoff = input.dropoff.lat ? input.dropoff : await geocode(input.dropoff);
  }

  // Re-check on edit: moving one stop onto the other is just as unserviceable
  // as creating it that way.
  assertDistinctStops(pickup, dropoff);

  const changedRoute =
    pickup.lat !== ride.pickup.lat ||
    pickup.lng !== ride.pickup.lng ||
    dropoff.lat !== ride.dropoff.lat ||
    dropoff.lng !== ride.dropoff.lng;

  let route = ride.route;
  let distanceKm = ride.fare.distanceKm;
  let durationMin = ride.fare.durationMin;

  if (changedRoute) {
    const fresh = await getRoute(pickup, dropoff);
    route = fresh.polyline;
    distanceKm = fresh.distanceKm;
    durationMin = fresh.durationMin;
  }

  const settings = await getSettings();
  const vehicleType = input.vehicleType || ride.vehicleType;
  const estimated = estimateFare(distanceKm, durationMin, vehicleType, settings);

  ride.pickup = pickup;
  ride.dropoff = dropoff;
  ride.vehicleType = vehicleType;
  ride.serviceType = input.serviceType ?? ride.serviceType;
  // Re-clamp even when the client sends no counts: switching to a smaller class
  // can leave an existing party over capacity.
  const clamped = clampToVehicleCapacity(
    vehicleType,
    input.passengerCount ?? ride.passengerCount,
    input.bags ?? ride.bags,
  );
  ride.passengerCount = clamped.passengerCount;
  ride.bags = clamped.bags;
  ride.route = route;
  // preserve currency/final when recomputing fare
  ride.fare.estimated = estimated;
  ride.fare.distanceKm = distanceKm;
  ride.fare.durationMin = durationMin;

  await ride.save();
  return Ride.findById(rideId).populate('passenger', 'name phone avatar');
};

export const cancelRide = async (rideId, userId, reason = '') => {
  const ride = await Ride.findOne({
    _id: rideId,
    status: { $nin: ['completed', 'cancelled'] },
    $or: [{ passenger: userId }, { driver: userId }],
  });
  if (!ride) throw Object.assign(new Error('Ride not found or cannot be cancelled'), { statusCode: 404 });

  ride.status = 'cancelled';
  ride.cancelReason = reason;
  ride.timestamps.cancelled = new Date();
  await ride.save();
  return ride;
};

export const rateRide = async (rideId, userId, { score, comment, compliments }) => {
  // The default only applied when the key was absent. A string body made
  // compliments.filter(...) throw TypeError -> 500.
  const complimentList = Array.isArray(compliments) ? compliments : [];
  const ride = await Ride.findOne({ _id: rideId, status: 'completed', passenger: userId });
  if (!ride) throw Object.assign(new Error('Completed ride not found'), { statusCode: 404 });
  if (ride.rating?.score) throw Object.assign(new Error('Already rated'), { statusCode: 409 });
  if (!score || score < 1 || score > 5) throw Object.assign(new Error('Score 1-5 required'), { statusCode: 400 });

  ride.rating = { score, comment: (comment||'').slice(0,500), compliments: complimentList.filter(c=>['clean','professional','friendly','safe'].includes(c)), createdAt: new Date() };
  await ride.save();

  // Update driver's aggregate — Uber-like: avg = (oldAvg*count + score)/(count+1)
  if (ride.driver) {
    const driver = await User.findById(ride.driver);
    if (driver) {
      const s = driver.driverDetails.stats || { rating:0, ratingCount:0, compliments:{clean:0,professional:0,friendly:0,safe:0} };
      const newCount = (s.ratingCount||0)+1;
      const newAvg = ((s.rating||0)*(s.ratingCount||0) + score)/newCount;
      await User.findByIdAndUpdate(ride.driver, {
        $set: {
          'driverDetails.stats.rating': Math.round(newAvg*10)/10,
          'driverDetails.stats.ratingCount': newCount,
        },
        $inc: {
          ...(complimentList.includes('clean') ? {'driverDetails.stats.compliments.clean':1} : {}),
          ...(complimentList.includes('professional') ? {'driverDetails.stats.compliments.professional':1} : {}),
          ...(complimentList.includes('friendly') ? {'driverDetails.stats.compliments.friendly':1} : {}),
          ...(complimentList.includes('safe') ? {'driverDetails.stats.compliments.safe':1} : {}),
          'driverDetails.stats.totalRides': 0, // keep count separate via Ride aggregate, not here
        }
      });
    }
  }
  return ride;
};

export const getRideById = async (id, requester = null) => {
  const ride = await Ride.findById(id).populate('passenger driver', 'name phone avatar');
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 });
  if (requester) {
    const privileged = ['admin', 'super_admin', 'dispatcher', 'manager', 'finance', 'support'].includes(requester.role);
    if (!privileged) {
      const isPassenger = String(ride.passenger?._id || ride.passenger) === String(requester._id);
      const isDriver = ride.driver && String(ride.driver?._id || ride.driver) === String(requester._id);
      if (!isPassenger && !isDriver) throw Object.assign(new Error('Not authorized to view this ride'), { statusCode: 403 });
    }
  }
  return ride;
};

// Roles allowed to see every ride. Kept explicit because the scoping below
// defaults to deny: a new role added to the enum must be added here
// deliberately rather than inheriting the full ride table by omission.
const FULL_RIDE_VISIBILITY = ['admin', 'super_admin', 'dispatcher', 'manager'];

export const listRides = async (user, filters = {}) => {
  // This was an if-chain with no else, so any role that was not
  // passenger/driver/admin left `query` as {} and returned the entire ride
  // table — every passenger's pickup, drop-off, phone and assigned driver — to
  // support, finance, dispatcher and manager. Fail closed instead.
  let query;
  if (FULL_RIDE_VISIBILITY.includes(user.role)) {
    query = {};
    if (filters.status) query.status = filters.status;
  } else if (user.role === 'driver') {
    query = { driver: user._id };
  } else {
    query = { passenger: user._id };
    if (filters.status) query.status = filters.status;
  }

  const rides = await Ride.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('passenger driver', 'name phone avatar');
  return rides;
};

export const listDrivers = async () => {
  return User.find({ role: 'driver' }).select('-password');
};

export const listAvailableRides = async (driverId) => {
  const driver = await User.findById(driverId).select('role driverDetails');
  if (!driver || driver.role !== 'driver') return [];
  // Only show pending rides that match this driver's registered vehicle.
  const query = { status: 'pending' };
  if (driver.driverDetails?.vehicleType) {
    query.vehicleType = driver.driverDetails.vehicleType;
  }
  return Ride.find(query).sort({ createdAt: -1 }).limit(20).populate('passenger', 'name phone avatar');
};