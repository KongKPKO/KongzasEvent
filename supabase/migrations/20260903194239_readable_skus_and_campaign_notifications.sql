-- Make generated product SKUs useful during catalog and fulfillment work while
-- keeping seller-provided SKUs and historical order snapshots unchanged.

create or replace function public.product_sku_type_code(
  p_category text,
  p_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ 'hair[ -]?clip' then 'HCL'
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ 'cheki' then 'CHE'
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ '(^|[^a-z])fs([^a-z]|$)|photo[ -]?set' then 'FS'
    else coalesce(
      nullif(left(regexp_replace(upper(coalesce(p_category, '')), '[^A-Z0-9]', '', 'g'), 3), ''),
      'PRD'
    )
  end;
$$;

create or replace function public.product_sku_item_code(
  p_name text,
  p_variant_name text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_source text := upper(coalesce(nullif(trim(p_variant_name), ''), trim(p_name), 'ITEM'));
  v_has_meaningful boolean;
  v_result text;
begin
  select exists (
    select 1
    from regexp_split_to_table(regexp_replace(v_source, '[^A-Z0-9]+', ' ', 'g'), ' +') token
    where token <> ''
      and token not in ('CHEKI', 'HAIRCLIP', 'HAIR', 'CLIP', 'PHOTO', 'SET', 'FS')
      and (length(token) > 3 or token ~ '[0-9]')
  ) into v_has_meaningful;

  select string_agg(token, '-' order by ordinal)
  into v_result
  from regexp_split_to_table(regexp_replace(v_source, '[^A-Z0-9]+', ' ', 'g'), ' +') with ordinality parts(token, ordinal)
  where token <> ''
    and token not in ('CHEKI', 'HAIRCLIP', 'HAIR', 'CLIP', 'PHOTO', 'SET', 'FS')
    and (not v_has_meaningful or length(token) > 3 or token ~ '[0-9]');

  return left(coalesce(nullif(v_result, ''), 'ITEM'), 24);
end;
$$;

create or replace function public.generate_product_sku()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sequence integer;
begin
  if nullif(trim(coalesce(new.sku, '')), '') is not null then
    new.sku := upper(trim(new.sku));
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.artist_id::text, 0));

  select coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0) + 1
  into v_sequence
  from public.products p
  where p.artist_id = new.artist_id
    and p.deleted_at is null
    and p.sku ~ '-[0-9]+$';

  new.sku := public.product_sku_type_code(new.category, new.name)
    || '-' || public.product_sku_item_code(new.name, new.variant_name)
    || '-' || lpad(v_sequence::text, 3, '0');
  return new;
end;
$$;

do $$
declare
  v_product record;
begin
  for v_product in
    select id
    from public.products
    where deleted_at is null
      and sku ~* '^NQ-[A-Z0-9]+$'
    order by artist_id, created_at, id
  loop
    update public.products set sku = null where id = v_product.id;
  end loop;
end;
$$;

comment on function public.generate_product_sku() is
  'Creates an editable readable TYPE-ITEM-SEQUENCE SKU only when the seller leaves SKU blank.';

-- Reuse the server-only delivery ledger for online campaign emails.
alter table public.preorder_notification_deliveries
  drop constraint if exists preorder_notification_deliveries_notification_event_check;

alter table public.preorder_notification_deliveries
  add constraint preorder_notification_deliveries_notification_event_check
  check (notification_event in (
    'submitted', 'confirmed', 'rejected',
    'created', 'ready_for_pickup', 'shipped', 'payment_rejected', 'refund_required'
  ));

comment on table public.preorder_notification_deliveries is
  'Server-only idempotency ledger for preorder, post-order, and online campaign customer emails.';

