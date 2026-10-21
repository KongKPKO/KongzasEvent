-- Bind administrators to immutable Auth identities. An unbound email never grants access.
update public.platform_admins p set auth_user_id=u.id
from auth.users u where p.auth_user_id is null
and lower(p.admin_email)=lower(u.email) and u.email_confirmed_at is not null;

create table private.platform_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid,
 action text not null, target_type text, target_id uuid,
 summary text, created_at timestamptz not null default clock_timestamp()
);
alter table private.platform_admin_audit enable row level security;
revoke all on private.platform_admin_audit from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function public.is_account_active()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.users where id=auth.uid());
$$;
revoke all on function public.is_account_active() from public,anon;
grant execute on function public.is_account_active() to authenticated;

create or replace function private.is_platform_admin_account()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.platform_admins p where p.auth_user_id=auth.uid());
$$;
drop policy if exists platform_admins_self_read on public.platform_admins;
create policy platform_admins_self_read on public.platform_admins for select to authenticated
using(auth_user_id=auth.uid());

-- Trusted, out-of-band first-admin bootstrap: not in the exposed API schema.
create function private.bootstrap_platform_admin(p_user_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
 perform pg_advisory_xact_lock(76103920261021);
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'reason required'; end if;
 if exists(select 1 from public.platform_admins where auth_user_id is not null) then raise exception 'bootstrap already completed'; end if;
 select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'verified account required'; end if;
 insert into public.platform_admins(admin_email,auth_user_id) values(lower(v_email),p_user_id)
 on conflict(admin_email) do update set auth_user_id=excluded.auth_user_id;
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(null,'bootstrap_admin','user',p_user_id,trim(p_reason));
end;
$$;
revoke all on function private.bootstrap_platform_admin(uuid,text) from public,anon,authenticated;
grant execute on function private.bootstrap_platform_admin(uuid,text) to service_role;

create function private.change_platform_admin(p_user_id uuid,p_grant boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
 if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_grant is null or length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'reason required'; end if;
 perform pg_advisory_xact_lock(76103920261021);
 select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'verified account required'; end if;
 if p_grant then
   if exists(select 1 from public.platform_admins where auth_user_id=p_user_id) then raise exception 'already an administrator'; end if;
   insert into public.platform_admins(admin_email,auth_user_id) values(lower(v_email),p_user_id)
   on conflict(admin_email) do update set auth_user_id=excluded.auth_user_id;
 else
   if p_user_id=auth.uid() then raise exception 'cannot revoke your own administrator access'; end if;
   if (select count(*) from public.platform_admins where auth_user_id is not null)<=1 then raise exception 'last administrator protected'; end if;
   delete from public.platform_admins where auth_user_id=p_user_id;
   if not found then raise exception 'administrator not found'; end if;
 end if;
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(auth.uid(),case when p_grant then 'grant_admin' else 'revoke_admin' end,'user',p_user_id,trim(p_reason));
 return true;
end;
$$;
create function public.change_platform_admin(p_user_id uuid,p_grant boolean,p_reason text)
returns boolean language sql security invoker set search_path='' as $$
 select private.change_platform_admin(p_user_id,p_grant,p_reason);
$$;
revoke all on function private.change_platform_admin(uuid,boolean,text),public.change_platform_admin(uuid,boolean,text) from public,anon;
grant execute on function private.change_platform_admin(uuid,boolean,text),public.change_platform_admin(uuid,boolean,text) to authenticated;

-- Only the approval/rejection RPC may change an application's state.
drop policy if exists creator_applications_platform_admin_update on public.creator_applications;
revoke update on public.creator_applications from authenticated;
create function private.audit_application_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status then
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(auth.uid(),'review_application','application',new.id,new.status);
 end if;
 return new;
end;
$$;
revoke all on function private.audit_application_review() from public,anon,authenticated;
create trigger audit_application_review after update on public.creator_applications
for each row execute function private.audit_application_review();

create function private.mask_admin_email(p_email text)
returns text language sql immutable set search_path='' as $$
 select case when p_email is null then null else left(split_part(p_email,'@',1),1)||'***@'||split_part(p_email,'@',2) end;
$$;
revoke all on function private.mask_admin_email(text) from public,anon,authenticated;

-- These owner-only views contain a bounded projection, never raw Auth metadata,
-- customer contact, addresses, payment evidence or credential material.
create view private.console_users as
select u.id, lower(coalesce(u.email,'')) as search_text, case when u.banned_until>now() then 'suspended' else 'active' end as filter_status,
jsonb_build_object('id',u.id,'email_masked',private.mask_admin_email(u.email),
'display_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name'),
'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,
'membership_count',(select count(*) from public.artist_members m where lower(m.member_email)=lower(u.email) and m.status='active'),
'creator_count',(select count(*) from public.artists a where a.id=u.id or exists(select 1 from public.artist_members m where m.artist_id=a.id and lower(m.member_email)=lower(u.email) and m.status='active' and m.role='owner')),
'status',case when u.banned_until>now() then 'suspended' else 'active' end,'suspended',coalesce(u.banned_until>now(),false),'suspended_reason',null,
'is_platform_admin',exists(select 1 from public.platform_admins p where p.auth_user_id=u.id)) as data,
u.created_at
from auth.users u;
create view private.console_creators as
select a.id, lower(concat_ws(' ',a.display_name,a.slug,a.email)) as search_text,
case when (a.is_public and a.is_verified and a.published_at is not null) then 'published' else 'private' end as filter_status,
jsonb_build_object('id',a.id,'display_name',a.display_name,'slug',a.slug,
'owner_email_masked',private.mask_admin_email(a.email),'created_at',a.created_at,
'status',case when (a.is_public and a.is_verified and a.published_at is not null) then 'published' else 'private' end,
'event_count',(select count(*) from public.events e where e.artist_id=a.id),
'campaign_count',(select count(*) from public.online_campaigns c where c.artist_id=a.id)) as data,a.created_at
from public.artists a;
create view private.console_events as
select e.id,lower(concat_ws(' ',e.event_name,a.display_name)) as search_text,e.status as filter_status,
jsonb_build_object('id',e.id,'event_name',e.event_name,'store_id',a.id,'store_name',a.display_name,
'start_at',e.start_date,'end_at',e.end_date,'status',e.status,'is_booth_open',e.is_booth_open,
'hidden',false,'moderation_reason',null,
'queue_count',(select count(*) from public.queues q where q.event_id=e.id),
'order_count',(select count(*) from public.orders o where o.event_id=e.id)) as data,e.created_at
from public.events e join public.artists a on a.id=e.artist_id;
create view private.console_campaigns as
select c.id,lower(concat_ws(' ',c.name,c.slug,a.display_name)) as search_text,c.publication_status as filter_status,
jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'store_id',a.id,'store_name',a.display_name,
'status',c.publication_status,'starts_at',c.opens_at,'ends_at',c.closes_at,'hidden',false,'moderation_reason',null,
'order_count',(select count(*) from public.orders o where o.campaign_id=c.id)) as data,c.created_at
from public.online_campaigns c join public.artists a on a.id=c.artist_id;
create view private.console_orders as
select o.id,lower(concat_ws(' ',o.pickup_code,o.id::text,a.display_name,e.event_name,c.name)) as search_text,
o.status as filter_status,jsonb_build_object('id',o.id,'code',o.pickup_code,
'store_name',a.display_name,'channel_name',coalesce(c.name,e.event_name),'order_type',coalesce(to_jsonb(o)->>'order_type','event'),
'status',o.status,'payment_status',op.payment_status,'fulfillment_status',o.pickup_status,
'created_at',o.created_at) as data,o.created_at
from public.orders o left join public.events e on e.id=o.event_id
left join public.online_campaigns c on c.id=o.campaign_id
left join public.artists a on a.id=coalesce(e.artist_id,c.artist_id)
left join public.order_payments op on op.order_id=o.id;
create view private.console_queue as
select q.id,lower(concat_ws(' ',q.queue_number::text,e.event_name,a.display_name)) as search_text,q.status as filter_status,
jsonb_build_object('id',q.id,'event_id',e.id,'event_name',e.event_name,'store_name',a.display_name,
'queue_number',q.queue_number,'status',q.status,'customer_name_masked',null,'joined_at',q.created_at,'called_at',q.called_at) as data,q.created_at
from public.queues q join public.events e on e.id=q.event_id join public.artists a on a.id=e.artist_id;
create view private.console_audit as
with entries as (
 select 'admin:'||id::text as id,actor_id,action,target_type,target_id,summary,created_at from private.platform_admin_audit
 union all
 select 'support:'||id::text,actor_id,'support_'||action,case when order_id is not null then 'order' else 'creator' end,
 coalesce(order_id,store_id),reason,created_at from private.admin_support_access
 union all
 select 'store:'||id::text,actor_id,case when suspended then 'suspend_store' else 'reactivate_store' end,'creator',artist_id,reason,created_at from private.store_restriction_audit
 union all
 select 'feedback:'||id::text,actor_id,'feedback_'||action,'feedback',ticket_id,
 case when next_status is not null then next_status else action end,created_at from public.feedback_audit_events
)
select l.id,lower(concat_ws(' ',l.action,l.target_type,l.target_id::text,l.summary)) as search_text,l.action as filter_status,
jsonb_build_object('id',l.id,'actor_email_masked',private.mask_admin_email(u.email),'action',l.action,
 'target_type',l.target_type,'target_id',l.target_id,'summary',l.summary,'created_at',l.created_at) as data,l.created_at
