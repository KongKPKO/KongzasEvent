alter table public.artist_promotions enable row level security;

drop policy if exists "artist_promotions_public_read_active" on public.artist_promotions;

create policy "artist_promotions_public_read_active"
  on public.artist_promotions
  for select
  to anon, authenticated
  using (status = 'active');
