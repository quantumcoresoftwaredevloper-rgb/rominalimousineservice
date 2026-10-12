import { Car, CarFront, Bus } from 'lucide-react';

// Marketing catalogue. These are the vehicles advertised on the public site.
// Ids are stored on Ride/User and are stable.
export const VEHICLES = [
  { id: 'executive-sedan', label: 'Executive Sedan', desc: 'Up to 4 riders', icon: Car },
  { id: 'economy-sedan', label: 'Luxury Sedan', desc: 'Up to 4 riders', icon: Car },
  { id: 'economy-suv', label: 'Premium SUV', desc: 'Up to 6 riders', icon: CarFront },
  { id: 'premium-suv', label: 'Executive SUV', desc: 'Up to 6 riders', icon: CarFront },
  { id: 'luxury-suv', label: 'Cadillac Escalade ESV', desc: 'Up to 7 riders', icon: CarFront },
  { id: 'van', label: 'Executive Sprinter Van', desc: 'Up to 14 riders', icon: Bus },
  { id: 'mini-coach', label: 'Mini-Coach', desc: 'Up to 32 riders', icon: Bus },
  { id: 'school-bus', label: 'School Bus', desc: 'Up to 48 riders', icon: Bus },
  { id: 'motorcoach', label: 'Motorcoach', desc: 'Up to 56 riders', icon: Bus },
];

// The only two vehicles a passenger can book. Drivers register against one of
// these, and ride requests are routed to matching drivers only — see
// DRIVER_VEHICLE_TYPES below.
//
// Declared above vehicleLabel on purpose: a function body referencing a later
// binding is fine, but keeping the order means there is no ordering hazard to
// reason about if this file is ever evaluated differently.
export const BOOKING_VEHICLES = [
  { id: 'SUV', label: 'SUV', desc: 'Premium sport-utility vehicle' },
  { id: 'Chevrolet', label: 'Chevrolet', desc: 'Chevrolet SUV' },
];

// The only vehicle classes a driver may be registered against. Kept in step
// with BOOKING_VEHICLES above and with VEHICLE_TYPES in
// server/src/services/adminUserService.js. A ride can only ever request one of
// these, and matching compares vehicleType exactly, so a driver registered
// against any other class is never reachable by dispatch.
export const DRIVER_VEHICLE_TYPES = BOOKING_VEHICLES;

// Resolves a vehicle id to a human label. Driver vehicles resolve through
// BOOKING_VEHICLES so an admin and a driver see the same word for the same
// vehicle — "SUV" rather than the catalogue's "Premium SUV".
export const vehicleLabel = (id) =>
  VEHICLES.find((v) => v.id === id)?.label ||
  BOOKING_VEHICLES.find((v) => v.id === id)?.label ||
  (id || '').replace(/-/g, ' ');