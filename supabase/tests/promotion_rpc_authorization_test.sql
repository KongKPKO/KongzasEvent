begin;
select no_plan();

insert into public.artists (id, slug, display_name, is_public, is_verified, published_at)
values ('d0000000-0000-4000-8000-000000000001', 'rpc-auth-rollback', 'RPC auth test', true, true, now());
insert into public.artist_members (artist_id, member_email, role, status)
values
('d0000000-0000-4000-8000-000000000001', 'manager@rpc.test', 'manager', 'active'),
('d0000000-0000-4000-8000-000000000001', 'seller@rpc.test', 'seller', 'active');
insert into public.online_campaigns (id, artist_id, name, slug, opens_at, closes_at, publication_status)
values ('d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
  'Auth test', 'rpc-auth-test', now() - interval '1 hour', now() + interval '1 day', 'draft');
insert into public.artist_promotions (id, artist_id, name, target_type, rule_type, promotion_type, buy_quantity, reward_value, lifecycle_status)
values ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
  'Auth test', 'all', 'discount', 'quantity_discount', 3, 50, 'ready');
insert into public.promotion_assignments (id, promotion_id, artist_id, campaign_id)
values ('d0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000003',
  'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

-- Exercise public wrappers, not just a helper's return value.
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$select public.promotion_assignment_conflicts('d0000000-0000-4000-8000-000000000004')$$,
  'P0001', 'forbidden', 'missing identity cannot inspect assignments');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000099","email":"other@rpc.test","role":"authenticated"}', true);
select throws_ok($$select public.promotion_assignment_conflicts('d0000000-0000-4000-8000-000000000004')$$,
  'P0001', 'forbidden', 'unrelated user cannot inspect another store');
select throws_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$,
  'P0001', 'promotion_context_closed', 'unrelated user cannot quote a draft');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select public.promotion_assignment_conflicts('d0000000-0000-4000-8000-000000000004')$$, 'owner can inspect assignments');
select lives_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$, 'owner can preview a draft');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000098","email":"manager@rpc.test","role":"authenticated"}', true);
select lives_ok($$select public.promotion_assignment_conflicts('d0000000-0000-4000-8000-000000000004')$$, 'manager can inspect assignments');
select lives_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$, 'manager can preview a draft');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000097","email":"seller@rpc.test","role":"authenticated"}', true);
select throws_ok($$select public.promotion_assignment_conflicts('d0000000-0000-4000-8000-000000000004')$$,
  'P0001', 'forbidden', 'seller cannot manage promotion conflicts');
select lives_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$, 'seller retains operational quoting');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$,
  'P0001', 'promotion_context_closed', 'anonymous cannot quote draft');
select ok(not has_function_privilege('anon','public.promotion_assignment_conflicts(uuid)','execute'), 'anonymous cannot execute management RPC');
select ok(not has_function_privilege('authenticated','public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)','execute'), 'calculator stays internal');
reset role;
update public.online_campaigns set publication_status = 'published' where id = 'd0000000-0000-4000-8000-000000000002';
set local role anon;
select lives_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$, 'anonymous can quote an open public campaign');
reset role;
update public.online_campaigns set closes_at = now() - interval '1 minute' where id = 'd0000000-0000-4000-8000-000000000002';
set local role anon;
select throws_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$,
  'P0001', 'promotion_context_closed', 'anonymous cannot quote an ended campaign');
reset role;
-- The same calculator serves all three event phases.
insert into public.events (id, artist_id, event_name, status, start_date, end_date,
  is_booth_open, preorder_enabled, preorder_opens_at, preorder_closes_at,
  postorder_enabled, postorder_opens_at, postorder_closes_at)
values ('d0000000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001',
  'Public event', 'Confirmed', now() - interval '1 hour', now() + interval '1 day',
  true, true, now() - interval '1 hour', now() + interval '1 day',
  true, now() - interval '1 hour', now() + interval '1 day');
set local role anon;
select lives_ok(format('select public.quote_sale_promotions(%L,%L,null,%L,%L,%L)',
  'd0000000-0000-4000-8000-000000000005', phase, '[]', '[]', '[]'),
  'public event quote works: ' || phase)
from unnest(array['live','preorder','postorder']) phase;
select ok(not has_function_privilege('anon','public.calculate_sale_promotions(uuid,text,uuid,jsonb,jsonb,jsonb)','execute'), 'anonymous cannot call calculator directly');
reset role;
update public.events set is_booth_open = false, preorder_enabled = false, postorder_enabled = false
where id = 'd0000000-0000-4000-8000-000000000005';
set local role anon;
select throws_ok(format('select public.quote_sale_promotions(%L,%L,null,%L,%L,%L)',
  'd0000000-0000-4000-8000-000000000005', phase, '[]', '[]', '[]'),
  'P0001', 'promotion_context_closed', 'disabled event phase is rejected: ' || phase)
from unnest(array['live','preorder','postorder']) phase;
reset role;
update public.online_campaigns set closes_at = now() + interval '1 day'
where id = 'd0000000-0000-4000-8000-000000000002';
update public.artists set is_public = false where id = 'd0000000-0000-4000-8000-000000000001';
set local role anon;
select throws_ok($$select public.quote_sale_promotions(null,null,'d0000000-0000-4000-8000-000000000002','[]','[]','[]')$$,
  'P0001', 'promotion_context_closed', 'private store is not publicly quotable');
reset role;
select * from finish();
rollback;
