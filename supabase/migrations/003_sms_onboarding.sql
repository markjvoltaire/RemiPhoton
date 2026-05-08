-- SMS onboarding support (no payment info required)

create table if not exists onboarding_sessions (
  phone        text primary key,
  step         text not null check (step in ('name', 'email', 'dob', 'title', 'passport')),
  name         text,
  email        text,
  date_of_birth date,
  title        text,
  gender       text check (gender in ('m', 'f')),
  passport_number text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger onboarding_sessions_updated_at
  before update on onboarding_sessions
  for each row execute function update_updated_at();

-- Allow user creation without payment method on file (payment can be added later)
alter table users
  alter column stripe_customer_id drop not null,
  alter column stripe_spt_id drop not null;

