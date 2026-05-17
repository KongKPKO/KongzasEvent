drop policy if exists "creator_applications_public_insert" on public.creator_applications;

create policy "creator_applications_public_insert"
  on public.creator_applications
  for insert
  to anon
  with check (
    auth_user_id is not null
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and review_note is null
  );

grant insert on public.creator_applications to anon;
