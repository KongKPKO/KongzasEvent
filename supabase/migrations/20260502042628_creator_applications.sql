create table if not exists public.creator_applications (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  contact_name text not null,
  creator_name text not null,
  desired_slug text not null,
  primary_social_url text not null,
  website_url text,
  instagram_url text,
  x_url text,
  facebook_url text,
  tiktok_url text,
  application_note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_applications_email_format_chk check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint creator_applications_slug_format_chk check (desired_slug ~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'),
  constraint creator_applications_note_len_chk check (char_length(trim(application_note)) between 20 and 1200),
  constraint creator_applications_primary_social_url_chk check (primary_social_url ~* '^https?://')
);

create unique index if not exists creator_applications_pending_email_uidx
  on public.creator_applications (lower(email))
  where status = 'pending';

create index if not exists creator_applications_status_created_idx
  on public.creator_applications (status, created_at desc);

create trigger trg_creator_applications_updated_at
  before update on public.creator_applications
  for each row
  execute function public.set_updated_at_timestamp();

alter table public.creator_applications enable row level security;

drop policy if exists "creator_applications_self_insert" on public.creator_applications;
drop policy if exists "creator_applications_self_read" on public.creator_applications;

create policy "creator_applications_self_insert"
  on public.creator_applications
  for insert
  to authenticated
  with check (auth.uid() = auth_user_id);

create policy "creator_applications_self_read"
  on public.creator_applications
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

grant select, insert on public.creator_applications to authenticated;
