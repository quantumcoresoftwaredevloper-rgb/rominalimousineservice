import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, hasRole, normalizeRole } from '../src/utils/roles.js';

test('admin and super_admin hold every permission', () => {
  for (const role of ['admin', 'super_admin']) {
    assert.equal(hasPermission(role, 'anything.at.all'), true);
    assert.equal(normalizeRole(role), 'super_admin');
  }
});

test('finance can read payments and issue refunds, but cannot manage users', () => {
  assert.equal(hasPermission('finance', 'payments.read'), true);
  assert.equal(hasPermission('finance', 'payments.refund'), true);
  assert.equal(hasPermission('finance', 'refunds.decide'), true);
  assert.equal(hasPermission('finance', 'users.write'), false);
  assert.equal(hasPermission('finance', 'rides.dispatch'), false);
  assert.equal(hasPermission('finance', 'settings.write'), false);
});

test('support handles tickets only, not fleet or user administration', () => {
  assert.equal(hasPermission('support', 'tickets.write'), true);
  assert.equal(hasPermission('support', 'rides.read'), true);
  assert.equal(hasPermission('support', 'users.write'), false);
  assert.equal(hasPermission('support', 'fleet.write'), false);
  assert.equal(hasPermission('support', 'payments.read'), false);
});

test('dispatcher can dispatch rides but not edit the fleet', () => {
  assert.equal(hasPermission('dispatcher', 'rides.dispatch'), true);
  assert.equal(hasPermission('dispatcher', 'rides.update'), true);
  assert.equal(hasPermission('dispatcher', 'fleet.write'), false);
  assert.equal(hasPermission('dispatcher', 'users.write'), false);
});

test('manager can operate the fleet and read payments without refunding', () => {
  assert.equal(hasPermission('manager', 'fleet.write'), true);
  assert.equal(hasPermission('manager', 'payments.read'), true);
  assert.equal(hasPermission('manager', 'payments.refund'), false);
  assert.equal(hasPermission('manager', 'content.write'), false);
});

test('legacy admin role is treated as super_admin in explicit role checks', () => {
  assert.equal(hasRole('admin', ['super_admin']), true);
  assert.equal(hasRole('super_admin', ['admin']), true);
  assert.equal(hasRole('support', ['admin']), false);
});
