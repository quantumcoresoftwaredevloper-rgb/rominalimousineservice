import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardProcessor,
  assertCardProcessor,
  isCashSettledStatus,
} from '../src/utils/paymentPolicy.js';

test('production refuses to simulate card payments without Stripe', () => {
  assert.equal(cardProcessor({ NODE_ENV: 'production' }, false), null);
  assert.throws(
    () => assertCardProcessor({ NODE_ENV: 'production' }, false),
    (err) => err.statusCode === 503,
  );
});

test('development and test may use the sandbox simulator', () => {
  assert.equal(cardProcessor({ NODE_ENV: 'development' }, false), 'sandbox');
  assert.equal(cardProcessor({ NODE_ENV: 'test' }, false), 'sandbox');
});

test('a configured Stripe gateway always takes precedence', () => {
  assert.equal(cardProcessor({ NODE_ENV: 'production' }, true), 'stripe');
  assert.equal(cardProcessor({ NODE_ENV: 'development' }, true), 'stripe');
});

test('cash due is not treated as collected', () => {
  assert.equal(isCashSettledStatus('cash_due'), true);
  assert.equal(isCashSettledStatus('cash_collected'), true);
  assert.equal(isCashSettledStatus('succeeded'), false);
});
