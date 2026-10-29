create table private.order_lookup_limits (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null
);
alter table private.order_lookup_limits enable row level security;
revoke all on private.order_lookup_limits from public,anon,authenticated;

create function private.check_order_lookup_limit(p_artist_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_attempts integer;
begin
  if p_artist_id is null then return; end if;
  insert into private.order_lookup_limits as limits values(p_artist_id,clock_timestamp(),1)
  on conflict(artist_id) do update set
    attempts=case when limits.window_started_at < clock_timestamp()-interval '1 minute' then 1 else limits.attempts+1 end,
    window_started_at=case when limits.window_started_at < clock_timestamp()-interval '1 minute' then clock_timestamp() else limits.window_started_at end
  returning attempts into v_attempts;
  if v_attempts > 3000 then raise exception 'order_lookup_rate_limited'; end if;
end $$;
revoke all on function private.check_order_lookup_limit(uuid) from public,anon,authenticated;

do $$
declare v_signature text; v_definition text; v_guard text;
begin
  foreach v_signature in array array['public.get_public_preorder_by_code(text,text)','public.get_public_online_order_by_code(text,text)','public.get_public_order_receipt(uuid,text)'] loop
    v_definition:=pg_get_functiondef(v_signature::regprocedure);
    v_guard:=case when v_signature='public.get_public_order_receipt(uuid,text)' then
      'perform private.check_order_lookup_limit((select e.artist_id from public.orders o join public.events e on e.id=o.event_id where o.id=p_order_id));'
    else
      'perform private.check_order_lookup_limit((select a.id from public.artists a where a.slug=lower(trim(p_artist_slug))));'
    end;
    if v_definition !~* '\mbegin\M' then raise exception 'lookup guard target missing'; end if;
    execute regexp_replace(v_definition,'\mbegin\M','begin '||v_guard,'i');
  end loop;
end $$;
