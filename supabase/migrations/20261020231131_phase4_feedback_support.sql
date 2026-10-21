create table public.feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('bug', 'support', 'suggestion')),
  subject text not null check (char_length(subject) between 5 and 160),
  details text not null check (char_length(details) between 10 and 5000),
  module text check (module is null or char_length(module) between 1 and 80),
  guest_contact text check (guest_contact is null or char_length(guest_contact) between 3 and 255),
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved', 'closed')),
  has_attachment boolean not null default false,
  attachment_sha256 text check (attachment_sha256 is null or char_length(attachment_sha256)=64),
  client_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index feedback_tickets_user_created_idx
  on public.feedback_tickets(user_id, created_at desc)
  where user_id is not null;
create index feedback_tickets_admin_queue_idx
  on public.feedback_tickets(status, created_at desc);

create table public.feedback_ticket_metadata (
  ticket_id uuid primary key references public.feedback_tickets(id) on delete cascade,
  current_url text check (current_url is null or char_length(current_url) <= 500),
  app_version text check (app_version is null or char_length(app_version) <= 100),
  browser_device text check (browser_device is null or char_length(browser_device) <= 200),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  abuse_key_hash text not null check (char_length(abuse_key_hash) = 64),
  created_at timestamptz not null default now()
);

create table public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.feedback_tickets(id) on delete cascade,
  object_path text not null unique check (char_length(object_path) between 1 and 500),
  original_name text not null check (char_length(original_name) between 1 and 180),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (char_length(sha256) = 64),
  created_at timestamptz not null default now()
);

create table public.feedback_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.feedback_tickets(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 2 and 3000),
  created_at timestamptz not null default now()
);
create index feedback_internal_notes_ticket_idx
  on public.feedback_internal_notes(ticket_id, created_at, id);

