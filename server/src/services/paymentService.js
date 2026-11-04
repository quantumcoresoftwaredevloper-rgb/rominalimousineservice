import crypto from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Stripe from 'stripe';
import Payment from '../models/Payment.js';
import Ride from '../models/Ride.js';
import { getSettings } from './settingsService.js';
import { assertCardProcessor, isProduction } from '../utils/paymentPolicy.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const txId = (prefix) =>
  `${prefix}_${crypto.randomBytes(12).toString('hex')}`;

// Real Stripe gateway (test/live mode) when configured; otherwise the app falls
// back to the sandbox simulator so every flow stays testable without keys.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const stripeEnabled = !!stripe;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
export const isStripeConfigured = () => stripeEnabled;

const cents = (amount) => Math.round(amount * 100);

const assertPayable = async (userId, rideId) => {
  const settings = await getSettings();
  if (settings.paymentsEnabled === false) {
    throw fail('Online payments are disabled by the operator. Pay by cash or contact support.', 403);
  }
  // A ride is payable once the trip is done. It used to accept anything not
  // cancelled, so a passenger could pay the base fare while the ride was still
  // pending, then edit the drop-off to 100 km away — editRide recomputes the
  // fare, completed rides set fare.final to the inflated number, and the settled
  // payment short-circuits any second attempt. The rider paid $12 for a $397
  // trip.
  const ride = await Ride.findOne({
    _id: rideId,
    passenger: userId,
    status: 'completed',
  });
  if (!ride) throw fail('Ride not found, not yours, or not completed yet', 404);
  return ride;
};

// Atomic settle-or-fetch.
//
// settledPayment was read-then-write, so two concurrent requests with different
// idempotency keys both saw "no payment yet" and both inserted — two payment
// rows for one ride. The caller is explicitly told to send a fresh key per
// attempt, so the unique index on idempotencyKey never sees a conflict.
//
// The guard therefore has to key on the ride itself, not on the caller's key:
// claim the ride with a conditional write and let exactly one caller win.
const settledPayment = async (rideId) => {
  const existing = await Payment.findOne({
    ride: rideId,
    status: { $in: ['succeeded', 'cash', 'cash_due', 'cash_collected'] },
  });
  if (existing) return existing;
  return null;
};

/**
 * Atomically records the payment for a ride, or returns the one that already
 * exists. The unique partial index on {ride} for settled statuses is the real
 * guard; this does the insert and swallows only the duplicate-key race.
 */
const recordSettlement = async (rideId, userId, build) => {
  try {
    return await Payment.create(build());
  } catch (err) {
    if (err?.code === 11000) {
      // Lost a concurrent race — the other request's row is the real one.
      return settledPayment(rideId);
    }
    throw err;
  }
};

const rideAmount = (ride) =>
  ride.status === 'completed' ? ride.fare?.final : ride.fare?.estimated;

// POST /api/rides/:rideId/payment-intent
// Returns a Stripe client secret for the Passenger-side Payment Element. The
// intent amount locks the fare; confirmPayment completes it client-side and the
// caller then records the result via processPayment({ method:'card',
// paymentIntentId }). Idempotent per ride.
export const createPaymentIntent = async (userId, rideId) => {
  if (!stripeEnabled) {
    throw fail('Stripe is not configured. Online card payments are unavailable.', 503);
  }
  const ride = await assertPayable(userId, rideId);
  if (await settledPayment(rideId)) {
    throw fail('This ride has already been paid for.', 409);
  }
  const amount = rideAmount(ride);
  if (!amount || amount <= 0) throw fail('Cannot charge a ride with no fare', 400);

  const intent = await stripe.paymentIntents.create(
    {
      amount: cents(amount),
      currency: 'usd',
      // Uses the account's payment-method configuration (Stripe Dashboard
      // "Payment methods" page — the STRIPE_PAYMENT_METHOD_DOMAIN domain id
      // scopes which methods are offered for this account).
      automatic_payment_methods: { enabled: true },
      metadata: { rideId: String(rideId), userId: String(userId) },
    },
    { idempotencyKey: `rideIntent:${rideId}` }
  );

  return { clientSecret: intent.client_secret, amount };
};

