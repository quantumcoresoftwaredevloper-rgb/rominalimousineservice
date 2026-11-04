import Ride from '../models/Ride.js';
import Location from '../models/Location.js';
import User from '../models/User.js';
import { getSettings } from './settingsService.js';
import {
  assertBookableVehicleType,
  clampToVehicleCapacity,
  estimateFare,
  parseScheduledAt,
  SCHEDULED_PROMOTION_WINDOW_MS,
  DEFAULT_VEHICLE_TYPE,
  assertServiceType,
  sanitizeNotes,
  sanitizeFlightField,
} from './pricing.js';

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

// Resolve a pickup/dropoff input into a coordinate. Accepts either a complete
// {address,lat,lng} object from the map/autocomplete or a free-text address,
// and rejects malformed coordinates before they reach Mongo.
const resolvePoint = async (value, label) => {
  if (!value) throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
  if (value.lat != null || value.lng != null) {
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw Object.assign(new Error(`Invalid ${label.toLowerCase()} coordinates`), { statusCode: 400 });
    }
    const address = String(value.address || '').trim();
    if (!address) {
      throw Object.assign(new Error(`${label} address is required`), { statusCode: 400 });
    }
    return { address, lat, lng };
  }
  const address = String(value.address || value).trim();
  if (!address) throw Object.assign(new Error(`${label} is required`), { statusCode: 400 });
  return geocode(address);
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
  if (!input?.pickup || !input?.dropoff) {
    throw Object.assign(new Error('Pickup and drop-off are required'), { statusCode: 400 });
  }

  const vehicleType = assertBookableVehicleType(input.vehicleType || DEFAULT_VEHICLE_TYPE);
  const serviceType = assertServiceType(input.serviceType || '');

  // A request with `when: 'later'` but no time must never silently become an
  // immediate ride, and a supplied time must be valid and far enough ahead.
  if (input.when === 'later' && !input.scheduledAt) {
    throw Object.assign(new Error('Please choose a pickup date and time'), { statusCode: 400 });
  }
  const requestedTime = input.scheduledAt ?? null;
  const { scheduledAt, immediate } = parseScheduledAt(requestedTime);

  const pickup = await resolvePoint(input.pickup, 'Pickup');
  const dropoff = await resolvePoint(input.dropoff, 'Drop-off');
  assertDistinctStops(pickup, dropoff);

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
    serviceType,
    passengerCount,
    bags,
    notes: sanitizeNotes(input.notes ?? input.extra),
    flightNumber: sanitizeFlightField(input.flightNumber, 20),
    airline: sanitizeFlightField(input.airline, 60),
    airport: sanitizeFlightField(input.airport, 10),
    status: immediate ? 'pending' : 'scheduled',
    scheduledAt: scheduledAt || undefined,
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
    // Phone is intentionally omitted: this endpoint is available to any
    // authenticated passenger and must not double as a driver contact list.
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
  const driver = await User.findOne({ _id: driverId, role: 'driver' }).select(
    'isApproved isSuspended driverDetails.vehicleType',
  );
  if (!driver) throw Object.assign(new Error('Driver not found'), { statusCode: 403 });
  if (!driver.isApproved || driver.isSuspended) {
    throw Object.assign(new Error('Driver account is not approved'), { statusCode: 403 });
  }
  const driverVehicle = driver.driverDetails?.vehicleType;
  if (!driverVehicle) {
    throw Object.assign(new Error('Register a vehicle before accepting rides'), { statusCode: 400 });
  }

  // Both guards below used to be read-then-write, so two drivers hitting the
  // same pending ride both saw "available" and both saved — last write won,
  // but both were already sent ride:driverFound and both got a notification,
  // so two cars set off for one passenger. A driver could likewise accept a
  // second ride while the first was still active.
  // findOneAndUpdate with a state predicate makes each claim a single atomic
  // database operation: whoever flips pending -> accepted first owns the ride.
  // The vehicle predicate also closes the API path around the filtered feed:
  // an approved Chevrolet driver can never claim an SUV request.
  let claimed;
  try {
    claimed = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        status: 'pending',
        driver: null,
        vehicleType: driverVehicle,
      },
      { $set: { driver: driverId, status: 'accepted', 'timestamps.accepted': new Date() } },
      { new: true },
    );
  } catch (err) {
    if (err?.code === 11000) {
      throw Object.assign(new Error('You already have an active ride'), { statusCode: 409 });
    }
    throw err;
  }
  if (!claimed) {
    const current = await Ride.findById(rideId).select('driver status vehicleType');
    if (!current) throw Object.assign(new Error('Ride not found'), { statusCode: 404 });
    if (
      current.status === 'pending' &&
      !current.driver &&
      current.vehicleType !== driverVehicle
    ) {
      throw Object.assign(
        new Error(`This request requires a ${current.vehicleType}; your vehicle is ${driverVehicle}`),
        { statusCode: 409 },
      );
    }
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
  const ride = await Ride.findOne({
    _id: rideId,
    status: { $in: ['pending', 'scheduled'] },
  });
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
    if (!driver.isApproved) throw Object.assign(new Error('Driver is not approved yet'), { statusCode: 400 });
    if (driver.driverDetails?.vehicleType !== ride.vehicleType) {
      throw Object.assign(
        new Error(`Driver vehicle does not match the requested ${ride.vehicleType} class`),
        { statusCode: 400 },
      );
    }

    const busy = await Ride.findOne({
      driver: driverId,
      status: { $in: ['accepted', 'arriving', 'in_progress'] },
      _id: { $ne: rideId },
    }).select('_id');
    if (busy) throw Object.assign(new Error('Driver already has an active ride'), { statusCode: 409 });

    // Scheduled rides keep the `scheduled` state until their pickup window;
    // assigning now records the driver without starting the trip.
    const nextStatus = ride.status === 'scheduled' ? 'scheduled' : 'accepted';
    const update = { driver: driverId, status: nextStatus };
    if (nextStatus === 'accepted') update['timestamps.accepted'] = new Date();

    let updated;
    try {
      // Optimistic predicate on the state we just read: two dispatchers
      // assigning simultaneously cannot both succeed.
      updated = await Ride.findOneAndUpdate(
        { _id: rideId, status: ride.status, driver: ride.driver ?? null },
        { $set: update },
        { new: true },
      );
    } catch (err) {
      if (err?.code === 11000) {
        throw Object.assign(new Error('Driver already has an active ride'), { statusCode: 409 });
      }
      throw err;
    }
    if (!updated) {
      throw Object.assign(new Error('Ride was updated by another dispatcher. Refresh and try again.'), { statusCode: 409 });
    }
  } else {
    const nextStatus = ride.status === 'scheduled' ? 'scheduled' : 'pending';
    const update = { driver: null, status: nextStatus };
    const unset = nextStatus === 'pending' ? { 'timestamps.accepted': '' } : undefined;
    const updated = await Ride.findOneAndUpdate(
      { _id: rideId, driver: ride.driver, status: ride.status },
      { $set: update, ...(unset ? { $unset: unset } : {}) },
      { new: true },
    );
    if (!updated) {
      throw Object.assign(new Error('Ride was updated by another dispatcher. Refresh and try again.'), { statusCode: 409 });
    }
  }

  const populated = await Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
  return { ride: populated, removedDriverId };
};

