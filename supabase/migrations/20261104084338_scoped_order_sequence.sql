alter table public.orders add column order_sequence bigint;
grant select (order_sequence) on public.orders to authenticated;

with numbered as (
  select id, row_number() over (partition by case when campaign_id is not null then 'campaign:' || campaign_id::text else 'event:' || event_id::text end order by created_at, id) as n
  from public.orders where campaign_id is not null or event_id is not null
)
update public.orders o set order_sequence = numbered.n from numbered where numbered.id = o.id;

create unique index orders_campaign_sequence_unique on public.orders (campaign_id, order_sequence) where campaign_id is not null;
create unique index orders_event_sequence_unique on public.orders (event_id, order_sequence) where campaign_id is null and event_id is not null;

create table private.order_sequence_counters (scope_key text primary key, last_sequence bigint not null);
revoke all on private.order_sequence_counters from public, anon, authenticated;
insert into private.order_sequence_counters(scope_key, last_sequence)
select case when campaign_id is not null then 'campaign:' || campaign_id::text else 'event:' || event_id::text end, max(order_sequence)
from public.orders where order_sequence is not null group by 1;

create function private.assign_scoped_order_sequence() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scope_key text;
begin
  if tg_op = 'UPDATE' then
    if new.order_sequence is distinct from old.order_sequence or new.event_id is distinct from old.event_id or new.campaign_id is distinct from old.campaign_id then
      raise exception 'order_scope_immutable';
    end if;
    return new;
  end if;
  v_scope_key := case when new.campaign_id is not null then 'campaign:' || new.campaign_id::text when new.event_id is not null then 'event:' || new.event_id::text else null end;
  if v_scope_key is null then new.order_sequence := null; return new; end if;
  insert into private.order_sequence_counters as counters(scope_key, last_sequence) values (v_scope_key, 1)
  on conflict on constraint order_sequence_counters_pkey do update set last_sequence = counters.last_sequence + 1
  returning last_sequence into new.order_sequence;
  return new;
end $$;
revoke all on function private.assign_scoped_order_sequence() from public, anon, authenticated;
create trigger orders_assign_sequence before insert or update of order_sequence, event_id, campaign_id on public.orders
for each row execute function private.assign_scoped_order_sequence();

create function public.get_order_sequences(p_order_ids uuid[]) returns table(order_id uuid, order_sequence bigint)
language sql stable security definer set search_path = '' as $$
  select o.id, o.order_sequence from public.orders o
  left join public.online_campaigns c on c.id = o.campaign_id
  where o.id = any(p_order_ids) and auth.uid() is not null and (
    (o.campaign_id is not null and public.has_artist_role(c.artist_id, array['owner','manager','seller']))
    or (o.campaign_id is null and o.event_id is not null and public.has_event_role(o.event_id, array['owner','manager','seller']))
  )
$$;
revoke all on function public.get_order_sequences(uuid[]) from public, anon;
grant execute on function public.get_order_sequences(uuid[]) to authenticated;