// Charge for a ride. Idempotent: a settled payment (succeeded or cash) for the
// ride is returned as-is.
export const processPayment = async (userId, rideId, opts = {}) => {
  const { method = 'card', idempotencyKey, cardLast4, paymentIntentId } = opts;

  // Cash — no online charge. The ride stays cash_due until the assigned
  // driver records collection at trip end; it is never marked paid up front.
  if (method === 'cash') {
    const ride = await Ride.findOne({
      _id: rideId,
      passenger: userId,
      status: 'completed',
    });
    if (!ride) throw fail('Ride not found, not yours, or not completed yet', 404);

    const existing = await settledPayment(rideId);
    if (existing) return existing;

    const amount = rideAmount(ride);
    if (!amount || amount <= 0) throw fail('Cannot record a cash payment with no fare', 400);

    const payment = await recordSettlement(rideId, userId, () => ({
      user: userId,
      ride: rideId,
      amount,
      method: 'cash',
      provider: 'cash',
      status: 'cash_due',
      cashDueAt: new Date(),
      idempotencyKey: idempotencyKey || `ride:${rideId}:cash`,
    }));

    ride.payment = { method: 'cash', status: 'cash_due' };
    await ride.save();
    return payment;
  }

  const processor = assertCardProcessor(process.env, stripeEnabled);
  if (processor === 'stripe') {
    if (!paymentIntentId) {
      throw fail('Card payments go through Stripe. Please try again with a fresh payment.', 400);
    }
    return processStripePayment(userId, rideId, { paymentIntentId, idempotencyKey });
  }

  return processSandboxPayment(userId, rideId, { idempotencyKey, cardLast4 });
}

// Card via Stripe — verify the already-confirmed PaymentIntent, then record it.
const processStripePayment = async (userId, rideId, { paymentIntentId, idempotencyKey }) => {
  const ride = await assertPayable(userId, rideId);

  const existing = await settledPayment(rideId);
  if (existing) return existing;

  const seen = await Payment.findOne({ transactionId: paymentIntentId });
  if (seen) return seen;

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
  if (!intent) throw fail('Payment could not be verified with the provider.', 400);
  if (intent.status !== 'succeeded') {
    throw fail(
      intent.status === 'requires_payment_method'
        ? 'The card was not charged. Please try again.'
        : `Payment not settled (${intent.status}).`,
      400
    );
  }

  const amount = rideAmount(ride);
  if (!amount || amount <= 0) throw fail('Cannot charge a ride with no fare', 400);
  if (intent.amount !== cents(amount)) {
    throw fail('Payment amount does not match the ride fare.', 400);
  }

  let last4 = '';
  try {
    if (intent.payment_method) {
      const pm = await stripe.paymentMethods.retrieve(intent.payment_method);
      last4 = pm?.card?.last4 || '';
    }
  } catch {
    // last4 is cosmetic only — non-fatal if the method is already gone.
  }

  const payment = await recordSettlement(rideId, userId, () => ({
    user: userId,
    ride: rideId,
    amount,
    method: 'card',
    provider: 'stripe',
    status: 'succeeded',
    transactionId: paymentIntentId,
    cardLast4: last4,
    idempotencyKey: idempotencyKey || `pi:${paymentIntentId}`,
  }));

  ride.payment = {
    method: 'card',
    status: 'paid',
    transactionId: paymentIntentId,
  };
  await ride.save();

  return payment;
};

// Sandbox gateway: deterministic behavior driven by the card so flows are
// testable. Any card ending in "0002" declines (Stripe-style test card);
// "0000" is always approved; anything else succeeds ~95% of the time.
const chargeCard = async (amount, { cardLast4 }) => {
  await delay(1200); // simulated processing delay
  if (cardLast4 && cardLast4.endsWith('0002')) {
    return { ok: false, reason: 'Card was declined by the issuer.' };
  }
  if (cardLast4 && !cardLast4.endsWith('0000') && Math.random() < 0.05) {
    return { ok: false, reason: 'Insufficient funds.' };
  }
  return { ok: true, transactionId: txId('txn') };
};

const processSandboxPayment = async (userId, rideId, { idempotencyKey, cardLast4 }) => {
  assertCardProcessor(process.env, false);
  const ride = await assertPayable(userId, rideId);

  const existing = await settledPayment(rideId);
  if (existing) return existing;

  let key = idempotencyKey || `ride:${rideId}`;
  const seen = await Payment.findOne({ idempotencyKey: key });
  if (seen) {
    throw fail('Payment request already processed. Check your payment status.', 409);
  }

  const amount = rideAmount(ride);
  if (!amount || amount <= 0) throw fail('Cannot charge a ride with no fare', 400);

  const payment = await Payment.create({
    user: userId,
    ride: rideId,
    amount,
    method: 'card',
    provider: 'sandbox',
    idempotencyKey: key,
    cardLast4: cardLast4 || '',
    status: 'pending',
  });

  const result = await chargeCard(amount, { cardLast4 });

  if (!result.ok) {
    payment.status = 'failed';
    payment.failureReason = result.reason;
    await payment.save();
    return payment;
  }

  payment.status = 'succeeded';
  payment.transactionId = result.transactionId;
  await payment.save();

  ride.payment = {
    method: 'card',
    status: 'paid',
    transactionId: result.transactionId,
  };
  await ride.save();

  return payment;
};

