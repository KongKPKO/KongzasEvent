begin;
select no_plan();
create function pg_temp.reward(options jsonb, choices jsonb, mode text default 'customer_choice')
returns jsonb language sql as $$
  select private.resolve_promotion_rewards('f0000000-0000-4000-8000-000000000001',null,mode,2,options,
    jsonb_build_array(choices || '{"promotion_id":"f0000000-0000-4000-8000-000000000001"}'::jsonb));
$$;
select is(pg_temp.reward('[{"product_id":"A","available":1},{"product_id":"B","available":1}]','{"product_ids":["A","B"]}')->>'resolved','true','A1 B1 fulfills two gifts');
select is(pg_temp.reward('[{"product_id":"A","available":1},{"product_id":"B","available":1}]','{"product_ids":["A","A"]}')->>'resolved','false','cannot overdraw A');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"product_ids":["A"]}')->>'resolved','false','partial requires explicit acceptance');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"product_ids":["A"]}')->>'available_quantity','1','partial reports remaining quantity');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"product_ids":["A"],"accepted_quantity":1,"accepted_earned_quantity":2}')->>'resolved','true','accepted partial resolves');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"product_ids":["A"],"accepted_quantity":2,"accepted_earned_quantity":2}')->>'resolved','false','old acceptance is rejected after capacity drops');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"product_ids":["A"],"accepted_quantity":1,"accepted_earned_quantity":3}')->>'resolved','false','changed entitlement requires new acceptance');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{}','fixed')->>'resolved','false','fixed partial is not silently awarded');
select is(pg_temp.reward('[{"product_id":"A","available":1}]','{"accepted_quantity":1,"accepted_earned_quantity":2}','fixed')->>'resolved','true','fixed partial can be accepted');
select is(pg_temp.reward('[{"product_id":"A","available":2}]','{}','fixed')->>'resolved','true','full fixed remains automatic');
select is(pg_temp.reward('[]','{}')->>'exhausted','true','no gifts remains exhausted');
select is(pg_temp.reward('[{"product_id":"A","is_unlimited":true,"available":null}]','{"product_ids":["A","A"]}')->>'resolved','true','unlimited is bounded by entitlement only');
select is(pg_temp.reward('[{"product_id":"A","available":2}]','{"product_ids":["A","X"]}')->>'resolved','false','unknown reward cannot be injected');
select * from finish();
rollback;
