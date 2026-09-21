-- All new image writes go through the bounded WebP validation endpoint.
create table public.image_uploads (
  id uuid primary key,
  artist_id uuid not null references public.artists(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  actor_id uuid,
  purpose text not null check (purpose in ('avatar', 'product', 'qr', 'evidence')),
  bucket text not null,
  path text not null unique,
  content_hash text not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);
alter table public.image_uploads enable row level security;
revoke all on public.image_uploads from public, anon, authenticated;
create index image_uploads_artist_created on public.image_uploads(artist_id, created_at);
create index image_uploads_order_created on public.image_uploads(order_id, created_at);

create function public.reserve_image_upload(
  p_id uuid, p_purpose text, p_artist_id uuid, p_order_id uuid, p_code text, p_hash text
) returns table(bucket text, path text, uploaded boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_artist uuid;
  v_row public.image_uploads;
  v_bucket text;
  v_path text;
begin
  if p_id is null or p_hash !~ '^[a-f0-9]{64}$' or p_purpose not in ('avatar','product','qr','evidence') then
    raise exception 'invalid_upload';
  end if;
  if p_purpose = 'evidence' then
    select op.artist_id into v_artist from public.orders o
      join public.order_payments op on op.order_id = o.id
      where o.id = p_order_id and upper(o.pickup_code) = upper(trim(p_code))
        and op.payment_status in ('awaiting_payment','payment_expired','payment_rejected')
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
  if p_purpose = 'evidence' and (select count(*) from public.image_uploads where order_id = p_order_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'upload_limit_reached';
  end if;
  if p_purpose <> 'evidence' and (select count(*) from public.image_uploads where artist_id = v_artist and purpose <> 'evidence' and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'upload_limit_reached';
  end if;
  insert into public.image_uploads(id,artist_id,order_id,actor_id,purpose,bucket,path,content_hash)
    values(p_id,v_artist,p_order_id,auth.uid(),p_purpose,v_bucket,v_path,p_hash);
  return query select v_bucket, v_path, false;
end $$;
revoke all on function public.reserve_image_upload(uuid,text,uuid,uuid,text,text) from public;
grant execute on function public.reserve_image_upload(uuid,text,uuid,uuid,text,text) to anon, authenticated;

-- Restrictive policies apply even if an older permissive write policy exists.
create policy validated_images_insert_only on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('Menu','Avatar','PaymentEvidence'));
create policy validated_images_update_only on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id not in ('Menu','Avatar','PaymentEvidence'));

-- Newly uploaded catalog files are tenant-scoped, even though uploaded by the service.
create policy validated_catalog_image_delete on storage.objects for delete to authenticated using (
  bucket_id = 'Menu' and exists(select 1 from public.image_uploads u
    where u.path = storage.objects.name and u.bucket = storage.objects.bucket_id
    and public.has_artist_role(u.artist_id, array['owner','manager']))
);
create policy image_upload_owner_read on public.image_uploads for select to authenticated
  using(public.has_artist_role(artist_id,array['owner','manager']));
grant select on public.image_uploads to authenticated;

update storage.buckets set allowed_mime_types = array['image/webp'], updated_at = now()
  where id in ('Menu','Avatar','PaymentEvidence');

-- Public submission cannot attach someone else's object or an arbitrary URL.
create function private.enforce_payment_image_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.slip_url is not null and (tg_op = 'INSERT' or new.slip_url is distinct from old.slip_url)
    and coalesce(auth.role(), '') in ('anon','authenticated') then
    if not exists(select 1 from public.image_uploads u where u.order_id = new.order_id
      and u.path = new.slip_url and u.purpose = 'evidence' and u.uploaded_at is not null) then
      raise exception 'validated_payment_image_required';
    end if;
  end if;
  return new;
end $$;
create trigger enforce_payment_image_upload before insert or update of slip_url on public.order_payments
  for each row execute function private.enforce_payment_image_upload();
