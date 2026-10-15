-- Keep the existing string contract; an empty address means no extra details.
alter table public.campaign_pickup_points
  drop constraint campaign_pickup_points_address_check;
alter table public.campaign_pickup_points
  alter column address set default '';
comment on column public.campaign_pickup_points.address is 'Optional location details. The pickup point name remains required.';
comment on column public.campaign_pickup_points.starts_at is 'Start of the customer pickup appointment, not the start of checkout eligibility.';
comment on column public.campaign_pickup_points.ends_at is 'End of the customer pickup appointment, not the end of checkout eligibility.';