// Refund a settled payment — ADMIN/FINANCE ONLY (passenger must request via
// RefundRequest). The status transition is claimed atomically before the
// provider call so two finance users cannot refund the same payment twice.
export const refundPayment = async (userId, paymentId, admin = false) => {
  if (!admin) throw fail('Only staff can issue refunds. Please request a refund via support.', 403);

  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: 'succeeded' },
    { $set: { status: 'refunding' } },
    { new: true },
  );
  if (!payment) {
    const existing = await Payment.findById(paymentId).select('status');
    if (existing?.status === 'refunded') throw fail('Payment has already been refunded', 409);
    if (existing?.status === 'refunding') throw fail('Refund is already being processed', 409);
    throw fail('No successful payment found to refund', 404);
  }

  const revert = async () => {
    await Payment.updateOne({ _id: payment._id, status: 'refunding' }, { $set: { status: 'succeeded' } });
  };

  let refundTransactionId;
  try {
    if (payment.provider === 'stripe') {
      if (!stripeEnabled) {
        throw fail('Stripe is not configured; the refund cannot be sent to the provider.', 503);
      }
      const refund = await stripe.refunds.create({ payment_intent: payment.transactionId });
      refundTransactionId = refund.id;
    } else if (payment.provider === 'sandbox') {
      if (isProduction(process.env)) {
        throw fail('Sandbox payments cannot be refunded in production.', 503);
      }
      refundTransactionId = txId('refund');
    } else {
      throw fail('Cash payments are collected by the driver and cannot be refunded online.', 400);
    }
  } catch (err) {
    await revert();
    throw err;
  }

  payment.status = 'refunded';
  payment.refundedAt = new Date();
  payment.refundTransactionId = refundTransactionId;
  await payment.save();

  const ride = await Ride.findById(payment.ride);
  if (ride) {
    ride.payment.status = 'refunded';
    await ride.save();
  }

  return payment;
};

// Record cash handed to the assigned driver. Idempotent.
export const collectCash = async (paymentId, driverId) => {
  const payment = await Payment.findOne({ _id: paymentId, provider: 'cash', status: 'cash_due' });
  if (!payment) {
    const existing = await Payment.findById(paymentId).select('status provider');
    if (existing?.status === 'cash_collected' || existing?.status === 'cash') {
      return Payment.findById(paymentId);
    }
    throw fail('Cash-due payment not found', 404);
  }

  const ride = await Ride.findOne({ _id: payment.ride, driver: driverId, status: 'completed' });
  if (!ride) throw fail('Only the assigned driver can record cash for this completed ride', 403);

  const collected = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'cash_due' },
    {
      $set: {
        status: 'cash_collected',
        cashCollectedAt: new Date(),
        cashCollectedBy: driverId,
      },
    },
    { new: true },
  );
  if (!collected) throw fail('Cash collection was already recorded', 409);

  ride.payment.status = 'cash_collected';
  await ride.save();
  return collected;
};

export const getPayment = async (userId, paymentId, admin = false) => {
  const query = { _id: paymentId };
  if (!admin) query.user = userId;
  const payment = await Payment.findOne(query).populate('ride', 'pickup dropoff fare status');
  if (!payment) throw fail('Payment not found', 404);
  return payment;
};

export const listPayments = async (userId) =>
  Payment.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('ride', 'pickup dropoff fare status');

// --- Refund Request flow (passenger asks, admin approves) ---
import RefundRequest from '../models/RefundRequest.js';

export const requestRefund = async (userId, paymentId, reason) => {
  if (!reason || !reason.trim()) throw fail('Please provide a reason for refund', 400);
  const payment = await Payment.findOne({ _id: paymentId, user: userId, status: 'succeeded' });
  if (!payment) throw fail('No successful payment found', 404);
  if (payment.provider === 'cash') throw fail('Cash payments cannot be refunded', 400);
  const existing = await RefundRequest.findOne({ payment: paymentId, status: 'pending' });
  if (existing) throw fail('Refund already requested and pending admin review', 409);
  const alreadyRefunded = await RefundRequest.findOne({ payment: paymentId, status: 'approved' });
  if (alreadyRefunded) throw fail('Already refunded', 409);
  const reqDoc = await RefundRequest.create({
    user: userId,
    ride: payment.ride,
    payment: paymentId,
    amount: payment.amount,
    reason: reason.trim(),
  });
  return reqDoc;
};

