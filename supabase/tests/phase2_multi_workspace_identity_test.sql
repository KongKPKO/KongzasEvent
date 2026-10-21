begin;
select no_plan();

insert into auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
) values
  ('d2000000-0000-4000-8000-000000000001', 'phase2.multi@example.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-000000000002', 'phase2.owner.b@example.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('d2000000-0000-4000-8000-000000000003', 'phase2.owner.c@example.test', 'x', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.artists (id, slug, display_name, email) values
  ('d2000000-0000-4000-8000-000000000001', 'phase2-owner-a', 'Phase2 Owner A', 'phase2.multi@example.test'),
  ('d2000000-0000-4000-8000-000000000002', 'phase2-staff-b', 'Phase2 Staff B', 'phase2.owner.b@example.test'),
  ('d2000000-0000-4000-8000-000000000003', 'phase2-denied-c', 'Phase2 Denied C', 'phase2.owner.c@example.test');

insert into public.artist_members (artist_id, member_email, role, status) values
  ('d2000000-0000-4000-8000-000000000001', 'phase2.multi@example.test', 'owner', 'active'),
  ('d2000000-0000-4000-8000-000000000002', 'phase2.multi@example.test', 'seller', 'active');

insert into public.events (id, artist_id, event_name, start_date, end_date, status) values
  ('d2100000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Owner A live event', now() - interval '1 hour', now() + interval '1 day', 'Confirmed'),
  ('d2100000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'Staff B live event', now() - interval '1 hour', now() + interval '1 day', 'Confirmed');

set local role anon;
select throws_ok(
  $$ select * from public.list_actor_workspaces() $$,
  '42501',
  null,
  'anonymous cannot enumerate actor workspaces'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"d2000000-0000-4000-8000-000000000001","email":"phase2.multi@example.test","aal":"aal1"}',
  true
);

select is(
  (select count(*) from public.list_actor_workspaces()),
  2::bigint,
  'multi-workspace account lists each authorized artist once'
);

select results_eq(
  $$ select artist_id, role, is_owner from public.list_actor_workspaces() order by artist_id $$,
  $$ values
    ('d2000000-0000-4000-8000-000000000001'::uuid, 'owner'::text, true),
    ('d2000000-0000-4000-8000-000000000002'::uuid, 'seller'::text, false) $$,
  'workspace list preserves the role for owner A and staff B'
);

select results_eq(
  $$ select artist_id, role from public.resolve_actor_workspace('d2000000-0000-4000-8000-000000000002') $$,
  $$ values ('d2000000-0000-4000-8000-000000000002'::uuid, 'seller'::text) $$,
  'server resolves an explicitly selected authorized workspace'
);

select throws_ok(
  $$ select * from public.resolve_actor_workspace('d2000000-0000-4000-8000-000000000003') $$,
  '42501',
  'workspace access denied',
  'server rejects an unauthorized selected workspace'
);

select results_eq(
  $$ select artist_id, role from public.get_actor_context() $$,
  $$ values ('d2000000-0000-4000-8000-000000000001'::uuid, 'owner'::text) $$,
  'legacy context uses the same deterministic workspace source'
);

select results_eq(
  $$ select id from public.list_accessible_pos_events('d2000000-0000-4000-8000-000000000001') $$,
  $$ values ('d2100000-0000-4000-8000-000000000001'::uuid) $$,
  'owner A live event listing stays in owner A workspace'
);

select results_eq(
  $$ select id from public.list_accessible_pos_events('d2000000-0000-4000-8000-000000000002') $$,
  $$ values ('d2100000-0000-4000-8000-000000000002'::uuid) $$,
  'staff B live event listing stays in staff B workspace'
);

select is(
  public.has_event_role_for_workspace(
    'd2100000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    array['owner', 'manager', 'seller']
  ),
  false,
  'event routes reject a cross-workspace event even when the account can access both'
);

reset role;
update public.artist_members
set status = 'inactive'
where artist_id = 'd2000000-0000-4000-8000-000000000002'
  and lower(member_email) = 'phase2.multi@example.test';
set local role authenticated;

select is(
  (select count(*) from public.list_actor_workspaces()),
  1::bigint,
  'revoked workspace disappears from the authorized list'
);

select throws_ok(
  $$ select * from public.resolve_actor_workspace('d2000000-0000-4000-8000-000000000002') $$,
  '42501',
  'workspace access denied',
  'revoked selection fails instead of falling back to another shop'
);

select * from finish();
rollback;
