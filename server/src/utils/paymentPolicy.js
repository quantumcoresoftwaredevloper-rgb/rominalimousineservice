// Card-processing policy. The sandbox simulator is a development convenience,
// never a production payment path: silently succeeding without a gateway would
// hand passengers unpaid rides.
export const isProduction = (env = process.env) => env.NODE_ENV === 'production';

/**
 * @returns {'stripe'|'sandbox'|null} the card processor available to this deployment.
 * null means card payments must fail closed.
 */
export const cardProcessor = (env = process.env, stripeEnabled = false) => {
  if (stripeEnabled) return 'stripe';
  if (isProduction(env)) return null;
  return 'sandbox';
};

export const assertCardProcessor = (env = process.env, stripeEnabled = false) => {
  const processor = cardProcessor(env, stripeEnabled);
  if (!processor) {
    throw Object.assign(
      new Error('Card payments are not configured on this server. Please pay by cash or contact support.'),
      { statusCode: 503 },
    );
  }
  return processor;
};

export const isCashSettledStatus = (status) =>
  ['cash', 'cash_due', 'cash_collected'].includes(status);
