import 'dotenv/config';
import express, { Request, Response } from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? '';
const REMI_PHONE = process.env.REMI_PHONE ?? '';
const PORT = process.env.ONBOARDING_PORT ?? 3001;

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim();
  const digitsOnly = cleaned.replace(/\D/g, '');

  if (digitsOnly.length === 10) return `+1${digitsOnly}`;
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) return `+${digitsOnly}`;
  if (cleaned.startsWith('+') && digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }
  return null;
}

function deriveGender(title: string): 'm' | 'f' {
  return title === 'Mr' ? 'm' : 'f';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Step 1 → create Stripe customer + SetupIntent, return clientSecret
app.post('/api/onboarding/init', async (req: Request, res: Response) => {
  const { name, email, phone, date_of_birth, title, passport_number } = req.body as Record<string, string>;

  if (!name?.trim() || !email?.trim() || !phone?.trim() || !date_of_birth || !title) {
    res.status(400).json({ error: 'All required fields must be provided.' });
    return;
  }

  if (!['Mr', 'Ms', 'Mrs', 'Miss'].includes(title)) {
    res.status(400).json({ error: 'Invalid title.' });
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
    res.status(400).json({ error: 'Invalid date of birth.' });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Invalid phone number. Use E.164 format, e.g. +14155552671.' });
    return;
  }

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'This number is already registered.' });
      return;
    }

    const customer = await stripe.customers.create({ name: name.trim(), email: email.trim(), phone: normalizedPhone });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        phone: normalizedPhone,
        name: name.trim(),
        email: email.trim(),
        date_of_birth,
        title,
        gender: deriveGender(title),
        passport_number: passport_number?.trim() || '',
      },
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
      setupIntentId: setupIntent.id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error.';
    console.error('onboarding/init error:', msg);
    res.status(500).json({ error: msg });
  }
});

// Step 2 → retrieve confirmed SetupIntent, insert user into Supabase
app.post('/api/onboarding/complete', async (req: Request, res: Response) => {
  const { setupIntentId } = req.body as { setupIntentId: string };

  if (!setupIntentId) {
    res.status(400).json({ error: 'Missing setupIntentId.' });
    return;
  }

  try {
    const si = await stripe.setupIntents.retrieve(setupIntentId);

    if (si.status !== 'succeeded') {
      res.status(400).json({ error: 'Payment setup not confirmed. Please try again.' });
      return;
    }

    const paymentMethodId = typeof si.payment_method === 'string'
      ? si.payment_method
      : si.payment_method?.id;

    if (!paymentMethodId) {
      res.status(400).json({ error: 'No payment method attached.' });
      return;
    }

    const meta = si.metadata ?? {};
    const phone = meta['phone'];
    const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id;

    if (!phone || !customerId) {
      res.status(400).json({ error: 'Missing session data. Please start over.' });
      return;
    }

    // Duplicate guard (race condition)
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'This number is already registered.' });
      return;
    }

    const { error: insertError } = await supabase.from('users').insert({
      phone,
      name: meta['name'],
      email: meta['email'],
      date_of_birth: meta['date_of_birth'],
      gender: meta['gender'] as 'm' | 'f',
      passport_number: meta['passport_number'] || null,
      stripe_customer_id: customerId,
      stripe_spt_id: paymentMethodId,
    });

    if (insertError) {
      if (insertError.code === '23505') {
        res.status(409).json({ error: 'This number is already registered.' });
        return;
      }
      throw insertError;
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error.';
    console.error('onboarding/complete error:', msg);
    res.status(500).json({ error: msg });
  }
});

// Serve the single-page onboarding form
app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html(STRIPE_PUBLISHABLE_KEY, REMI_PHONE));
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

