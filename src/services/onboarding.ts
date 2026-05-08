import { createClient } from '@supabase/supabase-js';
import type { UserProfile } from '../types.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type OnboardingStep = 'name' | 'email' | 'dob' | 'title' | 'passport';

export interface OnboardingSession {
  phone: string;
  step: OnboardingStep;
  name: string | null;
  email: string | null;
  date_of_birth: string | null; // YYYY-MM-DD
  title: string | null;
  gender: 'm' | 'f' | null;
  passport_number: string | null;
}

function deriveGender(title: string): 'm' | 'f' {
  return title === 'Mr' ? 'm' : 'f';
}

function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // Basic sanity check; keep it permissive for SMS input.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function normalizeDob(raw: string): string | null {
  const s = raw.trim();
  // Expect YYYY-MM-DD to avoid locale ambiguity.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function normalizeTitle(raw: string): 'Mr' | 'Ms' | 'Mrs' | 'Miss' | null {
  const s = raw.trim().replace(/\.$/, '');
  const map: Record<string, 'Mr' | 'Ms' | 'Mrs' | 'Miss'> = {
    mr: 'Mr',
    mrs: 'Mrs',
    ms: 'Ms',
    miss: 'Miss',
  };
  return map[s.toLowerCase()] ?? null;
}

export async function getOnboardingSession(phone: string): Promise<OnboardingSession | null> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (error || !data) return null;

  return {
    phone: data.phone,
    step: data.step,
    name: data.name ?? null,
    email: data.email ?? null,
    date_of_birth: data.date_of_birth ?? null,
    title: data.title ?? null,
    gender: (data.gender as 'm' | 'f' | null) ?? null,
    passport_number: data.passport_number ?? null,
  };
}

export async function startOnboarding(phone: string): Promise<OnboardingSession> {
  const { data, error } = await supabase
    .from('onboarding_sessions')
    .upsert({ phone, step: 'name' }, { onConflict: 'phone' })
    .select('*')
    .single();
  if (error) throw error;
  return {
    phone: data.phone,
    step: data.step,
    name: data.name ?? null,
    email: data.email ?? null,
    date_of_birth: data.date_of_birth ?? null,
    title: data.title ?? null,
    gender: (data.gender as 'm' | 'f' | null) ?? null,
    passport_number: data.passport_number ?? null,
  };
}

export async function advanceOnboarding(
  session: OnboardingSession,
  inboundText: string,
): Promise<
  | { kind: 'prompt'; message: string }
  | { kind: 'completed'; user: UserProfile }
> {
  const text = inboundText.trim();

  if (session.step === 'name') {
    const name = text.replace(/\s+/g, ' ').trim();
    if (name.length < 2) return { kind: 'prompt', message: 'What’s your full name?' };
    await supabase.from('onboarding_sessions').update({ name, step: 'email' }).eq('phone', session.phone);
    return { kind: 'prompt', message: 'What’s your email?' };
  }

  if (session.step === 'email') {
    const email = normalizeEmail(text);
    if (!email) return { kind: 'prompt', message: 'That email doesn’t look right. What’s your email?' };
    await supabase.from('onboarding_sessions').update({ email, step: 'dob' }).eq('phone', session.phone);
    return { kind: 'prompt', message: 'What’s your date of birth? (YYYY-MM-DD)' };
  }

  if (session.step === 'dob') {
    const dob = normalizeDob(text);
    if (!dob) return { kind: 'prompt', message: 'Please send your date of birth as YYYY-MM-DD.' };
    await supabase.from('onboarding_sessions').update({ date_of_birth: dob, step: 'title' }).eq('phone', session.phone);
    return { kind: 'prompt', message: 'What title should I use? (Mr, Ms, Mrs, or Miss)' };
  }

  if (session.step === 'title') {
    const title = normalizeTitle(text);
    if (!title) return { kind: 'prompt', message: 'Please reply with Mr, Ms, Mrs, or Miss.' };
    const gender = deriveGender(title);
    await supabase.from('onboarding_sessions').update({ title, gender, step: 'passport' }).eq('phone', session.phone);
    return {
      kind: 'prompt',
      message: 'Passport number? Reply “skip” if you don’t have it handy (needed for international flights).',
    };
  }

  // passport step
  const passport = /^skip$/i.test(text) ? null : text.replace(/\s+/g, '').toUpperCase();
  await supabase
    .from('onboarding_sessions')
    .update({ passport_number: passport })
    .eq('phone', session.phone);

  // Create user (no payment info)
  const latest = await getOnboardingSession(session.phone);
  if (!latest?.name || !latest.email || !latest.date_of_birth || !latest.gender) {
    return { kind: 'prompt', message: 'Something went wrong—can you start again with your full name?' };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('users')
    .insert({
      phone: latest.phone,
      name: latest.name,
      email: latest.email,
      date_of_birth: latest.date_of_birth,
      gender: latest.gender,
      passport_number: latest.passport_number,
      stripe_customer_id: null,
      stripe_spt_id: null,
    })
    .select('*')
    .single();

  // If user already exists, fetch and proceed
  if (insertError) {
    const { data: existing } = await supabase.from('users').select('*').eq('phone', latest.phone).maybeSingle();
    if (!existing) throw insertError;
    await supabase.from('onboarding_sessions').delete().eq('phone', latest.phone);
    return { kind: 'completed', user: existing as UserProfile };
  }

  await supabase.from('onboarding_sessions').delete().eq('phone', latest.phone);
  return { kind: 'completed', user: inserted as UserProfile };
}

