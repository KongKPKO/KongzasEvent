begin;

select plan(4);

select has_table(
  'public',
  'online_campaigns',
  'online campaigns are stored separately from physical events'
);

select has_table(
  'public',
  'online_campaign_products',
  'campaign stock allocation has its own table'
);

select has_table(
  'public',
  'campaign_pickup_points',
  'campaign pickup choices have their own table'
);

select has_table(
  'public',
  'campaign_payment_methods',
  'campaign payment instructions have their own table'
);

select * from finish();

rollback;