function html(stripeKey: string, remiPhone: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Remi — Get Started</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f3f3f3;
      --bg-page-top: #fafafa;
      --bg-card: #ffffff;
      --border: rgba(0,0,0,0.08);
      --border-strong: rgba(0,0,0,0.14);
      --text-primary: #0a0a0a;
      --text-secondary: #5c5c5c;
      --text-muted: #8a8a8a;
      --accent: #ff385c;
      --accent-hover: #e31c5f;
      --cta-bg: #0a0a0a;
      --cta-hover: #222;
      --error: #c13515;
      --error-bg: rgba(193,53,21,0.09);
      --success: #008a05;
      --success-bg: rgba(0,138,5,0.09);
      --radius: 14px;
      --shadow: 0 6px 20px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
      --font: "Manrope", system-ui, -apple-system, sans-serif;
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      background-image: linear-gradient(180deg, var(--bg-page-top) 0%, var(--bg) 50%);
      color: var(--text-primary);
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 48px 16px 80px;
      -webkit-font-smoothing: antialiased;
    }

    .wordmark {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--text-primary);
      margin-bottom: 36px;
    }

    .card {
      background: var(--bg-card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 36px 32px;
      width: 100%;
      max-width: 440px;
    }

    .step-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
      margin-bottom: 6px;
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 28px;
      line-height: 1.5;
    }

    .field { margin-bottom: 18px; }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .optional-tag {
      font-weight: 400;
      color: var(--text-muted);
      margin-left: 4px;
    }

    input, select {
      width: 100%;
      height: 44px;
      padding: 0 14px;
      border: 1.5px solid var(--border-strong);
      border-radius: 10px;
      font-family: var(--font);
      font-size: 15px;
      color: var(--text-primary);
      background: #fff;
      outline: none;
      transition: border-color 0.15s;
      -webkit-appearance: none;
      appearance: none;
    }

    select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%235c5c5c' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      padding-right: 36px;
    }

    input:focus, select:focus { border-color: var(--accent); }

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 5px;
    }

    #payment-element {
      border: 1.5px solid var(--border-strong);
      border-radius: 10px;
      padding: 14px;
      background: #fff;
    }

    .btn {
      display: block;
      width: 100%;
      height: 48px;
      background: var(--cta-bg);
      color: #fff;
      border: none;
      border-radius: 10px;
      font-family: var(--font);
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 28px;
      transition: background 0.15s, opacity 0.15s;
      letter-spacing: -0.1px;
    }

    .btn:hover { background: var(--cta-hover); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .error-box {
      display: none;
      background: var(--error-bg);
      border: 1px solid rgba(193,53,21,0.2);
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      color: var(--error);
      margin-bottom: 20px;
      line-height: 1.5;
    }

    .error-box.visible { display: block; }

    /* Success screen */
    .success-icon {
      width: 56px;
      height: 56px;
      background: var(--success-bg);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }

    .success-icon svg { width: 26px; height: 26px; }

    .success-title {
      font-size: 22px;
      font-weight: 700;
      text-align: center;
      letter-spacing: -0.3px;
      margin-bottom: 10px;
    }

    .success-body {
      font-size: 15px;
      color: var(--text-secondary);
      text-align: center;
      line-height: 1.6;
    }

    .success-phone {
      font-weight: 700;
      color: var(--text-primary);
    }

    .screen { display: none; }
    .screen.active { display: block; }

    @media (max-width: 480px) {
      body { padding: 32px 12px 60px; }
      .card { padding: 28px 20px; }
    }
  </style>
</head>
<body>

<div class="wordmark">Remi</div>

<div class="card">

  <!-- Step 1: Personal details -->
  <div id="screen-1" class="screen active">
    <div class="step-label">Step 1 of 2</div>
    <h1>Your details</h1>
    <p class="subtitle">Tell us a bit about yourself so Remi can book on your behalf.</p>

    <div id="error-1" class="error-box"></div>

    <form id="form-1" novalidate>
      <div class="field">
        <label for="title">Title</label>
        <select id="title" name="title" required>
          <option value="" disabled selected>Select…</option>
          <option value="Mr">Mr</option>
          <option value="Ms">Ms</option>
          <option value="Mrs">Mrs</option>
          <option value="Miss">Miss</option>
        </select>
      </div>

      <div class="field">
        <label for="name">Full name</label>
        <input id="name" name="name" type="text" autocomplete="name" placeholder="Ada Lovelace" required>
      </div>

      <div class="field">
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" autocomplete="email" placeholder="ada@example.com" required>
      </div>

      <div class="field">
        <label for="phone">Mobile number</label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="+14155552671" required>
        <p class="hint">Use the number you'll text Remi from (E.164 format, e.g. +14155552671)</p>
      </div>

      <div class="field">
        <label for="dob">Date of birth</label>
        <input id="dob" name="date_of_birth" type="date" required>
      </div>

      <div class="field">
        <label for="passport">Passport number <span class="optional-tag">(optional — needed for international flights)</span></label>
        <input id="passport" name="passport_number" type="text" autocomplete="off" placeholder="AB1234567">
      </div>

      <button class="btn" type="submit" id="btn-1">Continue →</button>
    </form>
  </div>

  <!-- Step 2: Payment -->
  <div id="screen-2" class="screen">
    <div class="step-label">Step 2 of 2</div>
    <h1>Payment setup</h1>
    <p class="subtitle">Remi charges your card only when a booking is confirmed. No surprise fees.</p>

    <div id="error-2" class="error-box"></div>

    <form id="form-2" novalidate>
      <div class="field">
        <div id="payment-element"></div>
      </div>
      <button class="btn" type="submit" id="btn-2" disabled>Loading…</button>
    </form>
  </div>

  <!-- Step 3: Success -->
  <div id="screen-3" class="screen">
    <div class="success-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#008a05" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <p class="success-title">You're all set.</p>
    <p class="success-body">
      Text Remi at <span class="success-phone" id="remi-phone-display">${remiPhone || 'the number on your invite'}</span> to book your first flight.
    </p>
  </div>

</div>

<script>
(function () {
  'use strict';

  const STRIPE_KEY = ${JSON.stringify(stripeKey)};

  let stripe, elements;
  let savedUserInfo = {};
  let savedCustomerId = '';
  let savedSetupIntentId = '';

  function show(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  function setError(errorId, msg) {
    const box = document.getElementById(errorId);
    box.textContent = msg;
    box.classList.toggle('visible', !!msg);
  }

  function setLoading(btnId, loading, defaultLabel) {
    const btn = document.getElementById(btnId);
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait…' : defaultLabel;
  }

  // -------------------------------------------------------------------------
  // Handle 3DS redirect return
  // -------------------------------------------------------------------------
  async function checkRedirectReturn() {
    const params = new URLSearchParams(window.location.search);
    const siId = params.get('setup_intent');
    const siStatus = params.get('redirect_status');

    if (!siId || siStatus !== 'succeeded') return;

    // Restore user info from sessionStorage
    const stored = sessionStorage.getItem('remi_pending');
    if (!stored) return;

    const { userInfo, customerId } = JSON.parse(stored);
    sessionStorage.removeItem('remi_pending');
    history.replaceState({}, '', window.location.pathname);

    show('screen-2');
    setError('error-2', '');

    await completeOnboarding(siId, customerId, userInfo);
  }

  // -------------------------------------------------------------------------
  // Step 1 submit
  // -------------------------------------------------------------------------
  document.getElementById('form-1').addEventListener('submit', async function (e) {
    e.preventDefault();
    setError('error-1', '');
    setLoading('btn-1', true, 'Continue →');

    const userInfo = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      date_of_birth: document.getElementById('dob').value,
      title: document.getElementById('title').value,
      passport_number: document.getElementById('passport').value.trim(),
    };

    let res, data;
    try {
      res = await fetch('/api/onboarding/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userInfo),
      });
      data = await res.json();
    } catch (_) {
      setError('error-1', 'Network error. Please try again.');
      setLoading('btn-1', false, 'Continue →');
      return;
    }

    if (!res.ok) {
      setError('error-1', data.error || 'Something went wrong.');
      setLoading('btn-1', false, 'Continue →');
      return;
    }

    savedUserInfo = userInfo;
    savedCustomerId = data.customerId;
    savedSetupIntentId = data.setupIntentId;

    // Persist to sessionStorage in case of 3DS redirect
    sessionStorage.setItem('remi_pending', JSON.stringify({
      userInfo,
      customerId: data.customerId,
    }));

    // Mount Stripe Payment Element
    stripe = Stripe(STRIPE_KEY);
    elements = stripe.elements({ clientSecret: data.clientSecret, appearance: { theme: 'stripe' } });
    const paymentEl = elements.create('payment');
    paymentEl.mount('#payment-element');
    paymentEl.on('ready', function () {
      const btn = document.getElementById('btn-2');
      btn.disabled = false;
      btn.textContent = 'Set up payment →';
    });

    setLoading('btn-1', false, 'Continue →');
    show('screen-2');
  });

  // -------------------------------------------------------------------------
  // Step 2 submit
  // -------------------------------------------------------------------------
  document.getElementById('form-2').addEventListener('submit', async function (e) {
    e.preventDefault();
    setError('error-2', '');
    setLoading('btn-2', true, 'Set up payment →');

    let result;
    try {
      result = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
    } catch (_) {
      setError('error-2', 'Payment error. Please try again.');
      setLoading('btn-2', false, 'Set up payment →');
      return;
    }

    if (result.error) {
      setError('error-2', result.error.message);
      setLoading('btn-2', false, 'Set up payment →');
      return;
    }

    await completeOnboarding(result.setupIntent.id, savedCustomerId, savedUserInfo);
  });

  // -------------------------------------------------------------------------
  // Finalise — server insert
  // -------------------------------------------------------------------------
  async function completeOnboarding(setupIntentId, customerId, userInfo) {
    let res, data;
    try {
      res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupIntentId }),
      });
      data = await res.json();
    } catch (_) {
      setError('error-2', 'Network error. Please try again.');
      setLoading('btn-2', false, 'Set up payment →');
      return;
    }

    if (!res.ok) {
      setError('error-2', data.error || 'Something went wrong.');
      setLoading('btn-2', false, 'Set up payment →');
      return;
    }

    sessionStorage.removeItem('remi_pending');
    show('screen-3');
  }

  // Run redirect-return check on load
  checkRedirectReturn();
})();
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Remi onboarding server → http://localhost:${PORT}`);
});
