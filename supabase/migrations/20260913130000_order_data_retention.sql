alter table public.orders add column retention_completed_at timestamptz,
  add column customer_pii_deleted_at timestamptz, add column retention_lock_until timestamptz, add column financial_evidence_queued_at timestamptz;
-- Historical completion timestamps are incomplete; never guess an earlier deletion date.
update public.orders set retention_completed_at=coalesce(picked_up_at,shipped_at,cancelled_at,now())
  where status in ('completed','cancelled') or pickup_status in ('picked_up','shipped','cancelled','expired');

create function private.track_order_retention() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' and coalesce(auth.role(),'') in ('anon','authenticated') and (new.customer_pii_deleted_at is not null or new.retention_lock_until is not null or new.financial_evidence_queued_at is not null) then raise exception 'permission_denied' using errcode='42501'; end if;
  if tg_op='UPDATE' and coalesce(auth.role(),'') in ('anon','authenticated') and (
    new.customer_pii_deleted_at is distinct from old.customer_pii_deleted_at or new.retention_lock_until is distinct from old.retention_lock_until or new.financial_evidence_queued_at is distinct from old.financial_evidence_queued_at
  ) then raise exception 'permission_denied' using errcode='42501'; end if;
  if new.status in ('completed','cancelled') or new.pickup_status in ('picked_up','shipped','cancelled','expired') then
    new.retention_completed_at := coalesce(case when tg_op='UPDATE' then old.retention_completed_at end,new.picked_up_at,new.shipped_at,new.cancelled_at,now());
  else new.retention_completed_at := null; end if;
  return new;
end $$;
create trigger track_order_retention before insert or update on public.orders for each row execute function private.track_order_retention();

alter table public.orders drop constraint orders_preorder_customer_contact_check;
alter table public.orders add constraint orders_preorder_customer_contact_check check (
  customer_pii_deleted_at is not null or order_type<>'preorder' or
  length(trim(coalesce(customer_phone,'')))>0 or length(trim(coalesce(customer_social,'')))>0 or
  length(trim(coalesce(customer_email,'')))>0 or length(trim(coalesce(customer_contact,'')))>0
);
alter table public.orders drop constraint orders_preorder_customer_name_check;
alter table public.orders add constraint orders_preorder_customer_name_check check (
  customer_pii_deleted_at is not null or order_type<>'preorder' or length(trim(coalesce(customer_name,'')))>0
);

create table private.retention_files (
  bucket text not null, path text not null, order_id uuid references public.orders(id) on delete set null,
  reason text not null, created_at timestamptz not null default now(), claimed_until timestamptz,
  deleted_at timestamptz, primary key(bucket,path)
);
revoke all on private.retention_files from public,anon,authenticated;

create function public.prepare_order_retention() returns integer
language plpgsql security definer set search_path='' as $$
declare v_order public.orders; v_count integer := 0;
begin
  for v_order in select o.* from public.orders o where o.retention_completed_at < now()-interval '6 months'
    and (o.customer_pii_deleted_at is null or exists(select 1 from public.order_problem_reports r where r.order_id=o.id and r.status='resolved' and r.description<>'[Removed]') or (o.financial_evidence_queued_at is null and o.retention_completed_at < now()-interval '12 months'))
    and not exists(select 1 from public.order_problem_reports r where r.order_id=o.id and r.status='open')
    and not exists(select 1 from public.order_payments p where p.order_id=o.id and p.payment_status in ('refund_pending','payment_submitted','payment_submitted_late'))
    order by o.retention_completed_at for update skip locked limit 100
  loop
    if v_order.customer_pii_deleted_at is null or exists(select 1 from public.order_problem_reports r where r.order_id=v_order.id and r.status='resolved' and r.description<>'[Removed]') then
      insert into private.retention_files(bucket,path,order_id,reason)
        select 'PaymentEvidence',path,v_order.id,'problem_retention' from public.order_problem_reports r,
        unnest(r.image_paths) path where r.order_id=v_order.id on conflict do nothing;
      update public.orders set customer_name=null,customer_contact=null,customer_phone=null,customer_social=null,
        customer_email=null,customer_note=null,shipping_address=null,tracking_number=null,shipping_carrier=null,
        cancel_reason=null,customer_pii_deleted_at=now() where id=v_order.id;
      update public.order_items set notes='' where order_id=v_order.id;
      update public.order_payments set review_note=null where order_id=v_order.id;
      update public.payment_review_events set note=null where order_id=v_order.id;
      update public.order_problem_reports set description='[Removed]',contact='[Removed]',resolution=null,notification_to=null
        where order_id=v_order.id and status='resolved';
      update public.preorder_notification_deliveries set last_error=null where order_id=v_order.id;
      update public.queues set customer_fingerprint=null where id=v_order.queue_id;
      v_count := v_count+1;
    end if;
    if v_order.financial_evidence_queued_at is null and v_order.retention_completed_at < now()-interval '12 months' then
      insert into private.retention_files(bucket,path,order_id,reason)
        select 'PaymentEvidence',path,v_order.id,'financial_retention' from (
          select slip_url path from public.order_payments where order_id=v_order.id
          union select refund_evidence_url from public.order_payments where order_id=v_order.id
          union select slip_url from public.payment_review_events where order_id=v_order.id
        ) files where path is not null and path<>'' and path !~ '^https?://' on conflict do nothing;
      update public.order_payments set refund_note=null,refund_reference=null where order_id=v_order.id;
      update public.orders set financial_evidence_queued_at=now() where id=v_order.id;
    end if;
  end loop;
  -- Abandoned private uploads have no form references and are at least a day old.
  insert into private.retention_files(bucket,path,order_id,reason)
    select u.bucket,u.path,u.order_id,'abandoned_upload' from public.image_uploads u
    where u.purpose in ('evidence','problem') and u.created_at < now()-interval '1 day'
      and not exists(select 1 from public.order_payments p where p.slip_url=u.path or p.refund_evidence_url=u.path)
      and not exists(select 1 from public.payment_review_events e where e.slip_url=u.path)
      and not exists(select 1 from public.order_problem_reports r where u.path=any(r.image_paths))
    on conflict do nothing;
  return v_count;
