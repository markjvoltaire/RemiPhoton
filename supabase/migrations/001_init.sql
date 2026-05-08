create extension if not exists "pgcrypto";

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  phone           text unique not null,
  name            text not null,
  email           text not null,
  date_of_birth   date not null,
  gender          text not null check (gender in ('m', 'f')),
  passport_number text,
  stripe_customer_id text not null,
  stripe_spt_id   text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index conversations_user_id_created_at on conversations(user_id, created_at);

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();
