-- Suspend one immutable Auth identity's management access, never its shop.
-- Existing JWTs consult database state; public customer permissions remain intact.
create table private.account_management_restrictions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 suspended boolean not null,
 reason text not null check(length(trim(reason)) between 5 and 500),
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.account_management_restrictions enable row level security;
revoke all on private.account_management_restrictions from public,anon,authenticated;

create function private.account_management_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select (auth.uid() is null or exists(select 1 from auth.users where id=auth.uid()))
 and not exists(select 1 from private.account_management_restrictions
 where user_id=auth.uid() and suspended);
$$;
revoke all on function private.account_management_allowed() from public;
grant execute on function private.account_management_allowed() to anon,authenticated,service_role;

create function private.is_account_management_active()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.account_management_allowed()
 and exists(select 1 from auth.users where id=auth.uid());
$$;

create function public.is_account_management_active()
returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_account_management_active();
$$;
revoke all on function private.is_account_management_active(),public.is_account_management_active() from public,anon;
grant execute on function private.is_account_management_active(),public.is_account_management_active() to authenticated;

create or replace function private.is_platform_admin_account()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.account_management_allowed()
 and exists(select 1 from public.platform_admins p where p.auth_user_id=auth.uid());
$$;

create function private.set_account_management_suspension(
 p_user_id uuid,p_suspended boolean,p_reason text,p_expected_suspended boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_suspended boolean;
begin
 -- Share the administrator grant/revoke lock so a concurrent grant cannot bypass protection.
 perform pg_advisory_xact_lock(76103920261021);
 if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_user_id is null or p_suspended is null or p_expected_suspended is null
 or length(trim(coalesce(p_reason,''))) not between 5 and 500 then
 raise exception 'valid account, state and reason required' using errcode='22023'; end if;
 perform 1 from auth.users where id=p_user_id for update;
 if not found then raise exception 'account not found' using errcode='P0002'; end if;
 if p_suspended and (p_user_id=auth.uid() or exists(select 1 from public.platform_admins where auth_user_id=p_user_id)) then
 raise exception 'revoke Platform Admin access before suspension' using errcode='42501'; end if;
 select coalesce((select suspended from private.account_management_restrictions where user_id=p_user_id),false) into v_suspended;
 -- Use an HTTP conflict, not 40001: PostgREST may retry serialization failures.
 if v_suspended is distinct from p_expected_suspended or v_suspended=p_suspended then
 raise exception 'account state changed; reload before retrying' using errcode='PT409'; end if;
 insert into private.account_management_restrictions(user_id,suspended,reason)
 values(p_user_id,p_suspended,trim(p_reason))
 on conflict(user_id) do update set suspended=excluded.suspended,reason=excluded.reason,updated_at=clock_timestamp();
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(auth.uid(),case when p_suspended then 'suspend_account_management' else 'reactivate_account_management' end,'user',p_user_id,trim(p_reason));
 return true;
end;
$$;
create function public.set_account_management_suspension(
 p_user_id uuid,p_suspended boolean,p_reason text,p_expected_suspended boolean
) returns boolean language sql security invoker set search_path='' as $$
 select private.set_account_management_suspension(p_user_id,p_suspended,p_reason,p_expected_suspended);
$$;
revoke all on function private.set_account_management_suspension(uuid,boolean,text,boolean),public.set_account_management_suspension(uuid,boolean,text,boolean) from public,anon;
grant execute on function private.set_account_management_suspension(uuid,boolean,text,boolean),public.set_account_management_suspension(uuid,boolean,text,boolean) to authenticated;


-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.has_artist_role(p_artist_id uuid, p_allowed_roles text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_allowed text[];
begin
  if not private.account_management_allowed() then return false; end if;
  if auth.uid() is null then
    return false;
  end if;

  v_allowed := array(
    select public.normalize_artist_role(role_name)
    from unnest(p_allowed_roles) as role_name
  );

  if array_position(v_allowed, 'seller') is not null or array_position(v_allowed, 'queue_staff') is not null then
    v_allowed := array(select distinct role_name from unnest(v_allowed || array['manager']) as role_name);
  end if;

  if auth.uid() = p_artist_id and array_position(v_allowed, 'owner') is not null then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));

  if v_email = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.artist_members m
    where m.artist_id = p_artist_id
      and m.status = 'active'
      and lower(m.member_email) = v_email
      and public.normalize_artist_role(m.role) = any(v_allowed)
  );
end;
$function$;

