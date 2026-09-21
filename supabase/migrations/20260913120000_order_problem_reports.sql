create table public.order_problem_reports (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source text not null check (source in ('customer','merchant')),
  category text not null check (category in ('payment','delivery','item','other')),
  description text not null check (length(description) between 5 and 2000),
  contact text not null check (length(contact) between 3 and 300),
  image_paths text[] not null default '{}',
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  notification_status text not null default 'pending' check (notification_status in ('pending','sending','sent','failed')),
  notification_attempts integer not null default 0,
  notification_started_at timestamptz,
  notification_next_at timestamptz not null default now(),
  notification_sent_at timestamptz,
  notification_to text,
  notification_url text,
  check (cardinality(image_paths) <= 5)
);
alter table public.order_problem_reports enable row level security;
revoke all on public.order_problem_reports from public, anon, authenticated;
grant select on public.order_problem_reports to authenticated;
create policy order_problems_management_read on public.order_problem_reports for select to authenticated
  using(public.has_artist_role(artist_id,array['owner','manager']));
create index order_problems_artist_created on public.order_problem_reports(artist_id,created_at desc);
create index order_problems_order_open on public.order_problem_reports(order_id) where status = 'open';

create function public.submit_order_problem(
  p_id uuid, p_order_id uuid, p_code text, p_category text, p_description text, p_contact text,
  p_contact_confirmed boolean, p_image_paths text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
  v_existing public.order_problem_reports;
  v_source text;
begin
  select o.id,o.pickup_code,coalesce(e.artist_id,c.artist_id) artist_id into v_order
    from public.orders o left join public.events e on e.id=o.event_id
    left join public.online_campaigns c on c.id=o.campaign_id where o.id=p_order_id for update of o;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if public.has_artist_role(v_order.artist_id,array['owner','manager']) and p_code is null then
    v_source := 'merchant';
  elsif length(coalesce(p_code,'')) >= 6 and upper(trim(p_code)) = upper(v_order.pickup_code) then
    v_source := 'customer';
  else raise exception 'order_not_found'; end if;
  if p_id is null or p_contact_confirmed is distinct from true
    or p_category not in ('payment','delivery','item','other')
    or length(trim(coalesce(p_description,''))) not between 5 and 2000
    or length(trim(coalesce(p_contact,''))) not between 3 and 300
    or cardinality(coalesce(p_image_paths,'{}')) > 5 then raise exception 'invalid_problem_report'; end if;
  select * into v_existing from public.order_problem_reports where id=p_id;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.source <> v_source or v_existing.category <> p_category
      or v_existing.description <> trim(p_description) or v_existing.contact <> trim(p_contact)
      or v_existing.image_paths <> coalesce(p_image_paths,'{}') then raise exception 'problem_request_conflict'; end if;
    return v_existing.id;
  end if;
  if (select count(*) from public.order_problem_reports where order_id=p_order_id and created_at > now()-interval '1 day') >= 3 then
    raise exception 'problem_limit_reached'; end if;
  if exists(select 1 from unnest(coalesce(p_image_paths,'{}')) requested(value) where not exists(
    select 1 from public.image_uploads u where u.path=requested.value and u.order_id=p_order_id and u.purpose='problem' and u.uploaded_at is not null
  )) then raise exception 'invalid_problem_image'; end if;
  insert into public.order_problem_reports(id,order_id,artist_id,source,category,description,contact,image_paths)
    values(p_id,p_order_id,v_order.artist_id,v_source,p_category,trim(p_description),trim(p_contact),coalesce(p_image_paths,'{}'));
  return p_id;
end $$;
revoke all on function public.submit_order_problem(uuid,uuid,text,text,text,text,boolean,text[]) from public;
grant execute on function public.submit_order_problem(uuid,uuid,text,text,text,text,boolean,text[]) to anon,authenticated;

create function public.resolve_order_problem(p_id uuid,p_resolution text,p_reopen boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.order_problem_reports;
begin
  select * into v_report from public.order_problem_reports where id=p_id for update;
  if not found or not public.has_artist_role(v_report.artist_id,array['owner','manager']) then
    raise exception 'permission_denied' using errcode='42501'; end if;
  if not p_reopen and length(trim(coalesce(p_resolution,''))) not between 3 and 2000 then raise exception 'resolution_required'; end if;
  update public.order_problem_reports set status=case when p_reopen then 'open' else 'resolved' end,
    resolution=case when p_reopen then resolution else trim(p_resolution) end,
    resolved_at=case when p_reopen then null else now() end,resolved_by=auth.uid() where id=p_id;
end $$;
revoke all on function public.resolve_order_problem(uuid,text,boolean) from public;
grant execute on function public.resolve_order_problem(uuid,text,boolean) to authenticated;

create function public.find_order_for_problem(p_artist_id uuid,p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_artist_role(p_artist_id,array['owner','manager']) then raise exception 'permission_denied' using errcode='42501'; end if;
  select o.id into v_id from public.orders o left join public.events e on e.id=o.event_id
    left join public.online_campaigns c on c.id=o.campaign_id
    where coalesce(e.artist_id,c.artist_id)=p_artist_id and upper(o.pickup_code)=upper(trim(p_code));
  if v_id is null then raise exception 'order_not_found'; end if;
  return v_id;
end $$;
revoke all on function public.find_order_for_problem(uuid,text) from public;
grant execute on function public.find_order_for_problem(uuid,text) to authenticated;

alter table public.image_uploads drop constraint image_uploads_purpose_check;
alter table public.image_uploads add constraint image_uploads_purpose_check check(purpose in ('avatar','product','qr','evidence','problem'));
create policy problem_evidence_staff_read on storage.objects for select to authenticated using (
  bucket_id='PaymentEvidence' and exists(select 1 from public.order_problem_reports r
    where storage.objects.name=any(r.image_paths) and public.has_artist_role(r.artist_id,array['owner','manager']))
);

create function public.claim_problem_notifications(p_report_id uuid default null)
returns setof public.order_problem_reports language sql security definer set search_path = '' as $$
  update public.order_problem_reports r set notification_status='sending',notification_attempts=notification_attempts+1,
    notification_started_at=coalesce(notification_started_at,now()),notification_next_at=now()+interval '5 minutes'
  where r.id in (select id from public.order_problem_reports
    where (p_report_id is null or id=p_report_id) and notification_status<>'sent'
      and notification_next_at <= now() and notification_attempts < 6
      and (notification_started_at is null or notification_started_at > now()-interval '23 hours')
    order by created_at for update skip locked limit 10)
  returning r.*;
$$;
revoke all on function public.claim_problem_notifications(uuid) from public,anon,authenticated;
grant execute on function public.claim_problem_notifications(uuid) to service_role;

create or replace function public.reserve_image_upload(
  p_id uuid, p_purpose text, p_artist_id uuid, p_order_id uuid, p_code text, p_hash text
) returns table(bucket text, path text, uploaded boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_artist uuid;
  v_row public.image_uploads;
  v_bucket text;
  v_path text;
begin
  if p_id is null or p_hash !~ '^[a-f0-9]{64}$' or p_purpose not in ('avatar','product','qr','evidence','problem') then
    raise exception 'invalid_upload';
  end if;
  if p_purpose in ('evidence','problem') then
    select coalesce(op.artist_id,e.artist_id,c.artist_id) into v_artist from public.orders o
      left join public.order_payments op on op.order_id = o.id
      left join public.events e on e.id=o.event_id
      left join public.online_campaigns c on c.id=o.campaign_id
      where o.id = p_order_id
        and (upper(o.pickup_code) = upper(trim(p_code)) or (p_purpose='problem' and public.has_artist_role(coalesce(op.artist_id,e.artist_id,c.artist_id),array['owner','manager'])))
        and (p_purpose='problem' or op.payment_status in ('awaiting_payment','payment_expired','payment_rejected'))
      for update of o;
    if v_artist is null then raise exception 'order_not_found'; end if;
    v_bucket := 'PaymentEvidence';
    v_path := 'validated/' || p_order_id || '/' || p_id || '.webp';
  else
    if p_order_id is not null then raise exception 'invalid_upload'; end if;
    v_artist := p_artist_id;
    if v_artist is null or not public.has_artist_role(v_artist, array['owner','manager']) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    -- Serialize the per-creator upload budget.
    perform 1 from public.artists where id = v_artist for update;
    v_bucket := case when p_purpose = 'product' then 'Menu' else 'Avatar' end;
    v_path := case when p_purpose = 'product' then 'public/' else '' end || v_artist || '/' || p_id || '.webp';
  end if;
  select * into v_row from public.image_uploads where id = p_id;
  if found then
    if v_row.artist_id <> v_artist or v_row.order_id is distinct from p_order_id
      or v_row.purpose <> p_purpose or v_row.content_hash <> p_hash
      or v_row.actor_id is distinct from auth.uid() then raise exception 'upload_request_conflict'; end if;
    return query select v_row.bucket, v_row.path, v_row.uploaded_at is not null;
    return;
  end if;
  if p_purpose in ('evidence','problem') and (select count(*) from public.image_uploads where order_id = p_order_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'upload_limit_reached';
  end if;
  if p_purpose not in ('evidence','problem') and (select count(*) from public.image_uploads where artist_id = v_artist and purpose not in ('evidence','problem') and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'upload_limit_reached';
  end if;
  insert into public.image_uploads(id,artist_id,order_id,actor_id,purpose,bucket,path,content_hash)
    values(p_id,v_artist,p_order_id,auth.uid(),p_purpose,v_bucket,v_path,p_hash);
  return query select v_bucket, v_path, false;
end $$;
