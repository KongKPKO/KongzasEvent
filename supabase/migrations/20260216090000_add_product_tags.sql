alter table public.products
  add column if not exists tags text[] not null default '{}';

update public.products
set tags = '{}'
where tags is null;

create index if not exists idx_products_tags_gin
  on public.products using gin (tags);