-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.has_event_role(p_event_id uuid, p_allowed_roles text[])
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event record;
  v_email text;
  v_member record;
  v_has_restrictions boolean := false;
  v_allowed text[];
begin
  if not private.account_management_allowed() then return false; end if;
  if auth.uid() is null then
    return false;
  end if;

  v_allowed := array(
    select public.normalize_artist_role(role_name)
    from unnest(p_allowed_roles) as role_name
  );

  if array_position(v_allowed, 'seller') is not null or array_position(v_allowed, 'queue_staff') is not null then
    v_allowed := array(select distinct role_name from unnest(v_allowed || array['manager']) as role_name);
  end if;

  select e.id, e.artist_id
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null then
    return false;
  end if;

  if auth.uid() = v_event.artist_id and array_position(v_allowed, 'owner') is not null then
    return true;
  end if;

  v_email := lower(coalesce((auth.jwt() ->> 'email'), ''));
  if v_email = '' then
    return false;
  end if;

  select m.*
  into v_member
  from public.artist_members m
  where m.artist_id = v_event.artist_id
    and m.status = 'active'
    and lower(m.member_email) = v_email
    and public.normalize_artist_role(m.role) = any(v_allowed)
  order by m.updated_at desc
  limit 1;

  if v_member.id is null then
    return false;
  end if;

  if public.normalize_artist_role(v_member.role) in ('owner', 'manager') then
    return true;
  end if;

  select exists (
    select 1
    from public.event_member_assignments ema
    where ema.artist_id = v_event.artist_id
      and ema.member_id = v_member.id
  ) into v_has_restrictions;

  if not v_has_restrictions then
    return true;
  end if;

  return exists (
    select 1
    from public.event_member_assignments ema
    where ema.artist_id = v_event.artist_id
      and ema.member_id = v_member.id
      and ema.event_id = p_event_id
  );
end;
$function$;

-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.accept_team_invitation(p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_invitation public.artist_member_invitations%rowtype;
  v_member_id uuid;
  v_first_event_id uuid;
  v_redirect_path text;
  v_rows_updated integer;
begin
  if not private.account_management_allowed() then raise exception 'account management suspended' using errcode='42501'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select *
  into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) <> v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at <= clock_timestamp() then
    raise exception 'invitation has expired';
  end if;

  insert into public.artist_members (artist_id, member_email, role, status, created_by)
  values (v_invitation.artist_id, v_email, v_invitation.role, 'active', v_invitation.invited_by)
  on conflict (artist_id, lower(member_email))
  do update set
    role = excluded.role,
    status = 'active',
    updated_at = now()
  returning id into v_member_id;

  if v_invitation.role in ('seller', 'queue_staff') then
    delete from public.event_member_assignments
    where artist_id = v_invitation.artist_id
      and member_id = v_member_id;

    insert into public.event_member_assignments (artist_id, member_id, event_id)
    select v_invitation.artist_id, v_member_id, ie.event_id
    from public.artist_member_invitation_events ie
    where ie.invitation_id = p_invitation_id
    on conflict (event_id, member_id) do nothing;

    select ie.event_id
    into v_first_event_id
    from public.artist_member_invitation_events ie
    where ie.invitation_id = p_invitation_id
    order by ie.created_at asc
    limit 1;
  else
    delete from public.event_member_assignments
    where artist_id = v_invitation.artist_id
      and member_id = v_member_id;
  end if;

  update public.artist_member_invitations
  set status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'invitation is not pending or was already changed';
  end if;

  v_redirect_path := case
    when v_invitation.role = 'seller' and v_first_event_id is not null then '/live/pos?eventId=' || v_first_event_id::text
    when v_invitation.role = 'queue_staff' and v_first_event_id is not null then '/live/queue?eventId=' || v_first_event_id::text
    else '/manage-events'
  end;

  return jsonb_build_object(
    'result', 'accepted',
    'role', v_invitation.role,
    'event_id', v_first_event_id,
    'redirect_path', v_redirect_path
  );
end;
$function$;

