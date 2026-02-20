-- Helper RPC for Team Management: verify target staff email exists in auth.users
create or replace function public.auth_user_exists_by_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.auth_user_exists_by_email(text) from public;
grant execute on function public.auth_user_exists_by_email(text) to authenticated;
