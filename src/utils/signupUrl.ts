/**
 * Returns the public Remi signup URL with the user's phone embedded.
 * The web app uses ?phone= to look the user up in Supabase and create
 * a Stripe Customer + SetupIntent for them.
 *
 * SIGNUP_URL_BASE can override the host (useful for staging).
 */
const DEFAULT_BASE = 'https://remitexts.co/signup';

export function buildSignupUrl(phone: string): string {
  const base = (process.env.SIGNUP_URL_BASE ?? DEFAULT_BASE).trim() || DEFAULT_BASE;
  if (!phone) return base;
  const encoded = encodeURIComponent(phone);
  return `${base}?phone=${encoded}`;
}
