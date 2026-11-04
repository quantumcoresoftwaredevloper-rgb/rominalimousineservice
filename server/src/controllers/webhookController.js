import { constructStripeEvent, handleStripeEvent } from '../services/paymentService.js';

// POST /api/webhooks/stripe
// Mounted with express.raw() before the JSON body parser so the signature is
// verified against the exact bytes Stripe signed.
export const stripeWebhook = async (req, res) => {
  let event;
  try {
    event = constructStripeEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }

  try {
    const result = await handleStripeEvent(event);
    return res.json({ received: true, ...(result?.ignored ? { ignored: true } : {}) });
  } catch (err) {
    // Returning 5xx makes Stripe retry with backoff, which is what we want for
    // transient database/provider failures.
    console.error('Stripe webhook handling failed:', err.message);
    return res.status(500).json({ message: 'Webhook handling failed' });
  }
};
