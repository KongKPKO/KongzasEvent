-- supabase/migrations/20260509220000_team_invitations.sql

-- ─── Table ────────────────────────────────────────────────────────────────────

create table public.artist_member_invitations (
  id            uuid        primary key default gen_random_uuid(),
  artist_id     uuid        not null references public.artists(id) on delete cascade,
  invited_email text        not null,
  role          text        not null check (role in ('manager', 'seller', 'queue_staff')),
  invited_by    uuid        references auth.users(id),
  status        text        not null default 'pending'
                            check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  invited_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  declined_at   timestamptz,
  cancelled_at  timestamptz,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Prevents duplicate pending invites; allows clean re-invite after cancel
create unique index artist_member_invitations_pending_uidx
  on public.artist_member_invitations (artist_id, lower(invited_email))
  where status = 'pending';

-- Fast lookup when a user logs in and checks for their invitations
create index artist_member_invitations_email_idx
  on public.artist_member_invitations (lower(invited_email));

-- ─── updated_at trigger ───────────────────────────────────────────────────────

-- Reuse the existing set_updated_at_timestamp() function
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_artist_member_invitations_updated_at'
  ) then
    create trigger trg_artist_member_invitations_updated_at
      before update on public.artist_member_invitations
      for each row execute function public.set_updated_at_timestamp();
  end if;
end $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

-- Enable RLS; all access is through security-definer RPCs (no direct client writes)
alter table public.artist_member_invitations enable row level security;