from entries l left join auth.users u on u.id=l.actor_id;
revoke all on private.console_users,private.console_creators,private.console_events,private.console_campaigns,private.console_orders,private.console_queue,private.console_audit from public,anon,authenticated;

create function private.platform_admin_console(p_action text,p_query text default null,p_target uuid default null,p_page int default 1,p_filter text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_view text; v_items jsonb; v_detail jsonb; v_total bigint; v_counts jsonb; v_members jsonb; v_feedback bigint:=0;
begin
 if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page>10000 or length(coalesce(p_query,''))>200 or length(coalesce(p_filter,''))>80 then raise exception 'invalid query' using errcode='22023'; end if;
 if p_action='overview' then
   if to_regclass('public.feedback_tickets') is not null then
     execute 'select count(*) from public.feedback_tickets where status in (''new'',''in_progress'')' into v_feedback;
   end if;
   select jsonb_build_object('users',(select count(*) from auth.users),'creators',(select count(*) from public.artists),
    'events',(select count(*) from public.events),'campaigns',(select count(*) from public.online_campaigns),
    'active_events',(select count(*) from public.events where status='Confirmed' and start_date<=now() and end_date>now()),
    'active_campaigns',(select count(*) from public.online_campaigns where publication_status='published' and opens_at<=now() and closes_at>now()),
    'open_orders',(select count(*) from public.orders where lower(status) not in ('completed','cancelled','expired')),
    'active_queue_entries',(select count(*) from public.queues where lower(status) in ('waiting','calling','serving')),
    'pending_applications',(select count(*) from public.creator_applications where status='pending'),'open_feedback',v_feedback) into v_counts;
 else
   v_view:=case p_action when 'users' then 'console_users' when 'user' then 'console_users'
   when 'creators' then 'console_creators' when 'creator' then 'console_creators'
   when 'events' then 'console_events' when 'event' then 'console_events'
   when 'campaigns' then 'console_campaigns' when 'campaign' then 'console_campaigns'
   when 'operations_orders' then 'console_orders' when 'operations_queue' then 'console_queue'
   when 'audit' then 'console_audit' else null end;
   if v_view is null then raise exception 'unknown action' using errcode='22023'; end if;
   if p_action in ('user','creator','event','campaign') then
     if p_target is null then raise exception 'target required' using errcode='22023'; end if;
     execute format('select data from private.%I where id=$1',v_view) into v_detail using p_target;
     if v_detail is null then raise exception 'not found' using errcode='P0002'; end if;
     if p_action in ('user','creator') then
       select coalesce(jsonb_agg(jsonb_build_object('store_id',a.id,'store_name',a.display_name,'role',m.role,'status',m.status,'created_at',m.created_at) order by a.display_name),'[]'::jsonb)
       into v_members from (
        select artist_id,member_email,role,status,created_at from public.artist_members
        union all
        select a.id,u.email,'owner','active',a.created_at from public.artists a join auth.users u on u.id=a.id
        where not exists(select 1 from public.artist_members existing where existing.artist_id=a.id and lower(existing.member_email)=lower(u.email))
       ) m join public.artists a on a.id=m.artist_id
       where (p_action='creator' and a.id=p_target) or (p_action='user' and lower(m.member_email)=(select lower(email) from auth.users where id=p_target));
       v_detail:=v_detail||jsonb_build_object('memberships',v_members);
     end if;
   else
     execute format('select count(*) from private.%I where ($1 is null or strpos(search_text,lower($1))>0) and ($2 is null or lower(filter_status)=lower($2))',v_view)
       into v_total using nullif(trim(p_query),''),nullif(trim(p_filter),'');
     execute format('select coalesce(jsonb_agg(data),''[]''::jsonb) from (select data from private.%I where ($1 is null or strpos(search_text,lower($1))>0) and ($2 is null or lower(filter_status)=lower($2)) order by created_at desc,id limit 20 offset $3) p',v_view)
       into v_items using nullif(trim(p_query),''),nullif(trim(p_filter),''),(p_page-1)*20;
   end if;
 end if;
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(auth.uid(),'console_'||p_action,case when p_target is not null then p_action end,p_target,'Read administrative data');
 return jsonb_strip_nulls(jsonb_build_object('ok',true,'action',p_action,'page',p_page,'page_size',20,'total',v_total,'items',v_items,'detail',v_detail,'counts',v_counts,'generated_at',clock_timestamp()));
end;
$$;
create function public.platform_admin_console(p_action text,p_query text default null,p_target uuid default null,p_page int default 1,p_filter text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.platform_admin_console(p_action,p_query,p_target,p_page,p_filter);
$$;
revoke all on function private.platform_admin_console(text,text,uuid,int,text),public.platform_admin_console(text,text,uuid,int,text) from public,anon;
grant execute on function private.platform_admin_console(text,text,uuid,int,text),public.platform_admin_console(text,text,uuid,int,text) to authenticated;

-- Feedback reads/downloads use an authenticated Edge handler and this service-only
-- audit sink. The browser cannot supply a forged actor through the exposed API.
create function public.record_feedback_admin_access(p_actor_id uuid,p_action text,p_ticket_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_action not in ('list','detail','attachment') or not exists(select 1 from public.platform_admins where auth_user_id=p_actor_id) then raise exception 'forbidden'; end if;
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(p_actor_id,'feedback_'||p_action,'feedback',p_ticket_id,'Access feedback');
end;
$$;
revoke all on function public.record_feedback_admin_access(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_feedback_admin_access(uuid,text,uuid) to service_role;