end $$;
revoke all on function public.prepare_order_retention() from public,anon,authenticated;
grant execute on function public.prepare_order_retention() to service_role;

create function public.claim_retention_files() returns table(bucket text,path text,order_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_file private.retention_files;
begin
  for v_file in select f.* from private.retention_files f where f.deleted_at is null
    and (f.claimed_until is null or f.claimed_until < now())
    and not exists(select 1 from public.order_problem_reports r where r.order_id=f.order_id and r.status='open') order by f.created_at for update skip locked limit 20
  loop
    if v_file.order_id is not null then
      perform 1 from public.orders where id=v_file.order_id for update;
      if exists(select 1 from public.order_problem_reports r where r.order_id=v_file.order_id and r.status='open') then continue; end if;
      update public.orders set retention_lock_until=now()+interval '5 minutes' where id=v_file.order_id;
    end if;
    update private.retention_files f set claimed_until=now()+interval '5 minutes' where f.bucket=v_file.bucket and f.path=v_file.path;
    return query select v_file.bucket,v_file.path,v_file.order_id;
  end loop;
end $$;
revoke all on function public.claim_retention_files() from public,anon,authenticated;
grant execute on function public.claim_retention_files() to service_role;

create function public.finish_retention_file(p_bucket text,p_path text) returns void
language plpgsql security definer set search_path='' as $$
declare v_order uuid;
begin
  select order_id into v_order from private.retention_files where bucket=p_bucket and path=p_path and claimed_until>now();
  if not found then raise exception 'retention_claim_expired'; end if;
  update private.retention_files set deleted_at=now() where bucket=p_bucket and path=p_path;
  update public.order_payments set slip_url=null where order_id=v_order and slip_url=p_path;
  update public.order_payments set refund_evidence_url=null where order_id=v_order and refund_evidence_url=p_path;
  update public.payment_review_events set slip_url=null where order_id=v_order and slip_url=p_path;
  update public.order_problem_reports set image_paths=array_remove(image_paths,p_path) where order_id=v_order and p_path=any(image_paths);
  delete from public.image_uploads where bucket=p_bucket and path=p_path;
  if not exists(select 1 from private.retention_files where order_id=v_order and deleted_at is null and claimed_until>now()) then
    update public.orders set retention_lock_until=null where id=v_order;
  end if;
end $$;
revoke all on function public.finish_retention_file(text,text) from public,anon,authenticated;
grant execute on function public.finish_retention_file(text,text) to service_role;

-- No URL or key is hard-coded. Missing setup leaves the remote scheduler inactive.
create extension if not exists pg_net with schema extensions;
create function private.wake_operations_maintenance() returns void
language plpgsql security definer set search_path='' as $$
declare v_url text; v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='nireq_functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='nireq_maintenance_token';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(url:=rtrim(v_url,'/')||'/operations-maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','x-maintenance-token',v_key),body:='{}'::jsonb,timeout_milliseconds:=20000);
end $$;
revoke all on function private.wake_operations_maintenance() from public,anon,authenticated;
select cron.schedule('nireq-operations-maintenance','*/5 * * * *','select private.wake_operations_maintenance()');

create or replace function public.submit_order_problem(
  p_id uuid, p_order_id uuid, p_code text, p_category text, p_description text, p_contact text,
  p_contact_confirmed boolean, p_image_paths text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_order record;
  v_existing public.order_problem_reports;
  v_source text;
begin
  select o.id,o.pickup_code,o.retention_lock_until,coalesce(e.artist_id,c.artist_id) artist_id into v_order
    from public.orders o left join public.events e on e.id=o.event_id
    left join public.online_campaigns c on c.id=o.campaign_id where o.id=p_order_id for update of o;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if public.has_artist_role(v_order.artist_id,array['owner','manager']) and p_code is null then
    v_source := 'merchant';
  elsif length(coalesce(p_code,'')) >= 6 and upper(trim(p_code)) = upper(v_order.pickup_code) then
    v_source := 'customer';
  else raise exception 'order_not_found'; end if;
  if v_order.retention_lock_until>now() then raise exception 'privacy_maintenance_retry'; end if;
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
