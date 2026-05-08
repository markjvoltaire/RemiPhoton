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
