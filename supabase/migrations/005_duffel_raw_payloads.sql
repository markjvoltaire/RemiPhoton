alter table if exists users
  add column if not exists pending_duffel_order jsonb;
