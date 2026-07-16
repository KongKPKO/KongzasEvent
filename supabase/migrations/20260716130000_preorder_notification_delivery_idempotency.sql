create table if not exists public.preorder_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  delivery_key text not null,
  notification_event text not null check (notification_event in ('submitted', 'confirmed', 'rejected')),
  status text not null check (status in ('sending', 'delivered', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, delivery_key)
);

alter table public.preorder_notification_deliveries enable row level security;

revoke all on table public.preorder_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.preorder_notification_deliveries to service_role;

comment on table public.preorder_notification_deliveries is
  'Server-only idempotency ledger for preorder and post-order customer emails.';
