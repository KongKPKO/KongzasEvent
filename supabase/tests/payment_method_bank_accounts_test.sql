begin;

select no_plan();

select has_column(
  'public', 'event_payment_methods', 'bank_accounts',
  'event payment recipients store an array of bank accounts'
);
select has_column(
  'public', 'campaign_payment_methods', 'bank_accounts',
  'campaign payment recipients store an array of bank accounts'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public'
     and table_name = 'event_payment_methods'
     and column_name = 'bank_accounts'),
  'NO',
  'event bank account arrays cannot be null'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public'
     and table_name = 'campaign_payment_methods'
     and column_name = 'bank_accounts'),
  '''[]''::jsonb',
  'campaign bank account arrays default to empty'
);

select ok(
  private.is_valid_payment_bank_accounts('[]'::jsonb),
  'an empty bank account array is valid'
);
select ok(
  private.is_valid_payment_bank_accounts(
    '[{"bank_name":"Test Bank","account_name":"","account_number":""}]'::jsonb
  ),
  'one populated field is enough when all three string keys are present'
);
select isnt(
  private.is_valid_payment_bank_accounts('{}'::jsonb), true,
  'a non-array payload is invalid'
);
select isnt(
  private.is_valid_payment_bank_accounts('["not-an-account"]'::jsonb), true,
  'a non-object array entry is invalid'
);
select isnt(
  private.is_valid_payment_bank_accounts(
    '[{"bank_name":"Test Bank","account_name":"Owner","account_number":"123","note":"unexpected"}]'::jsonb
  ), true,
  'unexpected account keys are invalid'
);
select isnt(
  private.is_valid_payment_bank_accounts(
    '[{"bank_name":7,"account_name":"Owner","account_number":"123"}]'::jsonb
  ), true,
  'non-string account values are invalid'
);
select isnt(
  private.is_valid_payment_bank_accounts(
    '[{"bank_name":" ","account_name":"","account_number":"  "}]'::jsonb
  ), true,
  'an all-blank account entry is invalid'
);

select is(
  (select p.provolatile::text
   from pg_proc p
   where p.oid = 'private.is_valid_payment_bank_accounts(jsonb)'::regprocedure),
  'i',
  'the check validator is immutable'
);
select isnt(
  (select p.prosecdef
   from pg_proc p
   where p.oid = 'private.is_valid_payment_bank_accounts(jsonb)'::regprocedure),
  true,
  'the check validator is security invoker'
);
select ok(
  has_function_privilege(
    'authenticated',
    'private.is_valid_payment_bank_accounts(jsonb)',
    'execute'
  ),
  'authenticated writes may evaluate the bank account check'
);
select isnt(
  (select exists (
     select 1
     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
     where privilege.grantee = 0
       and privilege.privilege_type = 'EXECUTE'
   )
   from pg_proc p
   where p.oid = 'private.is_valid_payment_bank_accounts(jsonb)'::regprocedure),
  true,
  'the validator does not retain an implicit public execute grant'
);

create temp table _payment_bank_ids (
  owner_id uuid,
  artist_id uuid,
  product_id uuid,
  event_id uuid,
  campaign_id uuid,
  event_legacy_method_id uuid,
  event_array_method_id uuid,
  campaign_legacy_method_id uuid,
  campaign_array_method_id uuid,
  campaign_order_id uuid,
  campaign_order_code text,
  preorder_order_id uuid,
  preorder_pickup_code text
) on commit drop;

do $$
declare
  v_owner_id uuid := gen_random_uuid();
  v_artist_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_campaign_id uuid := gen_random_uuid();
  v_event_legacy_method_id uuid;
  v_event_array_method_id uuid;
  v_campaign_legacy_method_id uuid;
  v_campaign_array_method_id uuid;
begin
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role
  ) values (
    v_owner_id, 'payment-banks-owner@nireq.local', 'x', now(), now(), now(),
    '{}', '{}', 'authenticated', 'authenticated'
  );

  insert into public.artists (
    id, slug, display_name, is_public, is_verified, published_at
  ) values (
    v_artist_id, 'payment-banks-artist', 'Payment Banks Artist', true, true, now()
  );

  insert into public.artist_members (artist_id, member_email, role, status)
  values (v_artist_id, 'payment-banks-owner@nireq.local', 'owner', 'active');

  insert into public.products (
    id, artist_id, name, price, currency, stock_total,
    stock_reserved, stock_sold, is_unlimited, status
  ) values (
    v_product_id, v_artist_id, 'Payment Bank Product', 100, 'THB', 50,
    0, 0, false, 'enable'
  );

  insert into public.events (
    id, artist_id, event_name, start_date, end_date, status,
    selling_mode, preorder_enabled, preorder_opens_at, preorder_closes_at,
    preorder_pickup_instructions
  ) values (
    v_event_id, v_artist_id, 'Payment Bank Event',
    now() + interval '1 day', now() + interval '2 days', 'Confirmed',
    'preorder', true, now() - interval '1 hour', now() + interval '12 hours',
    'Show the pickup code.'
  );

  insert into public.event_products (
    event_id, product_id, artist_id, stock_total,
    stock_reserved, stock_sold, is_unlimited, is_enabled
  ) values (
    v_event_id, v_product_id, v_artist_id, 10,
    0, 0, false, true
  );

  insert into public.online_campaigns (
    id, artist_id, name, slug, opens_at, closes_at,
    shipping_enabled, flat_shipping_fee, pickup_enabled, publication_status
  ) values (
    v_campaign_id, v_artist_id, 'Payment Bank Campaign', 'payment-banks',
    now() - interval '1 hour', now() + interval '1 day',
    true, 0, false, 'published'
  );

  insert into public.online_campaign_products (
    campaign_id, product_id, artist_id, stock_total,
    stock_reserved, stock_sold, is_unlimited, is_enabled
  ) values (
    v_campaign_id, v_product_id, v_artist_id, 10,
    0, 0, false, true
  );

  -- Old clients only write the scalar columns. The same shape is used by the
  -- migration backfill for rows that existed before bank_accounts was added.
  insert into public.event_payment_methods (
    event_id, artist_id, method_type, bank_name, account_name, account_number
  ) values (
    v_event_id, v_artist_id, 'bank_transfer',
    'Legacy Event Bank', 'Legacy Event Owner', 'EVENT-LEGACY'
  ) returning id into v_event_legacy_method_id;

  insert into public.event_payment_methods (
    event_id, artist_id, method_type, promptpay_id, bank_accounts
  ) values (
    v_event_id, v_artist_id, 'promptpay', '0812345678',
    '[
      {"bank_name":"Event Bank A","account_name":"Event Owner","account_number":"EVENT-A"},
      {"bank_name":"Event Bank B","account_name":"","account_number":"EVENT-B"}
    ]'::jsonb
  ) returning id into v_event_array_method_id;

  insert into public.event_payment_methods (
    event_id, artist_id, method_type, bank_accounts, is_enabled
  ) values (
    v_event_id, v_artist_id, 'bank_transfer',
    '[{"bank_name":"Hidden Event Bank","account_name":"Owner","account_number":"HIDDEN-EVENT"}]'::jsonb,
    false
  );

  insert into public.campaign_payment_methods (
    campaign_id, artist_id, method_type, bank_name, account_name, account_number
  ) values (
    v_campaign_id, v_artist_id, 'bank_transfer',
    'Legacy Campaign Bank', 'Legacy Campaign Owner', 'CAMPAIGN-LEGACY'
  ) returning id into v_campaign_legacy_method_id;

  insert into public.campaign_payment_methods (
    campaign_id, artist_id, method_type, promptpay_id, bank_accounts
  ) values (
    v_campaign_id, v_artist_id, 'promptpay', '0899999999',
    '[
      {"bank_name":"Campaign Bank A","account_name":"Campaign Owner","account_number":"CAMPAIGN-A"},
      {"bank_name":"Campaign Bank B","account_name":"","account_number":"CAMPAIGN-B"}
    ]'::jsonb
  ) returning id into v_campaign_array_method_id;

  insert into public.campaign_payment_methods (
    campaign_id, artist_id, method_type, bank_accounts, is_enabled
  ) values (
    v_campaign_id, v_artist_id, 'bank_transfer',
    '[{"bank_name":"Hidden Campaign Bank","account_name":"Owner","account_number":"HIDDEN-CAMPAIGN"}]'::jsonb,
    false
  );

  insert into _payment_bank_ids values (
    v_owner_id, v_artist_id, v_product_id, v_event_id, v_campaign_id,
    v_event_legacy_method_id, v_event_array_method_id,
    v_campaign_legacy_method_id, v_campaign_array_method_id,
    null, null, null, null
  );
end;
$$;

select is(
  (select bank_accounts from public.event_payment_methods
   where id = (select event_legacy_method_id from _payment_bank_ids)),
  '[{"bank_name":"Legacy Event Bank","account_name":"Legacy Event Owner","account_number":"EVENT-LEGACY"}]'::jsonb,
  'a legacy event write receives the lossless backfill array shape'
);
select is(
  (select bank_accounts from public.campaign_payment_methods
   where id = (select campaign_legacy_method_id from _payment_bank_ids)),
  '[{"bank_name":"Legacy Campaign Bank","account_name":"Legacy Campaign Owner","account_number":"CAMPAIGN-LEGACY"}]'::jsonb,
  'a legacy campaign write receives the lossless backfill array shape'
);
select is(
  (select account_number from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  'EVENT-A',
  'a new array write synchronizes its first account to legacy columns'
);
select is(
  (select jsonb_array_length(bank_accounts) from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  2,
  'two banks stay grouped inside one event payment recipient'
);

update public.event_payment_methods
set bank_name = 'Legacy Edited Bank',
    account_name = 'Legacy Edited Owner',
    account_number = 'EVENT-EDITED'
where id = (select event_array_method_id from _payment_bank_ids);

select is(
  (select bank_accounts #>> '{0,account_number}' from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  'EVENT-EDITED',
  'a legacy update replaces the first array entry'
);
select is(
  (select bank_accounts #>> '{1,account_number}' from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  'EVENT-B',
  'a legacy update preserves later accounts'
);

update public.event_payment_methods
set bank_name = null, account_name = null, account_number = null
where id = (select event_array_method_id from _payment_bank_ids);

select is(
  (select bank_accounts from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  '[{"bank_name":"Event Bank B","account_name":"","account_number":"EVENT-B"}]'::jsonb,
  'clearing legacy fields removes only the first account'
);
select is(
  (select account_number from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  'EVENT-B',
  'the next account becomes the legacy-compatible first account'
);

update public.event_payment_methods
set bank_accounts = '[
  {"bank_name":"Event Bank C","account_name":"Event Owner","account_number":"EVENT-C"},
  {"bank_name":"Event Bank D","account_name":"Event Owner","account_number":"EVENT-D"}
]'::jsonb
where id = (select event_array_method_id from _payment_bank_ids);

select is(
  (select account_number from public.event_payment_methods
   where id = (select event_array_method_id from _payment_bank_ids)),
  'EVENT-C',
  'a changed array remains authoritative over legacy columns'
);

select throws_ok(
  $$ update public.event_payment_methods
     set bank_accounts = '[{"bank_name":"","account_name":"","account_number":""}]'::jsonb
     where id = (select event_array_method_id from _payment_bank_ids) $$,
  '23514',
  null,
  'the table check rejects an invalid client payload'
);

select set_config('request.jwt.claims', '{}'::text, true);

select is(
  jsonb_array_length(
    public.get_public_online_campaign('payment-banks-artist', 'payment-banks')
      -> 'payment_methods'
  ),
  2,
  'the public campaign groups accounts by enabled recipient and hides disabled methods'
);
select ok(
  public.get_public_online_campaign('payment-banks-artist', 'payment-banks')
    -> 'payment_methods'
    @> '[{"account_number":"CAMPAIGN-A","bank_accounts":[
      {"bank_name":"Campaign Bank A","account_name":"Campaign Owner","account_number":"CAMPAIGN-A"},
      {"bank_name":"Campaign Bank B","account_name":"","account_number":"CAMPAIGN-B"}
    ]}]'::jsonb,
  'the explicit public campaign projection includes the complete bank array'
);

create temp table _campaign_bank_order on commit drop as
select *
from public.create_online_campaign_order(
  (select campaign_id from _payment_bank_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _payment_bank_ids),
    'quantity', 1
  )),
  'shipping', null, 'Campaign Buyer', 'campaign-buyer@nireq.local',
  '0800000000', 'Bangkok', '', gen_random_uuid()
);

update _payment_bank_ids
set campaign_order_id = (select order_id from _campaign_bank_order),
    campaign_order_code = (select order_code from _campaign_bank_order);

select ok(
  (select payment_methods from _campaign_bank_order)
    @> '[{"bank_accounts":[
      {"bank_name":"Campaign Bank A","account_name":"Campaign Owner","account_number":"CAMPAIGN-A"},
      {"bank_name":"Campaign Bank B","account_name":"","account_number":"CAMPAIGN-B"}
    ]}]'::jsonb,
  'campaign order creation returns full bank arrays'
);
select ok(
  public.get_public_online_order_by_code(
    'payment-banks-artist',
    (select campaign_order_code from _payment_bank_ids)
  ) -> 'payment_methods'
    @> '[{"bank_accounts":[{"account_number":"CAMPAIGN-A"},{"account_number":"CAMPAIGN-B"}]}]'::jsonb,
  'the public campaign order projection returns full bank arrays'
);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'email', 'payment-banks-owner@nireq.local',
    'sub', (select owner_id from _payment_bank_ids),
    'role', 'authenticated'
  )::text,
  true
);

select ok(
  public.get_online_campaign_workspace((select campaign_id from _payment_bank_ids))
    -> 'payment_methods'
    @> '[{"bank_accounts":[{"account_number":"CAMPAIGN-A"},{"account_number":"CAMPAIGN-B"}]}]'::jsonb,
  'the authorized campaign workspace returns full bank arrays'
);

select set_config('request.jwt.claims', '{}'::text, true);

create temp table _preorder_bank_order on commit drop as
select *
from public.create_preorder_with_stock(
  (select event_id from _payment_bank_ids),
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _payment_bank_ids),
    'quantity', 1
  )),
  'Preorder Buyer', '0800000001', '', gen_random_uuid(),
  '0800000001', '', 'preorder-buyer@nireq.local', ''
);

update _payment_bank_ids
set preorder_order_id = (select order_id from _preorder_bank_order),
    preorder_pickup_code = (select pickup_code from _preorder_bank_order);

select is(
  jsonb_array_length((select payment_methods from _preorder_bank_order)),
  2,
  'preorder creation returns enabled recipients and hides disabled methods'
);
select ok(
  (select payment_methods from _preorder_bank_order)
    @> '[{"bank_accounts":[{"account_number":"EVENT-C"},{"account_number":"EVENT-D"}]}]'::jsonb,
  'preorder creation returns full bank arrays'
);
select ok(
  (select payment_methods
   from public.get_public_preorder_by_code(
     'payment-banks-artist',
     (select preorder_pickup_code from _payment_bank_ids)
   )) @> '[{"bank_accounts":[{"account_number":"EVENT-C"},{"account_number":"EVENT-D"}]}]'::jsonb,
  'the public preorder projection returns full bank arrays'
);
select ok(
  (select stock_hold_expires_at
   from public.order_payments
   where order_id = (select preorder_order_id from _payment_bank_ids))
    between now() + interval '14 minutes' and now() + interval '16 minutes',
  'multiple bank accounts do not change the existing 15-minute hold'
);

select * from finish();
rollback;
