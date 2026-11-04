// Authoritative pricing, capacity and scheduling rules.
//
// Kept free of database/network imports so the same functions can be unit
// tested and reused by every quote surface. The server is the only authority:
// values sent by the client are validated or clamped here before persistence.

export const BOOKABLE_VEHICLE_TYPES = ['SUV', 'Chevrolet'];
export const DEFAULT_VEHICLE_TYPE = 'SUV';

export const SERVICE_TYPES = [
  'airport',
  'corporate',
  'wedding',
  'prom',
  'shuttle',
  'charter',
  'night-out',
  'funeral',
  'school',
  'valet',
];

export const assertServiceType = (serviceType) => {
  if (!serviceType) return '';
  if (!SERVICE_TYPES.includes(serviceType)) throw badRequest('Please select a valid service type');
  return serviceType;
};

export const sanitizeNotes = (notes) =>
  typeof notes === 'string' ? notes.trim().slice(0, 500) : '';

export const sanitizeFlightField = (value, max) =>
  typeof value === 'string' ? value.trim().toUpperCase().slice(0, max) : '';

const RATES = {
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

export const DEFAULT_CAPACITY = 4;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

export const isBookableVehicleType = (vehicleType) =>
  BOOKABLE_VEHICLE_TYPES.includes(vehicleType);

export const assertBookableVehicleType = (vehicleType) => {
  if (!isBookableVehicleType(vehicleType)) {
    throw badRequest('Please select a valid vehicle class');
  }
  return vehicleType;
};

/** Estimate a fare from server-calculated distance/duration. */
export const estimateFare = (distanceKm, durationMin, vehicleType, overrides = {}) => {
  const rate = RATES[vehicleType] || RATES[DEFAULT_VEHICLE_TYPE];
  const base = overrides.baseFare ?? rate.base;
  const perKm = overrides.perKm ?? rate.perKm;
  const perMin = overrides.perMin ?? rate.perMin;
  const total = base + (Number(distanceKm) || 0) * perKm + (Number(durationMin) || 0) * perMin;
  return Math.round(total * 100) / 100;
};

export const vehicleCapacity = (vehicleType) =>
  VEHICLE_CAPACITY[vehicleType] ?? DEFAULT_CAPACITY;

export const vehicleBagCapacity = (vehicleType) =>
  VEHICLE_BAG_CAPACITY[vehicleType] ?? 3;

/**
 * Clamp a party size to what the selected vehicle can legally carry.
 * Non-numeric input resolves to the maximum, a negative number to the minimum.
 */
export const clampToVehicleCapacity = (vehicleType, passengerCount, bags) => {
  const maxPassengers = vehicleCapacity(vehicleType);
  const maxBags = vehicleBagCapacity(vehicleType);
  const n = Number(passengerCount);
  const b = Number(bags);
  return {
    passengerCount: Math.min(
      Number.isFinite(n) ? Math.max(Math.floor(n), 1) : maxPassengers,
      maxPassengers,
    ),
    bags: Math.min(Number.isFinite(b) ? Math.max(Math.floor(b), 0) : 0, maxBags),
  };
};

// Scheduling policy. Immediate bookings use `scheduledAt: null`; a reservation
// must be far enough ahead to dispatch realistically and no further than the
// booking horizon we actually support.
export const MIN_SCHEDULE_LEAD_MS = 30 * 60 * 1000;
export const MAX_SCHEDULE_HORIZON_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Normalise a requested pickup time.
 * @returns {{scheduledAt: Date|null, immediate: boolean}}
 */
export const parseScheduledAt = (value, now = new Date()) => {
  if (value == null || value === '' || value === 'now') {
    return { scheduledAt: null, immediate: true };
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('Invalid pickup date/time');
  const delta = date.getTime() - now.getTime();
  if (delta < MIN_SCHEDULE_LEAD_MS) {
    throw badRequest('Scheduled pickups must be at least 30 minutes from now');
  }
  if (delta > MAX_SCHEDULE_HORIZON_MS) {
    throw badRequest('Reservations can be booked up to 180 days ahead');
  }
  return { scheduledAt: date, immediate: false };
};

/** True when a reservation is due for promotion onto the live dispatch board. */
export const isScheduleDue = (scheduledAt, now = new Date(), leadMs = MIN_SCHEDULE_LEAD_MS) =>
  scheduledAt instanceof Date && scheduledAt.getTime() <= now.getTime() + leadMs;

export const SCHEDULED_PROMOTION_WINDOW_MS = MIN_SCHEDULE_LEAD_MS;