// Promote scheduled reservations into live dispatch as their pickup window
// approaches. Returns the rides that changed so the caller can emit events.
export const promoteDueScheduledRides = async (now = new Date()) => {
  const due = await Ride.find({
    status: 'scheduled',
    scheduledAt: { $lte: new Date(now.getTime() + SCHEDULED_PROMOTION_WINDOW_MS) },
  }).select('_id driver');

  const promoted = [];
  for (const candidate of due) {
    const nextStatus = candidate.driver ? 'accepted' : 'pending';
    const update = { status: nextStatus };
    if (nextStatus === 'accepted') update['timestamps.accepted'] = new Date();
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: candidate._id, status: 'scheduled' },
        { $set: update },
        { new: true },
      ).populate('passenger driver', 'name phone avatar driverDetails');
      if (ride) promoted.push(ride);
    } catch (err) {
      // Driver may still be on another active trip; leave the reservation
      // scheduled and retry on the next sweep.
      if (err?.code !== 11000) throw err;
    }
  }
  return promoted;
};

export const findAdmins = () =>
  User.find({ role: 'admin', isSuspended: false }).select('_id').lean();

export const updateStatus = async (rideId, status, driverId) => {
  const previous = { arriving: 'accepted', in_progress: 'arriving', completed: 'in_progress' };
  if (!previous[status]) {
    throw Object.assign(new Error('Invalid status transition'), { statusCode: 400 });
  }

  const tsKey = status === 'arriving' ? 'arrived' : status === 'in_progress' ? 'started' : 'completed';
  const set = { status, [`timestamps.${tsKey}`]: new Date() };

  // Completion freezes the final fare once, atomically. Computing it from a
  // stale read then saving would allow two concurrent requests to overwrite a
  // fare edited by an admin in between.
  const ride = await Ride.findOne({ _id: rideId, driver: driverId }).select('fare');
  if (!ride) throw Object.assign(new Error('Ride not found or not assigned to you'), { statusCode: 404 });
  if (status === 'completed') set['fare.final'] = ride.fare.estimated;

  const updated = await Ride.findOneAndUpdate(
    { _id: rideId, driver: driverId, status: previous[status] },
    { $set: set },
    { new: true },
  );
  if (!updated) {
    const current = await Ride.findById(rideId).select('status driver');
    if (!current) throw Object.assign(new Error('Ride not found'), { statusCode: 404 });
    if (String(current.driver) !== String(driverId)) {
      throw Object.assign(new Error('Ride not found or not assigned to you'), { statusCode: 404 });
    }
    throw Object.assign(new Error(`Cannot move ride from ${current.status} to ${status}`), { statusCode: 409 });
  }

  return Ride.findById(rideId).populate('passenger driver', 'name phone avatar');
};

