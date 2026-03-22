alter table public.artist_promotions
  add column if not exists match_product_ids uuid[];

update public.artist_promotions
set match_product_ids = case
  when match_product_id is not null then array[match_product_id]
  else null
end
where target_type = 'product'
  and (match_product_ids is null or array_length(match_product_ids, 1) is null);

drop index if exists idx_artist_promotions_match_product;

create index if not exists idx_artist_promotions_match_products_gin
  on public.artist_promotions using gin (match_product_ids);

alter table public.artist_promotions
  drop constraint if exists artist_promotions_target_fields_check;

alter table public.artist_promotions
  add constraint artist_promotions_target_fields_check check (
    (target_type = 'category' and match_category is not null and match_tag is null and match_product_id is null and (match_product_ids is null or array_length(match_product_ids, 1) is null))
    or (target_type = 'tag' and match_tag is not null and match_category is null and match_product_id is null and (match_product_ids is null or array_length(match_product_ids, 1) is null))
    or (target_type = 'category_tag' and match_category is not null and match_tag is not null and match_product_id is null and (match_product_ids is null or array_length(match_product_ids, 1) is null))
    or (target_type = 'product' and (
      match_product_id is not null
      or (match_product_ids is not null and array_length(match_product_ids, 1) > 0)
    ) and match_category is null and match_tag is null)
  );
