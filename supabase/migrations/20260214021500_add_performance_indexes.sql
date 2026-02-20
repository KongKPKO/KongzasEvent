-- Query performance indexes for dashboard/customer read paths.

create index if not exists idx_events_artist_status_time
  on public.events (artist_id, status, start_date desc, end_date desc);

create index if not exists idx_events_artist_end_date
  on public.events (artist_id, end_date desc);

create index if not exists idx_queues_event_status_number
  on public.queues (event_id, status, queue_number);

create index if not exists idx_queues_artist_event_status_updated
  on public.queues (artist_id, event_id, status, last_updated_at desc);

create index if not exists idx_products_artist_deleted_status_created
  on public.products (artist_id, deleted_at, status, created_at desc);

create index if not exists idx_orders_event_queue_status_created
  on public.orders (event_id, queue_id, status, created_at desc);

create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

create index if not exists idx_artist_members_email_status_updated
  on public.artist_members (lower(member_email), status, updated_at desc);
