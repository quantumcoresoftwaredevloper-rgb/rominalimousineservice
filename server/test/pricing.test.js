import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateFare,
  clampToVehicleCapacity,
  parseScheduledAt,
  assertBookableVehicleType,
  assertServiceType,
  sanitizeNotes,
  isScheduleDue,
  MIN_SCHEDULE_LEAD_MS,
  MAX_SCHEDULE_HORIZON_MS,
} from '../src/services/pricing.js';

test('fare uses the authoritative SUV rates', () => {
  assert.equal(estimateFare(10, 20, 'SUV'), 38);
});

test('admin fare overrides replace built-in rates', () => {
  assert.equal(estimateFare(10, 20, 'SUV', { baseFare: 5, perKm: 1, perMin: 0 }), 15);
});

test('only bookable vehicle classes are accepted', () => {
  assert.equal(assertBookableVehicleType('SUV'), 'SUV');
  assert.equal(assertBookableVehicleType('Chevrolet'), 'Chevrolet');
  assert.throws(() => assertBookableVehicleType('economy-sedan'), /valid vehicle/);
});

test('party and bag counts are clamped to the vehicle capacity', () => {
  assert.deepEqual(clampToVehicleCapacity('SUV', 99, 99), { passengerCount: 6, bags: 4 });
  assert.deepEqual(clampToVehicleCapacity('SUV', -3, -2), { passengerCount: 1, bags: 0 });
  assert.deepEqual(clampToVehicleCapacity('SUV', 'not-a-number', 1), { passengerCount: 6, bags: 1 });
});

test('scheduled pickups require 30 minutes to 180 days lead time', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  assert.deepEqual(parseScheduledAt(null, now), { scheduledAt: null, immediate: true });

  const tooSoon = new Date(now.getTime() + MIN_SCHEDULE_LEAD_MS - 1).toISOString();
  assert.throws(() => parseScheduledAt(tooSoon, now), /at least 30 minutes/);

  const tooFar = new Date(now.getTime() + MAX_SCHEDULE_HORIZON_MS + 1).toISOString();
  assert.throws(() => parseScheduledAt(tooFar, now), /180 days/);

  const valid = new Date(now.getTime() + 60 * 60 * 1000);
  const parsed = parseScheduledAt(valid.toISOString(), now);
  assert.equal(parsed.immediate, false);
  assert.equal(parsed.scheduledAt.toISOString(), valid.toISOString());
});

test('a reservation is due inside its promotion window', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  assert.equal(isScheduleDue(new Date('2026-01-01T12:29:00.000Z'), now), true);
  assert.equal(isScheduleDue(new Date('2026-01-01T12:31:00.000Z'), now), false);
});

test('service type must be a known slug and notes are capped', () => {
  assert.equal(assertServiceType('airport'), 'airport');
  assert.equal(assertServiceType(''), '');
  assert.throws(() => assertServiceType('teleport'), /valid service/);
  assert.equal(sanitizeNotes('  hello  '), 'hello');
  assert.equal(sanitizeNotes('x'.repeat(600)).length, 500);
  assert.equal(sanitizeNotes(42), '');
});