create table public.feedback_audit_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.feedback_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null check (action in ('created', 'attachment_added', 'status_changed', 'internal_note_added')),
  previous_status text check (previous_status is null or previous_status in ('new', 'in_progress', 'resolved', 'closed')),
  next_status text check (next_status is null or next_status in ('new', 'in_progress', 'resolved', 'closed')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index feedback_audit_events_ticket_idx
  on public.feedback_audit_events(ticket_id, created_at, id);

create table public.feedback_rate_events (
  id bigint generated always as identity primary key,
  scope_hash text not null check (char_length(scope_hash) = 64),
  created_at timestamptz not null default now()
);
create index feedback_rate_events_scope_idx
  on public.feedback_rate_events(scope_hash, created_at desc);

alter table public.feedback_tickets enable row level security;
alter table public.feedback_ticket_metadata enable row level security;
alter table public.feedback_attachments enable row level security;
alter table public.feedback_internal_notes enable row level security;
alter table public.feedback_audit_events enable row level security;
alter table public.feedback_rate_events enable row level security;

-- The account lifecycle migration may be deployed after this module. Resolve its
-- self-check at request time so migration ordering cannot create a permission gap.
create function private.feedback_account_is_active()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare active boolean;
begin
  if to_regprocedure('public.is_account_active()') is null then return false; end if;
  execute 'select public.is_account_active()' into active;
  return coalesce(active, false);
end;
$$;
revoke all on function private.feedback_account_is_active() from public, anon, authenticated;
grant execute on function private.feedback_account_is_active() to authenticated;

create policy feedback_tickets_owner_read
  on public.feedback_tickets for select to authenticated
  using (user_id = (select auth.uid()) and private.feedback_account_is_active());

revoke all on public.feedback_tickets from public, anon, authenticated;
revoke all on public.feedback_ticket_metadata from public, anon, authenticated;
revoke all on public.feedback_attachments from public, anon, authenticated;
revoke all on public.feedback_internal_notes from public, anon, authenticated;
revoke all on public.feedback_audit_events from public, anon, authenticated;
revoke all on public.feedback_rate_events from public, anon, authenticated;
grant select (id, reference, category, subject, details, module, status, has_attachment, created_at, updated_at, resolved_at)
  on public.feedback_tickets to authenticated;
grant select, insert, update, delete on public.feedback_tickets to service_role;
grant select, insert, update, delete on public.feedback_ticket_metadata to service_role;
grant select, insert, update, delete on public.feedback_attachments to service_role;
grant select, insert, update, delete on public.feedback_internal_notes to service_role;
grant select, insert, update, delete on public.feedback_audit_events to service_role;
grant select, insert, update, delete on public.feedback_rate_events to service_role;
grant usage, select on sequence public.feedback_audit_events_id_seq to service_role;
grant usage, select on sequence public.feedback_rate_events_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    updated_at = now();

-- A restrictive policy also protects this bucket from broad legacy storage policies.
create policy feedback_screenshots_server_only on storage.objects as restrictive
for all to anon,authenticated using(bucket_id <> 'feedback-screenshots')
with check(bucket_id <> 'feedback-screenshots');

create function public.feedback_intake(
  p_user_id uuid,
  p_category text,
  p_subject text,
  p_details text,
  p_module text,
  p_guest_contact text,
  p_current_url text,
  p_app_version text,
  p_browser_device text,
  p_context jsonb,
  p_client_request_id uuid,
  p_abuse_scope_hashes text[],
  p_rate_limit integer,
  p_rate_window_seconds integer,
  p_global_scope_hash text default null,
  p_global_rate_limit integer default null,
  p_attachment_sha256 text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.feedback_tickets;
  created public.feedback_tickets;
  v_scope_hash text;
  new_id uuid := gen_random_uuid();
begin
  if p_category not in ('bug', 'support', 'suggestion')
     or char_length(btrim(coalesce(p_subject, ''))) not between 5 and 160
     or char_length(btrim(coalesce(p_details, ''))) not between 10 and 5000
     or (p_module is not null and char_length(btrim(p_module)) not between 1 and 80)
     or (p_guest_contact is not null and char_length(btrim(p_guest_contact)) not between 3 and 255)
     or (p_current_url is not null and char_length(p_current_url) > 500)
     or (p_app_version is not null and char_length(p_app_version) > 100)
     or (p_browser_device is not null and char_length(p_browser_device) > 200)
     or p_client_request_id is null
     or (p_attachment_sha256 is not null and p_attachment_sha256 !~ '^[0-9a-f]{64}$')
     or coalesce(array_length(p_abuse_scope_hashes, 1), 0) < 1
     or p_rate_limit not between 1 and 100
     or p_rate_window_seconds not between 60 and 86400
     or (p_global_scope_hash is not null and char_length(p_global_scope_hash) <> 64)
     or (p_global_scope_hash is not null and p_global_rate_limit not between 1 and 10000)
     or (p_global_scope_hash is null and p_global_rate_limit is not null)
     or p_context is null or jsonb_typeof(p_context) <> 'object'
     or octet_length(p_context::text) > 2000 then
    raise exception 'invalid_feedback';
  end if;
  if exists (
    select 1 from unnest(p_abuse_scope_hashes) value
    where value is null or char_length(value) <> 64
  ) then
    raise exception 'invalid_feedback';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id::text, 41721));

  select * into existing from public.feedback_tickets where client_request_id = p_client_request_id;
  if found then
    if existing.category is distinct from p_category or existing.subject is distinct from btrim(p_subject)
      or existing.details is distinct from btrim(p_details) or existing.module is distinct from nullif(btrim(p_module),'')
      or existing.guest_contact is distinct from nullif(btrim(p_guest_contact),'')
      or existing.attachment_sha256 is distinct from p_attachment_sha256
      or existing.user_id is distinct from p_user_id or (
      p_user_id is null and not exists (
        select 1 from public.feedback_ticket_metadata metadata
        where metadata.ticket_id = existing.id
          and metadata.abuse_key_hash = any(p_abuse_scope_hashes)
      )
    ) then
      raise exception 'request_conflict';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'reference', existing.reference,
      'status', existing.status,
      'created', false,
      'has_attachment', existing.has_attachment
    );
  end if;

  if p_global_scope_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_global_scope_hash, 41721));
    if (
      select count(*) >= p_global_rate_limit
      from public.feedback_rate_events event
      where event.scope_hash = p_global_scope_hash
        and event.created_at >= now() - make_interval(secs => p_rate_window_seconds)
    ) then
      raise exception 'rate_limited';
    end if;
  end if;

  foreach v_scope_hash in array (select array_agg(distinct x order by x) from unnest(p_abuse_scope_hashes) x) loop
    perform pg_advisory_xact_lock(hashtextextended(v_scope_hash, 41721));
    if (
      select count(*) >= p_rate_limit
      from public.feedback_rate_events event
      where event.scope_hash = v_scope_hash
        and event.created_at >= now() - make_interval(secs => p_rate_window_seconds)
    ) then
      raise exception 'rate_limited';
    end if;
  end loop;

  insert into public.feedback_tickets (
    id, reference, user_id, category, subject, details, module, guest_contact, client_request_id, attachment_sha256
  ) values (
    new_id, 'FB-' || upper(replace(new_id::text, '-', '')), p_user_id, p_category, btrim(p_subject), btrim(p_details), nullif(btrim(p_module), ''),
    nullif(btrim(p_guest_contact), ''), p_client_request_id, p_attachment_sha256
  ) returning * into created;

  insert into public.feedback_ticket_metadata (
    ticket_id, current_url, app_version, browser_device, context, abuse_key_hash
  ) values (
    created.id, nullif(p_current_url, ''), nullif(p_app_version, ''), nullif(p_browser_device, ''),
    p_context, p_abuse_scope_hashes[1]
  );
  insert into public.feedback_rate_events(scope_hash)
    select distinct value from unnest(p_abuse_scope_hashes) value;
  if p_global_scope_hash is not null and not (p_global_scope_hash = any(p_abuse_scope_hashes)) then
    insert into public.feedback_rate_events(scope_hash) values (p_global_scope_hash);
  end if;
  insert into public.feedback_audit_events(ticket_id, actor_id, action, next_status, details)
  values (created.id, p_user_id, 'created', 'new', jsonb_build_object('category', created.category));

  return jsonb_build_object(
    'id', created.id,
    'reference', created.reference,
    'status', created.status,
    'created', true,
    'has_attachment', false
  );

