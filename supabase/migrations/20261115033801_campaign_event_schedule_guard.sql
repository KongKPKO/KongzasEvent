-- Evaluate the stored window after the row lock is acquired, not at request start.
create or replace function private.guard_campaign_schedule_update()
returns trigger language plpgsql set search_path = '' as $$
declare v_now timestamptz;
begin
  if new.opens_at is not distinct from old.opens_at and new.closes_at is not distinct from old.closes_at then
    return new;
  end if;
  -- Allocation writers also lock catalog products before calculating availability.
  perform p.id from public.products p join public.online_campaign_products cp on cp.product_id = p.id
    where cp.campaign_id = old.id order by p.id for update of p;
  v_now := clock_timestamp();
  if old.publication_status in ('cancelled', 'archived') or old.closes_at <= v_now then
    raise exception 'campaign_schedule_ended';
  end if;
  if new.opens_at >= new.closes_at or new.closes_at <= v_now then
    raise exception 'campaign_schedule_invalid';
  end if;
  if old.opens_at <= v_now and new.opens_at is distinct from old.opens_at then
    raise exception 'campaign_schedule_already_started';
  end if;
  return new;
end $$;

create trigger guard_campaign_schedule_update
before update of opens_at, closes_at on public.online_campaigns
for each row execute function private.guard_campaign_schedule_update();

create or replace function private.guard_event_schedule_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_now timestamptz;
  v_event_changed boolean := (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date);
  v_pre_changed boolean := (new.preorder_enabled, new.preorder_opens_at, new.preorder_closes_at) is distinct from (old.preorder_enabled, old.preorder_opens_at, old.preorder_closes_at);
  v_post_changed boolean := (new.postorder_enabled, new.postorder_opens_at, new.postorder_closes_at) is distinct from (old.postorder_enabled, old.postorder_opens_at, old.postorder_closes_at);
begin
  if not (v_event_changed or v_pre_changed or v_post_changed) then return new; end if;
  perform p.id from public.products p join public.event_products ep on ep.product_id = p.id
    where ep.event_id = old.id order by p.id for update of p;
  v_now := clock_timestamp();
  if old.end_date <= v_now or lower(old.status) = 'ended' then
    if v_event_changed or v_pre_changed then raise exception 'event_schedule_ended'; end if;
    if v_post_changed and (lower(old.status) not in ('confirmed', 'ended') or old.sales_status_override = 'closed'
      or not old.postorder_enabled or not new.postorder_enabled
      or old.postorder_closes_at is null or old.postorder_closes_at <= v_now
      or new.postorder_opens_at is distinct from old.postorder_opens_at
      or new.postorder_closes_at is null or new.postorder_closes_at <= old.postorder_closes_at) then
      raise exception 'event_postorder_schedule_ended';
    end if;
  else
    if v_event_changed and (new.end_date <= v_now or (old.start_date <= v_now and new.start_date is distinct from old.start_date)) then
      raise exception 'event_schedule_already_started';
    end if;
    if v_pre_changed and old.preorder_closes_at is not null and old.preorder_closes_at <= v_now then
      raise exception 'event_preorder_schedule_ended';
    end if;
    if v_post_changed and old.postorder_closes_at is not null and old.postorder_closes_at <= v_now then
      raise exception 'event_postorder_schedule_ended';
    end if;
  end if;
  if new.preorder_enabled and new.preorder_closes_at > new.start_date then raise exception 'event_schedule_invalid'; end if;
  if new.postorder_enabled and new.postorder_opens_at < new.end_date then raise exception 'event_schedule_invalid'; end if;
  return new;
end $$;

create trigger guard_event_schedule_update
before update of start_date, end_date, preorder_enabled, preorder_opens_at, preorder_closes_at, postorder_enabled, postorder_opens_at, postorder_closes_at on public.events
for each row execute function private.guard_event_schedule_update();