-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.decline_team_invitation(p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_invitation public.artist_member_invitations%rowtype;
  v_rows_updated integer;
begin
  if not private.account_management_allowed() then raise exception 'account management suspended' using errcode='42501'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    raise exception 'not authenticated';
  end if;

  select *
  into v_invitation
  from public.artist_member_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'invitation not found';
  end if;

  if lower(v_invitation.invited_email) <> v_email then
    raise exception 'permission denied';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation is not pending (current status: %)', v_invitation.status;
  end if;

  update public.artist_member_invitations
  set status = 'declined',
      declined_at = now(),
      updated_at = now()
  where id = p_invitation_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'invitation is not pending or was already changed';
  end if;

  return jsonb_build_object('result', 'declined');
end;
$function$;

-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.list_my_pending_invitations()
 RETURNS TABLE(id uuid, artist_id uuid, artist_name text, role text, invited_at timestamp with time zone, expires_at timestamp with time zone, event_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
begin
  if not private.account_management_allowed() then raise exception 'account management suspended' using errcode='42501'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if v_email = '' then
    return;
  end if;

  return query
    select
      i.id,
      i.artist_id,
      coalesce(a.display_name, 'Unknown Booth') as artist_name,
      i.role,
      i.invited_at,
      i.expires_at,
      coalesce(array_agg(ie.event_id order by ie.created_at) filter (where ie.event_id is not null), array[]::uuid[]) as event_ids
    from public.artist_member_invitations i
    join public.artists a on a.id = i.artist_id
    left join public.artist_member_invitation_events ie on ie.invitation_id = i.id
    where lower(i.invited_email) = v_email
      and i.status = 'pending'
      and (i.expires_at is null or i.expires_at > now())
    group by i.id, i.artist_id, a.display_name, i.role, i.invited_at, i.expires_at
    order by i.invited_at asc;
end;
$function$;

-- Keep the existing role and assignment rules, adding a live account boundary.
CREATE OR REPLACE FUNCTION public.complete_verified_creator_signup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_meta jsonb;
  v_application_id uuid;
  v_creator_name text;
  v_contact_name text;
  v_desired_slug text;
  v_primary_social_url text;
  v_application_note text;
begin
  if not private.account_management_allowed() then raise exception 'account management suspended' using errcode='42501'; end if;
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
  into v_email, v_confirmed_at, v_meta
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    raise exception 'Authenticated user not found';
  end if;

  if exists (select 1 from public.artists a where a.id = v_uid) then
    return jsonb_build_object('status', 'exists');
  end if;

  if coalesce(v_meta ->> 'creator_signup', '') <> 'self_serve' then
    return jsonb_build_object('status', 'not_pending');
  end if;

  if v_confirmed_at is null then
    return jsonb_build_object('status', 'email_unconfirmed');
  end if;

  v_creator_name := nullif(trim(coalesce(v_meta ->> 'creator_name', '')), '');
  v_contact_name := nullif(trim(coalesce(v_meta ->> 'contact_name', '')), '');
  v_desired_slug := lower(nullif(trim(coalesce(v_meta ->> 'desired_slug', '')), ''));
  v_primary_social_url := nullif(trim(coalesce(v_meta ->> 'primary_social_url', '')), '');
  v_application_note := nullif(trim(coalesce(v_meta ->> 'application_note', '')), '');

  if v_creator_name is null
    or v_contact_name is null
    or v_desired_slug is null
    or v_primary_social_url is null
    or v_application_note is null then
    raise exception 'Creator signup metadata is incomplete';
  end if;

  if v_desired_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    or v_desired_slug = any (array['admin', 'settings', 'login', 'menu']) then
    raise exception 'Desired URL slug is invalid';
  end if;

  if exists (
    select 1
    from public.artists a
    where lower(a.slug) = v_desired_slug
  ) or exists (
    select 1
    from public.creator_applications ca
    where lower(ca.desired_slug) = v_desired_slug
      and ca.status in ('pending', 'auto_approved', 'approved')
      and ca.auth_user_id <> v_uid
  ) then
    raise exception 'Desired URL slug is already taken';
  end if;

  insert into public.creator_applications (
    auth_user_id,
    status,
    email,
    contact_name,
    creator_name,
    desired_slug,
    primary_social_url,
    website_url,
    instagram_url,
    x_url,
    facebook_url,
    tiktok_url,
    application_note
  )
  values (
    v_uid,
    'auto_approved',
    v_email,
    v_contact_name,
    v_creator_name,
    v_desired_slug,
    v_primary_social_url,
    nullif(trim(coalesce(v_meta ->> 'website_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'instagram_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'x_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'facebook_url', '')), ''),
    nullif(trim(coalesce(v_meta ->> 'tiktok_url', '')), ''),
    v_application_note
  )
  returning id into v_application_id;

  return jsonb_build_object(
    'status', 'created',
    'application_id', v_application_id,
    'artist_id', v_uid
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_actor_workspaces()
 RETURNS TABLE(artist_id uuid, artist_name text, artist_slug text, role text, is_owner boolean, member_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with identity as (
    select
      auth.uid() as user_id,
      lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ), candidates as (
    -- Original prototype owners are still identified by artists.id = auth.uid().
    select
      a.id as artist_id,
      a.display_name as artist_name,
      a.slug as artist_slug,
      'owner'::text as role,
      true as is_owner,
      nullif(i.email, '') as member_email,
      1 as source_priority,
      a.updated_at as membership_updated_at
    from identity i
    join public.artists a on a.id = i.user_id
    where i.user_id is not null

    union all

    -- Active team membership is the source of truth for every invited role.
    select
      a.id,
      a.display_name,
      a.slug,
      public.normalize_artist_role(m.role),
      public.normalize_artist_role(m.role) = 'owner',
      lower(m.member_email),
      2,
      m.updated_at
    from identity i
    join public.artist_members m
      on i.email <> ''
     and lower(m.member_email) = i.email
     and m.status = 'active'
    join public.artists a on a.id = m.artist_id

  ), deduplicated as (
    select distinct on (c.artist_id)
      c.artist_id,
      c.artist_name,
      c.artist_slug,
      c.role,
      c.is_owner,
      c.member_email,
      c.source_priority,
      c.membership_updated_at
    from candidates c
    order by
      c.artist_id,
      c.source_priority,
      case c.role
        when 'owner' then 1
        when 'manager' then 2
        when 'seller' then 3
        when 'queue_staff' then 4
        else 5
      end,
      c.membership_updated_at desc nulls last
  )
  select
    d.artist_id,
    d.artist_name,
    d.artist_slug,
    d.role,
    d.is_owner,
    d.member_email
  from deduplicated d
  where private.account_management_allowed()
  order by
    case d.role
      when 'owner' then 1
      when 'manager' then 2
      when 'seller' then 3
      when 'queue_staff' then 4
      else 5
    end,
    lower(d.artist_name),
    d.artist_id;
$function$;

-- Direct ownership and email policies must also deny stale sessions.
-- Public permissive policies are preserved, including customer evidence uploads.

alter policy "artists_insert_self" on "public"."artists" with check (private.account_management_allowed() and ((auth.uid() = id)));

alter policy "artists_update_self" on "public"."artists" using (private.account_management_allowed() and ((auth.uid() = id))) with check (private.account_management_allowed() and ((auth.uid() = id)));

alter policy "order_items_owner_manage" on "public"."order_items" using (private.account_management_allowed() and ((EXISTS ( SELECT 1
   FROM (orders o
     JOIN events e ON ((e.id = o.event_id)))
  WHERE ((o.id = order_items.order_id) AND (e.artist_id = auth.uid())))))) with check (private.account_management_allowed() and ((EXISTS ( SELECT 1
   FROM (orders o
     JOIN events e ON ((e.id = o.event_id)))
  WHERE ((o.id = order_items.order_id) AND (e.artist_id = auth.uid()))))));

alter policy "queues_owner_manage" on "public"."queues" using (private.account_management_allowed() and ((auth.uid() = artist_id))) with check (private.account_management_allowed() and ((auth.uid() = artist_id)));

alter policy "orders_owner_manage" on "public"."orders" using (private.account_management_allowed() and ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = orders.event_id) AND (e.artist_id = auth.uid())))))) with check (private.account_management_allowed() and ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = orders.event_id) AND (e.artist_id = auth.uid()))))));

