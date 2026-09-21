begin;
create table public.catalog_stock_movements (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  actor_id uuid,
  created_at timestamptz not null default now(),
  quantity_before integer,
  quantity_after integer,
  kind text not null,
  reason text not null,
  request_id uuid,
  unique (product_id, request_id)
);
alter table public.catalog_stock_movements enable row level security;
create policy catalog_stock_movements_management_read on public.catalog_stock_movements
for select to authenticated using (public.has_artist_role(artist_id, array['owner','manager']));
revoke all on public.catalog_stock_movements from public, anon, authenticated;
grant select on public.catalog_stock_movements to authenticated;

create function public.audit_catalog_stock_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.stock_total is distinct from new.stock_total or old.is_unlimited is distinct from new.is_unlimited then
    insert into public.catalog_stock_movements
      (artist_id, product_id, actor_id, quantity_before, quantity_after, kind, reason, request_id)
    values (new.artist_id, new.id, auth.uid(), old.stock_total, new.stock_total,
      coalesce(nullif(current_setting('nireq.stock_kind', true), ''), 'catalog_edit'),
      coalesce(nullif(current_setting('nireq.stock_reason', true), ''), 'catalog_edit'),
      nullif(current_setting('nireq.stock_request', true), '')::uuid);
  end if;
  return new;
end;
$$;
create trigger audit_catalog_stock_change after update of stock_total, is_unlimited on public.products
for each row execute function public.audit_catalog_stock_change();
revoke all on function public.audit_catalog_stock_change() from public, anon, authenticated;

create function public.adjust_catalog_stock(
  p_product_id uuid, p_quantity integer, p_kind text, p_reason text, p_request_id uuid
)
returns table(product_id uuid, on_hand integer, allocated integer, available integer)
language plpgsql security definer set search_path = public as $$
declare
  v_product public.products%rowtype;
  v_previous public.catalog_stock_movements%rowtype;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null then raise exception 'stock_request_required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'invalid_stock_quantity'; end if;
  if p_kind is null or p_kind not in ('receive', 'increase', 'decrease') then raise exception 'invalid_stock_kind'; end if;
  v_reason := case when p_kind = 'receive' then 'received' else nullif(trim(p_reason), '') end;
  if v_reason is null then raise exception 'stock_removal_reason_required'; end if;
  if length(v_reason) > 500 then raise exception 'stock_reason_too_long'; end if;
  select * into v_product from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product_not_found'; end if;
  if not public.has_artist_role(v_product.artist_id, array['owner','manager']) then raise exception 'forbidden'; end if;
  select * into v_previous from public.catalog_stock_movements m
    where m.product_id = p_product_id and m.request_id = p_request_id;
  if found then
    if v_previous.actor_id is distinct from auth.uid() or v_previous.kind <> p_kind or v_previous.reason <> v_reason
      or abs(coalesce(v_previous.quantity_after, 0) - coalesce(v_previous.quantity_before, 0)) <> p_quantity then
      raise exception 'stock_request_conflict';
    end if;
    return query select s.* from public.list_product_stock_summaries(v_product.artist_id) s where s.product_id = p_product_id;
    return;
  end if;
  perform set_config('nireq.stock_kind', p_kind, true);
  perform set_config('nireq.stock_reason', v_reason, true);
  perform set_config('nireq.stock_request', p_request_id::text, true);
  if p_kind = 'decrease' then
    return query select * from public.remove_catalog_stock(p_product_id, p_quantity, v_reason);
  else
    return query select * from public.add_catalog_stock(p_product_id, p_quantity, v_reason);
  end if;
  perform set_config('nireq.stock_kind', '', true);
  perform set_config('nireq.stock_reason', '', true);
  perform set_config('nireq.stock_request', '', true);
end;
$$;
revoke all on function public.adjust_catalog_stock(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.adjust_catalog_stock(uuid, integer, text, text, uuid) to authenticated;
commit;