// Edit a ride while it's still pending (passenger only). Re-geocodes changed
// locations and recomputes route + fare. If a driver already accepted, editing
// is blocked (they'd be expecting the original job).
export const editRide = async (rideId, passengerId, input) => {
  const ride = await Ride.findOne({
    _id: rideId,
    passenger: passengerId,
    status: { $in: ['pending', 'scheduled'] },
  });
  if (!ride) {
    throw Object.assign(new Error('Ride can only be edited before a driver accepts'), { statusCode: 409 });
  }

  let pickup = ride.pickup;
  let dropoff = ride.dropoff;

  if (input.pickup !== undefined) pickup = await resolvePoint(input.pickup, 'Pickup');
  if (input.dropoff !== undefined) dropoff = await resolvePoint(input.dropoff, 'Drop-off');

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
  const vehicleType = input.vehicleType
    ? assertBookableVehicleType(input.vehicleType)
    : ride.vehicleType;
  const estimated = estimateFare(distanceKm, durationMin, vehicleType, settings);

  ride.pickup = pickup;
  ride.dropoff = dropoff;
  ride.vehicleType = vehicleType;
  ride.serviceType = input.serviceType !== undefined
    ? assertServiceType(input.serviceType)
    : ride.serviceType;
  ride.notes = input.notes !== undefined || input.extra !== undefined
    ? sanitizeNotes(input.notes ?? input.extra)
    : ride.notes;
  if (input.flightNumber !== undefined) ride.flightNumber = sanitizeFlightField(input.flightNumber, 20);
  if (input.airline !== undefined) ride.airline = sanitizeFlightField(input.airline, 60);
  if (input.airport !== undefined) ride.airport = sanitizeFlightField(input.airport, 10);

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

  if (input.scheduledAt !== undefined) {
    const { scheduledAt, immediate } = parseScheduledAt(input.scheduledAt);
    ride.scheduledAt = scheduledAt || undefined;
    ride.status = immediate ? 'pending' : 'scheduled';
  }

  await ride.save();
  return Ride.findById(rideId).populate('passenger', 'name phone avatar');
};

export const cancelRide = async (rideId, userId, reason = '') => {
  // Single conditional write: a read-then-save here could overwrite a status
  // the driver advanced (e.g. completed) between the two operations.
  const ride = await Ride.findOneAndUpdate(
    {
      _id: rideId,
      status: { $nin: ['completed', 'cancelled'] },
      $or: [{ passenger: userId }, { driver: userId }],
    },
    {
      $set: {
        status: 'cancelled',
        cancelReason: reason,
        'timestamps.cancelled': new Date(),
      },
    },
    { new: true },
  );
  if (!ride) throw Object.assign(new Error('Ride not found or cannot be cancelled'), { statusCode: 404 });
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
const FULL_RIDE_VISIBILITY = ['admin', 'super_admin', 'dispatcher', 'manager', 'finance', 'support'];

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