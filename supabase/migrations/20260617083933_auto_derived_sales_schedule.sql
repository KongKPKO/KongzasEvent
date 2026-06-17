alter table public.events
  add column if not exists preorder_enabled boolean not null default false,
  add column if not exists postorder_enabled boolean not null default false,
  add column if not exists postorder_opens_at timestamptz,
  add column if not exists postorder_closes_at timestamptz,
  add column if not exists sales_status_override text not null default 'auto';

alter table public.events
  drop constraint if exists events_sales_status_override_check;

alter table public.events
  add constraint events_sales_status_override_check
  check (sales_status_override in ('auto', 'closed'));

alter table public.events
  drop constraint if exists events_preorder_window_check;

alter table public.events
  add constraint events_preorder_window_check
  check (
    preorder_opens_at is null
    or preorder_closes_at is null
    or preorder_opens_at < preorder_closes_at
  );

alter table public.events
  drop constraint if exists events_postorder_window_check;

alter table public.events
  add constraint events_postorder_window_check
  check (
    postorder_opens_at is null
    or postorder_closes_at is null
    or postorder_opens_at < postorder_closes_at
  );

update public.events
set
  preorder_enabled = true,
  sales_status_override = 'auto'
where coalesce(selling_mode, 'live') = 'preorder';

update public.events
set
  postorder_enabled = true,
  postorder_opens_at = coalesce(postorder_opens_at, preorder_opens_at),
  postorder_closes_at = coalesce(postorder_closes_at, preorder_closes_at),
  sales_status_override = 'auto'
where coalesce(selling_mode, 'live') = 'post_event';

update public.events
set sales_status_override = 'closed'
where coalesce(selling_mode, 'live') = 'closed';