alter policy "menu_owner_insert" on "storage"."objects" with check (private.account_management_allowed() and (((bucket_id = 'Menu'::text) AND (name ~~ 'public/%'::text) AND (owner = auth.uid()))));

alter policy "menu_owner_update" on "storage"."objects" using (private.account_management_allowed() and (((bucket_id = 'Menu'::text) AND (owner = auth.uid())))) with check (private.account_management_allowed() and (((bucket_id = 'Menu'::text) AND (owner = auth.uid()))));

alter policy "menu_owner_delete" on "storage"."objects" using (private.account_management_allowed() and (((bucket_id = 'Menu'::text) AND (owner = auth.uid()))));

alter policy "avatar_owner_insert" on "storage"."objects" with check (private.account_management_allowed() and (((bucket_id = 'Avatar'::text) AND (name ~~ ((auth.uid())::text || '/%'::text)) AND (owner = auth.uid()))));

alter policy "avatar_owner_update" on "storage"."objects" using (private.account_management_allowed() and (((bucket_id = 'Avatar'::text) AND (owner = auth.uid())))) with check (private.account_management_allowed() and (((bucket_id = 'Avatar'::text) AND (owner = auth.uid()))));

alter policy "avatar_owner_delete" on "storage"."objects" using (private.account_management_allowed() and (((bucket_id = 'Avatar'::text) AND (owner = auth.uid()))));

