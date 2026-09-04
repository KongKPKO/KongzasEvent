-- Recompact generated rows that were rewritten before variant-aware item codes existed.

create temporary table _variant_aware_product_skus on commit drop as
select
  p.id,
  p.artist_id,
  p.created_at,
  public.product_sku_type_code(p.category, p.name)
    || '-' || public.product_sku_item_code(p.name, p.variant_name) as sku_base,
  coalesce((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer, 0) as old_sequence
from public.products p
where p.deleted_at is null
  and p.sku_is_generated;

alter table public.products disable trigger trg_products_generate_sku;

update public.products p
set sku = 'MIG-' || replace(p.id::text, '-', '')
from _variant_aware_product_skus s
where p.id = s.id;

do $$
declare
  v_product record;
  v_sequence integer;
  v_candidate text;
begin
  for v_product in
    select *
    from _variant_aware_product_skus
    order by artist_id, created_at, id
  loop
    v_sequence := v_product.old_sequence;
    if v_sequence <= 0 then
      select greatest(
        coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0),
        coalesce((
          select max(s.old_sequence)
          from _variant_aware_product_skus s
          where s.artist_id = v_product.artist_id
        ), 0)
      ) + 1
      into v_sequence
      from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null
        and p.sku ~ '-[0-9]{1,9}$';
    end if;

    v_candidate := v_product.sku_base || '-' || lpad(v_sequence::text, 3, '0');
    while exists (
      select 1
      from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null
        and lower(p.sku) = lower(v_candidate)
        and p.id <> v_product.id
    ) loop
      select greatest(
        coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0),
        coalesce((
          select max(s.old_sequence)
          from _variant_aware_product_skus s
          where s.artist_id = v_product.artist_id
        ), 0)
      ) + 1
      into v_sequence
      from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null
        and p.sku ~ '-[0-9]{1,9}$';
      v_candidate := v_product.sku_base || '-' || lpad(v_sequence::text, 3, '0');
    end loop;

    update public.products
    set sku = v_candidate
    where id = v_product.id;
  end loop;
end;
$$;

alter table public.products enable trigger trg_products_generate_sku;

do $$
begin
  if exists (
    select 1
    from _variant_aware_product_skus s
    join public.products p on p.id = s.id
    where not p.sku_is_generated
      or p.sku !~ ('^' || s.sku_base || '-[0-9]+$')
  ) then
    raise exception 'generated_product_sku_recompact_failed';
  end if;
end;
$$;
