import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function chargeViaSPT(
  sptId: string,
  amountInCents: number,
  currency: string,
): Promise<string> {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency,
    payment_method: sptId,
    confirm: true,
    off_session: true,
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error(`Payment failed with status: ${paymentIntent.status}`);
  }

  return paymentIntent.id;
}

/**
 * Refund a previously-confirmed PaymentIntent. Used to roll back a Stripe
 * charge when a downstream booking step (e.g. Duffel order create) fails
 * after the user has already been charged.
 */
export async function refundPaymentIntent(paymentIntentId: string): Promise<string> {
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
  return refund.id;
}