export const listRefundRequests = async (userId = null, admin = false) => {
  const query = admin ? {} : { user: userId };
  return RefundRequest.find(query).sort({ createdAt: -1 }).limit(100).populate('user ride payment');
};

export const decideRefund = async (requestId, adminId, approve, note = '') => {
  const reqDoc = await RefundRequest.findOne({ _id: requestId, status: 'pending' });
  if (!reqDoc) throw fail('Refund request not found or already decided', 404);
  if (approve) {
    // Perform actual refund via existing logic (admin)
    const payment = await refundPayment(adminId, reqDoc.payment, true);
    reqDoc.status = 'approved';
    reqDoc.decidedBy = adminId;
    reqDoc.decidedAt = new Date();
    reqDoc.adminNote = note;
    await reqDoc.save();
    return { request: reqDoc, payment };
  } else {
    reqDoc.status = 'rejected';
    reqDoc.decidedBy = adminId;
    reqDoc.decidedAt = new Date();
    reqDoc.adminNote = note;
    await reqDoc.save();
    return { request: reqDoc };
  }
};
// --- Stripe webhook reconciliation -----------------------------------------
// Webhooks are the source of truth when a payment is confirmed outside the
// browser (3DS redirect, delayed method, mobile app killed). Signature
// verification is mandatory; without a configured secret the endpoint fails
// closed rather than trusting an unsigned body.
export const constructStripeEvent = (rawBody, signature) => {
  if (!stripeEnabled || !stripeWebhookSecret) {
    throw fail('Stripe webhooks are not configured.', 503);
  }
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  } catch {
    throw fail('Invalid Stripe webhook signature.', 400);
  }
};

const syncIntentSettlement = async (intent) => {
  const rideId = intent?.metadata?.rideId;
  const userId = intent?.metadata?.userId;
  if (!rideId || !userId) return { ignored: true, reason: 'missing metadata' };

  const ride = await Ride.findOne({ _id: rideId, passenger: userId, status: 'completed' });
  if (!ride) return { ignored: true, reason: 'ride not payable' };

  const existing = await settledPayment(rideId);
  if (existing) return { payment: existing, duplicate: true };

  const amount = rideAmount(ride);
  if (!amount || intent.amount !== cents(amount)) {
    throw fail('Webhook amount does not match the ride fare.', 400);
  }

  let last4 = '';
  try {
    if (intent.payment_method) {
      const pm = await stripe.paymentMethods.retrieve(intent.payment_method);
      last4 = pm?.card?.last4 || '';
    }
  } catch {
    // Cosmetic only.
  }

  const payment = await recordSettlement(rideId, userId, () => ({
    user: userId,
    ride: rideId,
    amount,
    method: 'card',
    provider: 'stripe',
    status: 'succeeded',
    transactionId: intent.id,
    cardLast4: last4,
    idempotencyKey: `pi:${intent.id}`,
  }));

  ride.payment = { method: 'card', status: 'paid', transactionId: intent.id };
  await ride.save();
  return { payment };
};

const syncRefund = async (charge) => {
  const intentId = typeof charge?.payment_intent === 'string'
    ? charge.payment_intent
    : charge?.payment_intent?.id;
  if (!intentId || !charge?.refunded) return { ignored: true };
  const payment = await Payment.findOne({ transactionId: intentId, provider: 'stripe' });
  if (!payment || payment.status === 'refunded') return { ignored: true };
  payment.status = 'refunded';
  payment.refundedAt = new Date();
  payment.refundTransactionId = charge.refunds?.data?.[0]?.id || '';
  await payment.save();
  await Ride.updateOne({ _id: payment.ride }, { $set: { 'payment.status': 'refunded' } });
  return { payment };
};

export const handleStripeEvent = async (event) => {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return syncIntentSettlement(event.data.object);
    case 'charge.refunded':
      return syncRefund(event.data.object);
    case 'payment_intent.payment_failed':
      // Failed attempts are surfaced to the client. They are deliberately not
      // persisted with the PaymentIntent id: the same intent can be retried and
      // later succeed, and transactionId is unique.
      return { ignored: true, reason: 'failed attempt' };
    default:
      return { ignored: true, reason: `unhandled ${event.type}` };
  }
};

export const collectCashForRide = async (rideId, driverId) => {
  const payment = await Payment.findOne({ ride: rideId, status: 'cash_due' }).select('_id');
  if (!payment) {
    const ride = await Ride.findOne({ _id: rideId, driver: driverId }).select('payment');
    if (ride?.payment?.status === 'cash_collected') {
      const existing = await Payment.findOne({ ride: rideId, status: 'cash_collected' });
      if (existing) return existing;
    }
    throw fail('No cash-due payment found for this ride', 404);
  }
  return collectCash(payment._id, driverId);
};