alter policy "artist_members_self_view" on "public"."artist_members" using (private.account_management_allowed() and ((lower(member_email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));

alter policy "creator_applications_self_read" on "public"."creator_applications" using (private.account_management_allowed() and ((auth.uid() = auth_user_id)));

alter policy "event_member_assignments_self_read" on "public"."event_member_assignments" using (private.account_management_allowed() and ((EXISTS ( SELECT 1
   FROM artist_members m
  WHERE ((m.id = event_member_assignments.member_id) AND (m.status = 'active'::text) AND (lower(m.member_email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))))))));

alter policy "creator_applications_self_insert" on "public"."creator_applications" with check (private.account_management_allowed() and (((auth.uid() = auth_user_id) AND (status = 'auto_approved'::text) AND (reviewed_by IS NULL))));

alter policy "platform_admins_self_read" on "public"."platform_admins" using (private.account_management_allowed() and ((auth_user_id = auth.uid())));

create or replace view private.console_users as
SELECT id,
    lower(COALESCE(email, ''::character varying)::text) AS search_text,
        CASE
            WHEN coalesce(r.suspended,false) THEN 'suspended'::text
            ELSE 'active'::text
        END AS filter_status,
    jsonb_build_object('id', id, 'email_masked', private.mask_admin_email(email::text), 'display_name', COALESCE(raw_user_meta_data ->> 'full_name'::text, raw_user_meta_data ->> 'name'::text), 'created_at', created_at, 'last_sign_in_at', last_sign_in_at, 'membership_count', ( SELECT count(*) AS count
           FROM artist_members m
          WHERE lower(m.member_email) = lower(u.email::text) AND m.status = 'active'::text), 'creator_count', ( SELECT count(*) AS count
           FROM artists a
          WHERE a.id = u.id OR (EXISTS ( SELECT 1
                   FROM artist_members m
                  WHERE m.artist_id = a.id AND lower(m.member_email) = lower(u.email::text) AND m.status = 'active'::text AND m.role = 'owner'::text))), 'status',
        CASE
            WHEN coalesce(r.suspended,false) THEN 'suspended'::text
            ELSE 'active'::text
        END, 'suspended', COALESCE(coalesce(r.suspended,false), false), 'suspended_reason', case when r.suspended then r.reason else null end, 'is_platform_admin', (EXISTS ( SELECT 1
           FROM platform_admins p
          WHERE p.auth_user_id = u.id))) AS data,
    created_at
   FROM auth.users u left join private.account_management_restrictions r on r.user_id=u.id;

-- Serialize grants and suspensions with the same lock and recheck both identities.
CREATE OR REPLACE FUNCTION private.change_platform_admin(p_user_id uuid, p_grant boolean, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text;
begin
 perform pg_advisory_xact_lock(76103920261021);
 if not public.is_platform_admin() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_grant is null or length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'reason required'; end if;

 select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'verified account required'; end if;
 if p_grant and exists(select 1 from private.account_management_restrictions where user_id=p_user_id and suspended) then
 raise exception 'restore account management before granting Platform Admin access' using errcode='42501'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION private.bootstrap_platform_admin(p_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_email text;
begin
 perform pg_advisory_xact_lock(76103920261021);
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'reason required'; end if;
 if exists(select 1 from public.platform_admins where auth_user_id is not null) then raise exception 'bootstrap already completed'; end if;
 select email into v_email from auth.users where id=p_user_id and email_confirmed_at is not null;
 if v_email is null then raise exception 'verified account required'; end if;
 if exists(select 1 from private.account_management_restrictions where user_id=p_user_id and suspended) then
 raise exception 'restore account management before granting Platform Admin access' using errcode='42501'; end if;
 insert into public.platform_admins(admin_email,auth_user_id) values(lower(v_email),p_user_id)
 on conflict(admin_email) do update set auth_user_id=excluded.auth_user_id;
 insert into private.platform_admin_audit(actor_id,action,target_type,target_id,summary)
 values(null,'bootstrap_admin','user',p_user_id,trim(p_reason));
end;
$function$;

CREATE OR REPLACE FUNCTION public.auth_user_exists_by_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select private.account_management_allowed() and exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
  );
$function$;

-- A revocable authenticated broker replaces reusable staff bearer links.
-- Customer upload permission is independent and remains unchanged.
drop policy if exists payment_evidence_staff_read on storage.objects;

notify pgrst,'reload schema';
