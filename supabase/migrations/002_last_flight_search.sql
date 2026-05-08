alter table users
  add column if not exists last_flight_search jsonb;
