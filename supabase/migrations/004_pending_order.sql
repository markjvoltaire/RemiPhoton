alter table if exists users
  add column if not exists pending_order_id text,
  add column if not exists pending_order_amount text,
  add column if not exists pending_order_currency text,
  add column if not exists pending_booking_reference text;