create or replace function public.get_event_sales_phase(
  p_status text,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_preorder_enabled boolean,
  p_preorder_opens_at timestamptz,
  p_preorder_closes_at timestamptz,
  p_postorder_enabled boolean,
  p_postorder_opens_at timestamptz,
  p_postorder_closes_at timestamptz,
  p_sales_status_override text,
  p_now timestamptz default now()
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when coalesce(p_sales_status_override, 'auto') = 'closed'
      or lower(coalesce(p_status, '')) = 'cancelled'
      then 'closed'
    when lower(coalesce(p_status, '')) = 'confirmed'
      and p_start_date is not null
      and p_end_date is not null
      and p_start_date <= p_now
      and p_now < p_end_date
      then 'live'
    when lower(coalesce(p_status, '')) = 'confirmed'
      and coalesce(p_preorder_enabled, false)
      and (p_preorder_opens_at is null or p_preorder_opens_at <= p_now)
      and (p_preorder_closes_at is null or p_now < p_preorder_closes_at)
      then 'preorder'
    when lower(coalesce(p_status, '')) in ('confirmed', 'ended')
      and coalesce(p_postorder_enabled, false)
      and (p_postorder_opens_at is null or p_postorder_opens_at <= p_now)
      and (p_postorder_closes_at is null or p_now < p_postorder_closes_at)
      then 'post_event'
    else 'closed'
  end;
$$;

grant execute on function public.get_event_sales_phase(text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text, timestamptz) to anon, authenticated;

drop policy if exists "event_payment_methods_public_read" on public.event_payment_methods;
create policy "event_payment_methods_public_read"
  on public.event_payment_methods
  for select
  to anon, authenticated
  using (
    is_enabled = true
    and exists (
      select 1
      from public.events e
      join public.artists a on a.id = e.artist_id
      where e.id = event_payment_methods.event_id
        and e.artist_id = event_payment_methods.artist_id
        and public.get_event_sales_phase(
          e.status,
          e.start_date,
          e.end_date,
          coalesce(e.preorder_enabled, false) or coalesce(e.selling_mode, 'live') = 'preorder',
          e.preorder_opens_at,
          e.preorder_closes_at,
          coalesce(e.postorder_enabled, false) or coalesce(e.selling_mode, 'live') = 'post_event',
          coalesce(e.postorder_opens_at, case when coalesce(e.selling_mode, 'live') = 'post_event' then e.preorder_opens_at end),
          coalesce(e.postorder_closes_at, case when coalesce(e.selling_mode, 'live') = 'post_event' then e.preorder_closes_at end),
          coalesce(e.sales_status_override, 'auto')
        ) in ('preorder', 'post_event')
        and a.is_public = true
        and a.is_verified = true
        and a.published_at is not null
    )
  );

drop policy if exists events_public_read on public.events;
create policy events_public_read on public.events
  for select to anon, authenticated
  using (
    (
      exists (
        select 1 from public.artists a
        where a.id = events.artist_id
          and a.is_public = true
          and a.is_verified = true
          and a.published_at is not null
      )
      and (
        public.get_event_sales_phase(
          status,
          start_date,
          end_date,
          coalesce(preorder_enabled, false) or coalesce(selling_mode, 'live') = 'preorder',
          preorder_opens_at,
          preorder_closes_at,
          coalesce(postorder_enabled, false) or coalesce(selling_mode, 'live') = 'post_event',
          coalesce(postorder_opens_at, case when coalesce(selling_mode, 'live') = 'post_event' then preorder_opens_at end),
          coalesce(postorder_closes_at, case when coalesce(selling_mode, 'live') = 'post_event' then preorder_closes_at end),
          coalesce(sales_status_override, 'auto')
        ) in ('live', 'preorder', 'post_event')
        or (status = 'Cancelled' and end_date >= now())
      )
    )
    or has_artist_role(artist_id, array['owner'::text, 'manager'::text, 'seller'::text, 'queue_staff'::text])
    or is_platform_admin()
  );

create or replace function public.create_preorder_with_stock(
  p_event_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_contact text default '',
  p_customer_note text default '',
  p_client_request_id uuid default null,
  p_customer_phone text default '',
  p_customer_social text default '',
  p_customer_email text default '',
  p_shipping_address text default ''
)
returns table (
  order_id uuid,
  pickup_code text,
  total_price numeric,
  currency text,
  pickup_instructions text,
  payment_status text,
  payment_methods jsonb,
  payment_deadline_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_existing_order record;
  v_existing_payment record;
  v_item jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_pickup_code text;
  v_product record;
  v_qty integer;
  v_total numeric := 0;
  v_currency text;
  v_effective_currency text;
  v_has_catalog boolean := false;
  v_payment_methods jsonb;
  v_payment_deadline timestamptz;
  v_contact_display text;
  v_sales_phase text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_items';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'customer_name_required';
  end if;

  if length(trim(coalesce(p_customer_email, ''))) = 0 then
    raise exception 'customer_email_required';
  end if;

  if lower(trim(coalesce(p_customer_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'customer_email_invalid';
  end if;

  if length(trim(coalesce(p_customer_phone, ''))) = 0
     and length(trim(coalesce(p_customer_social, ''))) = 0
     and length(trim(coalesce(p_customer_email, ''))) = 0
     and length(trim(coalesce(p_customer_contact, ''))) = 0 then
    raise exception 'customer_contact_required';
  end if;

  select e.*, a.is_public, a.is_verified
  into v_event
  from public.events e
  join public.artists a on a.id = e.artist_id
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event_not_found';
  end if;

  v_sales_phase := public.get_event_sales_phase(
    v_event.status,
    v_event.start_date,
    v_event.end_date,
    coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder',
    v_event.preorder_opens_at,
    v_event.preorder_closes_at,
    coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event',
    coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end),
    coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end),
    coalesce(v_event.sales_status_override, 'auto')
  );

  if coalesce(v_event.is_public, false) is not true or coalesce(v_event.is_verified, false) is not true then
    raise exception 'artist_not_public';
  end if;

  if v_sales_phase not in ('preorder', 'post_event') then
    if coalesce(v_event.sales_status_override, 'auto') = 'closed' then
      raise exception 'preorder_not_open';
    end if;
    if (coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder')
       and v_event.preorder_opens_at is not null
       and now() < v_event.preorder_opens_at then
      raise exception 'preorder_not_open_yet';
    end if;
    if (coalesce(v_event.preorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'preorder')
       and v_event.preorder_closes_at is not null
       and now() >= v_event.preorder_closes_at then
      raise exception 'preorder_closed';
    end if;
    if (coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event')
       and coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end) is not null
       and now() < coalesce(v_event.postorder_opens_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_opens_at end) then
      raise exception 'preorder_not_open_yet';
    end if;
    if (coalesce(v_event.postorder_enabled, false) or coalesce(v_event.selling_mode, 'live') = 'post_event')
       and coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end) is not null
       and now() >= coalesce(v_event.postorder_closes_at, case when coalesce(v_event.selling_mode, 'live') = 'post_event' then v_event.preorder_closes_at end) then
      raise exception 'preorder_closed';
    end if;
    if v_event.end_date < now() then
      raise exception 'event_ended';
    end if;
    raise exception 'preorder_not_open';
  end if;

  if v_sales_phase = 'post_event' then
    if length(trim(coalesce(p_customer_phone, ''))) = 0 then
      raise exception 'customer_phone_required';
    end if;

    if length(trim(coalesce(p_shipping_address, ''))) = 0 then
      raise exception 'shipping_address_required';
    end if;
  end if;

  if p_client_request_id is not null then
    select o.*
    into v_existing_order
    from public.orders o
    where o.payment_idempotency_key = p_client_request_id
    for update;

    if v_existing_order.id is not null then
      if v_existing_order.event_id = p_event_id and v_existing_order.order_type in ('preorder', 'post_event') then
        select op.* into v_existing_payment from public.order_payments op where op.order_id = v_existing_order.id;
        select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
               min(epm.payment_deadline_at)
        into v_payment_methods, v_payment_deadline
        from public.event_payment_methods epm
        where epm.event_id = p_event_id
          and epm.is_enabled = true;

        return query
        select
          v_existing_order.id,
          v_existing_order.pickup_code,
          v_existing_order.total_price,
          v_existing_order.currency,
          coalesce(v_event.preorder_pickup_instructions, ''),
          coalesce(v_existing_payment.payment_status, 'awaiting_payment'),
          coalesce(v_payment_methods, '[]'::jsonb),
          v_payment_deadline;
        return;
      end if;
      raise exception 'client_request_id_conflict';
    end if;
  end if;

  select exists (select 1 from public.event_products ep where ep.event_id = p_event_id)
  into v_has_catalog;

  v_pickup_code := public.generate_pickup_code(p_event_id);
  v_contact_display := nullif(trim(coalesce(p_customer_contact, '')), '');
  if v_contact_display is null then
    v_contact_display := concat_ws(' · ',
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_social, '')), ''),
      nullif(trim(coalesce(p_customer_email, '')), '')
    );
  end if;

  insert into public.orders (
    event_id,
    queue_id,
    status,
    total_price,
    subtotal_price,
    currency,
    payment_method,
    payment_idempotency_key,
    order_type,
    pickup_code,
    customer_name,
    customer_contact,
    customer_phone,
    customer_social,
    customer_email,
    customer_note,
    shipping_address,
    pickup_status
  )
  values (
    p_event_id,
    null,
    'draft',
    0,
    0,
    coalesce(v_event.currency_override, 'THB'),
    null,
    p_client_request_id,
    v_sales_phase,
    v_pickup_code,
    trim(p_customer_name),
    v_contact_display,
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_social, '')), ''),
    lower(trim(p_customer_email)),
    nullif(trim(coalesce(p_customer_note, '')), ''),
    nullif(trim(coalesce(p_shipping_address, '')), ''),
    'not_required'
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));

    select
      p.*,
      ep.id as event_product_id,
      coalesce(ep.price_override, p.price) as effective_price,
      case when ep.id is not null then ep.is_unlimited else p.is_unlimited end as effective_is_unlimited,
      case when ep.id is not null then ep.stock_total else p.stock_total end as effective_stock_total,
      case when ep.id is not null then ep.stock_reserved else p.stock_reserved end as effective_stock_reserved,
      case when ep.id is not null then ep.stock_sold else p.stock_sold end as effective_stock_sold
    into v_product
    from public.products p
    left join public.event_products ep
      on ep.product_id = p.id
     and ep.event_id = p_event_id
    where p.id = (v_item ->> 'product_id')::uuid
      and p.artist_id = v_event.artist_id
      and p.deleted_at is null
      and p.status = 'enable'
      and (not v_has_catalog or (ep.id is not null and ep.is_enabled = true))
    for update of p;

    if v_product.id is null then
      raise exception 'invalid_product';
    end if;

    v_effective_currency := coalesce(v_event.currency_override, v_product.currency, 'THB');

    if v_currency is null then
      v_currency := v_effective_currency;
    elsif v_currency <> v_effective_currency then
      raise exception 'mixed_currency_not_allowed';
    end if;

    insert into public.order_items (order_id, product_id, event_product_id, quantity, price_per_unit, notes, currency)
    values (
      v_order_id,
      v_product.id,
      v_product.event_product_id,
      v_qty,
      v_product.effective_price,
      coalesce(v_item ->> 'notes', ''),
      v_effective_currency
    );

    v_total := v_total + (v_product.effective_price * v_qty);
  end loop;

  update public.orders
  set total_price = v_total,
      subtotal_price = v_total,
      currency = coalesce(v_currency, 'THB')
  where id = v_order_id;

  insert into public.order_payments (
    order_id,
    event_id,
    artist_id,
    payment_status,
    amount_expected,
    currency
  )
  values (
    v_order_id,
    p_event_id,
    v_event.artist_id,
    'awaiting_payment',
    v_total,
    coalesce(v_currency, 'THB')
  )
  returning id into v_payment_id;

  perform public.append_payment_review_event(
    v_order_id,
    v_payment_id,
    p_event_id,
    v_event.artist_id,
    'created',
    null,
    'awaiting_payment'
  );

  select coalesce(jsonb_agg(to_jsonb(epm) - 'artist_id' - 'created_at' - 'updated_at'), '[]'::jsonb),
         min(epm.payment_deadline_at)
  into v_payment_methods, v_payment_deadline
  from public.event_payment_methods epm
  where epm.event_id = p_event_id
    and epm.is_enabled = true;

  return query
  select
    v_order_id,
    v_pickup_code,
    v_total,
    coalesce(v_currency, 'THB'),
    coalesce(v_event.preorder_pickup_instructions, ''),
    'awaiting_payment'::text,
    coalesce(v_payment_methods, '[]'::jsonb),
    v_payment_deadline;
exception
  when unique_violation then
    raise exception 'preorder_unique_conflict';
end;
$$;

grant execute on function public.create_preorder_with_stock(uuid, jsonb, text, text, text, uuid, text, text, text, text) to anon, authenticated;
