begin;
alter table public.product_parents add column gift_only boolean not null default false;
alter table public.products add column gift_only boolean not null default false;

create or replace function public.save_product_family(p_parent_id uuid, p_parent jsonb, p_variants jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid; gift boolean;
begin
 if exists(select 1 from public.products where parent_product_id=p_parent_id and private.is_component_bundle(id)) then raise exception 'use_bundle_editor'; end if;
 if coalesce(p_parent->>'product_kind','single') in ('preorder','service') then p_parent:=p_parent||jsonb_build_object('product_kind','single'); end if;
 gift := coalesce((p_parent->>'gift_only')::boolean, (select gift_only from public.product_parents where id=p_parent_id), false);
 if gift and exists(select 1 from private.bundle_components c join public.products p on p.id=c.product_id where p.parent_product_id=p_parent_id) then raise exception 'gift_only_product_used_in_bundle'; end if;
 result := private.save_product_family_legacy(p_parent_id,p_parent,p_variants);
 update public.product_parents set gift_only=gift where id=result;
 update public.products set gift_only=gift where parent_product_id=result;
 return result;
end $$;

create function private.guard_gift_only_order_item() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.line_type,'purchase') <> 'promotion_reward' and exists(select 1 from public.products p where p.id=new.product_id and p.gift_only) then
   raise exception 'gift_only_product_not_sellable';
 end if;
 return new;
end $$;
revoke all on function private.guard_gift_only_order_item() from public,anon,authenticated;
create trigger guard_gift_only_order_item before insert or update of product_id,line_type on public.order_items for each row execute function private.guard_gift_only_order_item();

create function private.guard_gift_only_bundle_component() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.products where id=new.product_id and gift_only) then raise exception 'gift_only_product_used_in_bundle'; end if;
 return new;
end $$;
revoke all on function private.guard_gift_only_bundle_component() from public,anon,authenticated;
create trigger guard_gift_only_bundle_component before insert or update of product_id on private.bundle_components for each row execute function private.guard_gift_only_bundle_component();

-- Keep gifts allocated and eligible for promotions but exclude them from the
-- ordinary customer/POS catalog and from purchase quote normalization.
do $patch$
declare definition text; updated text; sig text;
begin
 definition:=pg_get_functiondef('public.list_event_products(uuid)'::regprocedure);
 updated:=replace(definition,'and p.deleted_at is null','and p.deleted_at is null and not p.gift_only');
 if updated=definition then raise exception 'gift_only_event_catalog_patch_missing'; end if;
 execute updated;
 definition:=pg_get_functiondef('public.get_public_online_campaign(text,text)'::regprocedure);
 updated:=replace(definition,'and cp.is_enabled = true','and cp.is_enabled = true and cp.is_sellable = true and not p.gift_only');
 if updated=definition then raise exception 'gift_only_campaign_catalog_patch_missing'; end if;
 execute updated;
 foreach sig in array array['private.normalize_sale_bundle_items(uuid,text,uuid,jsonb)','private.normalize_sale_bundle_items_preview(uuid,text,uuid,jsonb)'] loop
   definition:=pg_get_functiondef(sig::regprocedure);
   updated:=replace(definition,$old$and ep.is_enabled and ep.is_sellable and p.status='enable'$old$, $new$and ep.is_enabled and ep.is_sellable and not p.gift_only and p.status='enable'$new$);
   updated:=replace(updated,$old$and cp.is_enabled and cp.is_sellable and p.status='enable'$old$, $new$and cp.is_enabled and cp.is_sellable and not p.gift_only and p.status='enable'$new$);
   if updated=definition then raise exception 'gift_only_quote_patch_missing: %',sig; end if;
   execute updated;
 end loop;
end $patch$;
commit;