end;
$$;

create function public.feedback_mark_attachment(
  p_ticket_id uuid,
  p_object_path text,
  p_original_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256 text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare attachment_id uuid;
declare existing_attachment public.feedback_attachments;
begin
  perform 1 from public.feedback_tickets where id=p_ticket_id and attachment_sha256=p_sha256 for update;
  if not found then raise exception 'attachment_mismatch'; end if;
  select * into existing_attachment from public.feedback_attachments where ticket_id=p_ticket_id;
  if found then
    if existing_attachment.sha256<>p_sha256 or existing_attachment.object_path<>p_object_path then raise exception 'attachment_mismatch'; end if;
    return existing_attachment.id;
  end if;
  insert into public.feedback_attachments (
    ticket_id, object_path, original_name, content_type, size_bytes, sha256
  ) values (
    p_ticket_id, p_object_path, p_original_name, p_content_type, p_size_bytes, p_sha256
  ) returning id into attachment_id;
  update public.feedback_tickets set has_attachment = true, updated_at = now() where id = p_ticket_id;
  if not found then raise exception 'ticket_not_found'; end if;
  insert into public.feedback_audit_events(ticket_id, action, details)
  values (p_ticket_id, 'attachment_added', jsonb_build_object('attachment_id', attachment_id));
  return attachment_id;
end;
$$;

create function public.feedback_admin_list(
  p_query text default null,
  p_status text default null,
  p_category text default null,
  p_page integer default 1,
  p_page_size integer default 20
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare normalized_query text := lower(btrim(coalesce(p_query, '')));
declare total_count bigint;
declare rows jsonb;
begin
  if char_length(normalized_query) > 160
     or (p_status is not null and p_status not in ('new', 'in_progress', 'resolved', 'closed'))
     or (p_category is not null and p_category not in ('bug', 'support', 'suggestion'))
     or p_page not between 1 and 100000
     or p_page_size not between 1 and 50 then
    raise exception 'invalid_filter';
  end if;

  select count(*) into total_count
  from public.feedback_tickets ticket
  where (p_status is null or ticket.status = p_status)
    and (p_category is null or ticket.category = p_category)
    and (normalized_query = ''
      or strpos(lower(ticket.reference), normalized_query) > 0
      or strpos(lower(ticket.subject), normalized_query) > 0
      or strpos(lower(coalesce(ticket.guest_contact, '')), normalized_query) > 0);

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc, item.id desc), '[]'::jsonb)
  into rows
  from (
    select ticket.id, ticket.reference, ticket.category, ticket.subject, ticket.module,
      ticket.status, ticket.has_attachment, ticket.user_id is not null as authenticated,
      ticket.created_at, ticket.updated_at
    from public.feedback_tickets ticket
    where (p_status is null or ticket.status = p_status)
      and (p_category is null or ticket.category = p_category)
      and (normalized_query = ''
        or strpos(lower(ticket.reference), normalized_query) > 0
        or strpos(lower(ticket.subject), normalized_query) > 0
        or strpos(lower(coalesce(ticket.guest_contact, '')), normalized_query) > 0)
    order by ticket.created_at desc, ticket.id desc
    limit p_page_size offset ((p_page - 1) * p_page_size)
  ) item;

  return jsonb_build_object('items', rows, 'total', total_count, 'page', p_page, 'page_size', p_page_size);
end;
$$;

