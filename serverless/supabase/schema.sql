-- Lumina orders table for DATA_SOURCE=supabase.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: it creates nothing that already exists and re-seeds only the test orders.

create table if not exists public.orders (
  id                  bigint generated always as identity primary key,
  order_id            text not null,
  -- Letters and digits of order_id, upper-cased. The API looks orders up by this,
  -- so "ord test 001" spoken by a caller finds "ORD-TEST-001".
  order_key           text generated always as (upper(regexp_replace(order_id, '[^A-Za-z0-9]', '', 'g'))) stored unique,
  customer_name       text,
  email               text,
  phone               text,
  status              text,          -- e.g. processing, shipped, delivered, cancelled
  carrier             text,
  tracking_number     text,
  delivery_date       date,
  delivery_location   text,
  tracking_steps      text[] not null default '{}',
  item                text,
  price               numeric(12, 2),
  item_condition      text,          -- e.g. unopened, opened
  -- Written by the API. Kept as text: the API stores ISO timestamps and reads them back as-is.
  cancel_date         text,
  cancel_reason       text,
  return_status       text,
  return_reason       text,
  return_initiated_at text,
  refund_status       text,
  refund_amount       text,
  refund_date         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function public.lumina_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders
  for each row execute function public.lumina_touch_updated_at();

-- Row Level Security on, with no policies: the public (anon) key can read or
-- write nothing. Only the server-side secret key used by Vercel can.
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

-- Synthetic test orders (no real customer data). Delete these once real orders are loaded.
insert into public.orders
  (order_id, customer_name, email, phone, status, carrier, tracking_number, delivery_date,
   delivery_location, tracking_steps, item, price, item_condition, return_status)
values
  ('ORD-TEST-001', 'Alex Example',   'alex@example.test',   '+1-555-0101', 'shipped',    'UPS',   '1ZTEST00000000001',  '2026-12-31',              'Test City', array['Label created','In transit'],              null,                  null,  null,       null),
  ('ORD-TEST-002', 'Sam Example',    'sam@example.test',    '+1-555-0102', 'processing', null,    null,                 null,                      'Test City', array['Order received'],                          null,                  null,  null,       null),
  ('ORD-TEST-003', 'Taylor Example', 'taylor@example.test', '+1-555-0103', 'delivered',  'USPS',  '9400TEST0000000003', '2026-08-20',              'Test City', array['Label created','In transit','Delivered'], null,                  null,  null,       null),
  ('ORD-TEST-004', 'Jordan Example', 'jordan@example.test', '+1-555-0104', 'processing', 'FedEx', 'TESTFEDEX0000004',   current_date + 5,          'Test City', array['Order received','Packed'],                'Desk Lamp',           3200,  null,       null),
  ('ORD-TEST-005', 'Casey Example',  'casey@example.test',  '+1-555-0105', 'delivered',  'UPS',   '1ZTEST00000000005',  current_date - 3,          'Test City', array['Label created','In transit','Delivered'], 'Wireless Headphones', 4500,  'unopened', null),
  ('ORD-TEST-006', 'Riley Example',  'riley@example.test',  '+1-555-0106', 'delivered',  'USPS',  '9400TEST0000000006', current_date - 5,          'Test City', array['Label created','In transit','Delivered'], 'Coffee Grinder',      12999, 'unopened', 'initiated'),
  ('ORD-TEST-007', 'Morgan Example', 'morgan@example.test', '+1-555-0107', 'delivered',  'UPS',   '1ZTEST00000000007',  current_date - 30,         'Test City', array['Label created','In transit','Delivered'], 'Travel Backpack',     8900,  'unopened', 'initiated'),
  ('ORD-TEST-008', 'Avery Example',  'avery@example.test',  '+1-555-0108', 'delivered',  'FedEx', 'TESTFEDEX0000008',   current_date - 4,          'Test City', array['Label created','In transit','Delivered'], 'Bluetooth Speaker',   6400,  'opened',   'initiated')
on conflict (order_key) do update set
  status = excluded.status, delivery_date = excluded.delivery_date,
  item_condition = excluded.item_condition, return_status = excluded.return_status,
  cancel_date = null, cancel_reason = null, return_reason = null, return_initiated_at = null,
  refund_status = null, refund_amount = null, refund_date = null;
