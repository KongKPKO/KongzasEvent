-- Account discovery allows an admin to enroll MFA without granting privileged access.
create function private.is_platform_admin_account()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.platform_admins pa
    where lower(pa.admin_email) = lower(coalesce(auth.jwt()->>'email', ''))
      and (pa.auth_user_id is null or pa.auth_user_id = auth.uid())
  );
$$;
revoke all on function private.is_platform_admin_account() from public, anon, authenticated;
grant execute on function private.is_platform_admin_account() to authenticated;

create function public.is_platform_admin_account()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_platform_admin_account();
$$;
revoke all on function public.is_platform_admin_account() from public, anon, authenticated;
grant execute on function public.is_platform_admin_account() to authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    and private.is_platform_admin_account();
$$;
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to anon, authenticated;
