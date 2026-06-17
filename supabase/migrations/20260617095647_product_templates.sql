create table if not exists public.product_templates (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  price numeric not null default 0,
  currency text not null default 'THB',
  tags text[] not null default '{}'::text[],
  description text not null default '',
  is_unlimited boolean not null default true,
  stock_total integer,
  status text not null default 'active',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_templates_price_non_negative check (price >= 0),
  constraint product_templates_stock_non_negative check (stock_total is null or stock_total >= 0),
  constraint product_templates_status_check check (status in ('active', 'archived'))
);

create table if not exists public.product_template_variants (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  variant_name text not null,
  variant_sort_order integer not null default 0,
  tags text[] not null default '{}'::text[],
  price_override numeric,
  image_url text not null default '',
  status text not null default 'enable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_template_variants_price_non_negative check (price_override is null or price_override >= 0),
  constraint product_template_variants_status_check check (status in ('enable', 'disable', 'soldout'))
);

alter table public.products
  add column if not exists product_template_id uuid references public.product_templates(id) on delete set null,
  add column if not exists product_template_variant_id uuid references public.product_template_variants(id) on delete set null;

create index if not exists idx_product_templates_artist_status
  on public.product_templates (artist_id, status, created_at desc);

create index if not exists idx_product_template_variants_template_sort
  on public.product_template_variants (template_id, variant_sort_order, variant_name);

create index if not exists idx_products_template_variant
  on public.products (artist_id, product_template_variant_id)
  where product_template_variant_id is not null and deleted_at is null;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_product_templates_updated_at') then
    create trigger trg_product_templates_updated_at
      before update on public.product_templates
      for each row
      execute function public.update_updated_at_column();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_product_template_variants_updated_at') then
    create trigger trg_product_template_variants_updated_at
      before update on public.product_template_variants
      for each row
      execute function public.update_updated_at_column();
  end if;
end $$;

alter table public.product_templates enable row level security;
alter table public.product_template_variants enable row level security;

drop policy if exists "product_templates_owner_manage" on public.product_templates;
create policy "product_templates_owner_manage"
  on public.product_templates
  for all
  to authenticated
  using (public.has_artist_role(artist_id, array['owner', 'manager']))
  with check (public.has_artist_role(artist_id, array['owner', 'manager']));

drop policy if exists "product_template_variants_owner_manage" on public.product_template_variants;
create policy "product_template_variants_owner_manage"
  on public.product_template_variants
  for all
  to authenticated
  using (
    public.has_artist_role(artist_id, array['owner', 'manager'])
    and exists (
      select 1
      from public.product_templates pt
      where pt.id = product_template_variants.template_id
        and pt.artist_id = product_template_variants.artist_id
    )
  )
  with check (
    public.has_artist_role(artist_id, array['owner', 'manager'])
    and exists (
      select 1
      from public.product_templates pt
      where pt.id = product_template_variants.template_id
        and pt.artist_id = product_template_variants.artist_id
    )
  );

grant select, insert, update, delete on public.product_templates to authenticated;
grant select, insert, update, delete on public.product_template_variants to authenticated;

create or replace function public.create_products_from_template(
  p_template_id uuid,
  p_variant_ids uuid[] default null,
  p_event_id uuid default null,
  p_default_event_stock integer default null
)
returns table (
  product_id uuid,
  variant_id uuid,
  created_product boolean,
  event_product_id uuid,
  created_event_product boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.product_templates%rowtype;
  v_variant public.product_template_variants%rowtype;
  v_event record;
  v_product_id uuid;
  v_existing_event_product_id uuid;
  v_created_product boolean;
  v_tags text[];
  v_event_stock integer;
begin
  select *
  into v_template
  from public.product_templates
  where id = p_template_id
    and status = 'active';

  if v_template.id is null then
    raise exception 'template_not_found';
  end if;

  if not public.has_artist_role(v_template.artist_id, array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;

  if p_event_id is not null then
    select *
    into v_event
    from public.events
    where id = p_event_id
      and artist_id = v_template.artist_id;

    if v_event.id is null then
      raise exception 'event_not_found';
    end if;

    if not public.has_artist_role(v_template.artist_id, array['owner', 'manager']) then
      raise exception 'forbidden';
    end if;
  end if;

  for v_variant in
    select *
    from public.product_template_variants
    where template_id = v_template.id
      and artist_id = v_template.artist_id
      and (p_variant_ids is null or id = any(p_variant_ids))
    order by variant_sort_order, variant_name
  loop
    select p.id
    into v_product_id
    from public.products p
    where p.artist_id = v_template.artist_id
      and p.product_template_variant_id = v_variant.id
      and p.deleted_at is null
    limit 1;

    v_created_product := false;

    if v_product_id is null then
      select coalesce(array_agg(distinct nullif(btrim(tag), '')), '{}'::text[])
      into v_tags
      from unnest(coalesce(v_template.tags, '{}'::text[]) || coalesce(v_variant.tags, '{}'::text[])) as tag
      where nullif(btrim(tag), '') is not null;

      insert into public.products (
        artist_id,
        name,
        price,
        description,
        category,
        image_url,
        status,
        currency,
        tags,
        is_unlimited,
        stock_total,
        variant_group_name,
        variant_name,
        variant_sort_order,
        product_template_id,
        product_template_variant_id
      )
      values (
        v_template.artist_id,
        v_template.name,
        coalesce(v_variant.price_override, v_template.price),
        v_template.description,
        v_template.category,
        coalesce(nullif(v_variant.image_url, ''), v_template.image_url, ''),
        v_variant.status,
        v_template.currency,
        v_tags,
        v_template.is_unlimited,
        case when v_template.is_unlimited then null else coalesce(v_template.stock_total, 0) end,
        v_template.name,
        v_variant.variant_name,
        v_variant.variant_sort_order,
        v_template.id,
        v_variant.id
      )
      returning id into v_product_id;

      v_created_product := true;
    end if;

    event_product_id := null;
    created_event_product := false;

    if p_event_id is not null then
      select ep.id
      into v_existing_event_product_id
      from public.event_products ep
      where ep.event_id = p_event_id
        and ep.product_id = v_product_id;

      if v_existing_event_product_id is null then
        v_event_stock := case
          when v_template.is_unlimited then null
          else coalesce(p_default_event_stock, v_template.stock_total, 0)
        end;

        insert into public.event_products (
          event_id,
          product_id,
          artist_id,
          is_enabled,
          price_override,
          is_unlimited,
          stock_total
        )
        values (
          p_event_id,
          v_product_id,
          v_template.artist_id,
          true,
          null,
          v_template.is_unlimited,
          v_event_stock
        )
        returning id into event_product_id;

        created_event_product := true;
      else
        update public.event_products
        set is_enabled = true,
            updated_at = now()
        where id = v_existing_event_product_id
        returning id into event_product_id;
      end if;
    end if;

    product_id := v_product_id;
    variant_id := v_variant.id;
    created_product := v_created_product;
    return next;
  end loop;
end;
$$;

revoke execute on function public.create_products_from_template(uuid, uuid[], uuid, integer) from public, anon;
grant execute on function public.create_products_from_template(uuid, uuid[], uuid, integer) to authenticated;