create function public.feedback_admin_detail(p_ticket_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', ticket.id, 'reference', ticket.reference, 'user_id', ticket.user_id,
      'category', ticket.category, 'subject', ticket.subject, 'details', ticket.details,
      'module', ticket.module, 'guest_contact', ticket.guest_contact, 'status', ticket.status,
      'has_attachment', ticket.has_attachment, 'created_at', ticket.created_at,
      'updated_at', ticket.updated_at, 'resolved_at', ticket.resolved_at
    ),
    'metadata', jsonb_build_object(
      'current_url', metadata.current_url, 'app_version', metadata.app_version,
      'browser_device', metadata.browser_device, 'context', metadata.context
    ),
    'attachment', (
      select to_jsonb(attachment) - 'object_path' - 'sha256'
      from public.feedback_attachments attachment where attachment.ticket_id = ticket.id
    ),
    'notes', coalesce((
      select jsonb_agg(to_jsonb(note) order by note.created_at, note.id)
      from public.feedback_internal_notes note where note.ticket_id = ticket.id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(event) order by event.created_at, event.id)
      from public.feedback_audit_events event where event.ticket_id = ticket.id
    ), '[]'::jsonb)
  )
  from public.feedback_tickets ticket
  left join public.feedback_ticket_metadata metadata on metadata.ticket_id = ticket.id
  where ticket.id = p_ticket_id;
$$;

create table public.feedback_admin_requests (
 request_id uuid primary key, ticket_id uuid not null references public.feedback_tickets(id) on delete cascade,
 actor_id uuid not null, payload_hash text not null, created_at timestamptz not null default now()
);
alter table public.feedback_admin_requests enable row level security;
revoke all on public.feedback_admin_requests from public,anon,authenticated;
grant select,insert on public.feedback_admin_requests to service_role;

create function public.feedback_admin_action(
  p_ticket_id uuid,
  p_actor_id uuid,
  p_status text default null,
  p_note text default null,
  p_expected_status text default null,
  p_request_id uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare ticket public.feedback_tickets;
declare note_id uuid;
declare existing_request public.feedback_admin_requests;
declare v_payload_hash text := md5(jsonb_build_array(p_actor_id,p_status,p_note,p_expected_status)::text);
declare normalized_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_actor_id is null or p_request_id is null
     or (p_status is null and normalized_note is null)
     or (p_status is not null and p_status not in ('new', 'in_progress', 'resolved', 'closed'))
     or (normalized_note is not null and char_length(normalized_note) not between 2 and 3000) then
    raise exception 'invalid_action';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 41722));
  select * into ticket from public.feedback_tickets where id = p_ticket_id for update;
  if not found then return null; end if;
  select * into existing_request from public.feedback_admin_requests where request_id=p_request_id;
  if found then
    if existing_request.actor_id<>p_actor_id or existing_request.ticket_id<>p_ticket_id or existing_request.payload_hash<>v_payload_hash then raise exception 'request_conflict'; end if;
    return public.feedback_admin_detail(ticket.id);
  end if;
  if p_status is not null and p_expected_status is distinct from ticket.status then raise exception 'status_conflict'; end if;
  insert into public.feedback_admin_requests(request_id,ticket_id,actor_id,payload_hash) values(p_request_id,p_ticket_id,p_actor_id,v_payload_hash);

  if p_status is not null and p_status <> ticket.status then
    update public.feedback_tickets
    set status = p_status,
        updated_at = now(),
        resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
    where id = ticket.id;
    insert into public.feedback_audit_events(ticket_id, actor_id, action, previous_status, next_status)
    values (ticket.id, p_actor_id, 'status_changed', ticket.status, p_status);
  end if;

  if normalized_note is not null then
    insert into public.feedback_internal_notes(ticket_id, actor_id, body)
    values (ticket.id, p_actor_id, normalized_note) returning id into note_id;
    insert into public.feedback_audit_events(ticket_id, actor_id, action, details)
    values (ticket.id, p_actor_id, 'internal_note_added', jsonb_build_object('note_id', note_id));
  end if;
  return public.feedback_admin_detail(ticket.id);
end;
$$;

revoke all on function public.feedback_intake(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text[],integer,integer,text,integer,text) from public, anon, authenticated;
revoke all on function public.feedback_mark_attachment(uuid,text,text,text,bigint,text) from public, anon, authenticated;
revoke all on function public.feedback_admin_list(text,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.feedback_admin_detail(uuid) from public, anon, authenticated;
revoke all on function public.feedback_admin_action(uuid,uuid,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.feedback_intake(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text[],integer,integer,text,integer,text) to service_role;
grant execute on function public.feedback_mark_attachment(uuid,text,text,text,bigint,text) to service_role;
grant execute on function public.feedback_admin_list(text,text,text,integer,integer) to service_role;
grant execute on function public.feedback_admin_detail(uuid) to service_role;
grant execute on function public.feedback_admin_action(uuid,uuid,text,text,text,uuid) to service_role;
