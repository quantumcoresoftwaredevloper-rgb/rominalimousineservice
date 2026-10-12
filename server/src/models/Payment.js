import mongoose from 'mongoose';

// Payment record. Providers: sandbox (simulated) and stripe (real card). A
// 'cash' payment is recorded when the passenger chooses to pay the driver in
// cash — no online charge is made.
const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },
    method: { type: String, enum: ['card', 'wallet', 'cash'], default: 'card' },
    // 'sandbox' = simulated gateway, 'stripe' = real Stripe, 'cash' = no charge.
    provider: { type: String, enum: ['sandbox', 'stripe', 'cash'], default: 'sandbox' },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded', 'cash'],
      default: 'pending',
    },
    // Set only on success; sparse so pending/failed payments don't collide.
    // For Stripe this is the PaymentIntent id (pi_...).
    transactionId: { type: String, unique: true, sparse: true },
    // Caller-supplied idempotency key; unique index prevents double-charging.
    idempotencyKey: { type: String, unique: true, sparse: true },
    failureReason: { type: String, default: '' },
    cardLast4: { type: String, default: '' },
    refundedAt: Date,
    refundTransactionId: { type: String, default: '' },  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });
// The admin payments page groups the whole collection by status for its
// summary tiles. There was no leading status index, so that was a full scan on
// every page load.
paymentSchema.index({ status: 1 });

// The real double-charge guard. The idempotencyKey index cannot do this job:
// the client is told to send a fresh key per attempt, so two concurrent
// requests carry different keys and the database never sees a conflict. This
// partial unique index keys on the ride itself and only covers settled states,
// so the second inserter fails with 11000 and recordSettlement returns the
// first request's row instead of writing a second one.
//
// Must be created in production for the guarantee to hold — the unique flag
// requires an index build.
//
// The name is explicit on purpose. Without it Mongo auto-names this
// `ride_1`, which collided with the plain non-unique `ride_1` left behind by
// the old `index: true` on the ride field. Mongoose's autoIndex then failed
// the create silently and the double-charge guard was absent in production
// while the code looked correct. Verify with:
//   db.payments.getIndexes().filter(i => i.name === 'ride_settled_unique')
paymentSchema.index(
  { ride: 1 },
  {
    unique: true,
    name: 'ride_settled_unique',
    partialFilterExpression: { status: { $in: ['succeeded', 'cash'] } },
  },
);

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;