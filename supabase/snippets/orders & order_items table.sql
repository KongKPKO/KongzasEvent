-- -- ⚠️ CLEANUP: ล้างของเก่าทิ้งก่อน
-- drop table if exists order_items;
-- drop table if exists orders;
-- -- drop table if exists products; -- ⚠️ Uncomment บรรทัดนี้ถ้าอยากล้างตาราง products เดิมทิ้งแล้วสร้างใหม่

-- -- 🛠️ 1. CREATE PRODUCTS
-- create table if not exists products (
--   id uuid default gen_random_uuid() primary key,
--   created_at timestamp with time zone default timezone('utc'::text, now()) not null,
--   artist_id uuid references artists(id),
--   name text not null,
--   price decimal default 0,
--   image_url text,
  
--   -- ✅ FIX: เก็บเป็น Text 'enable' / 'disable'
--   status text default 'enable', 
  
--   is_out_of_stock boolean default false
-- );

-- -- 🛒 2. CREATE ORDERS
-- create table orders (
--   id uuid default gen_random_uuid() primary key,
--   created_at timestamp with time zone default timezone('utc'::text, now()) not null,
--   event_id uuid references events(id) not null,
--   queue_id uuid references queues(id),
--   status text default 'draft', 
--   total_price decimal default 0,
--   payment_method text 
-- );

-- -- 📦 3. CREATE ORDER ITEMS
-- create table order_items (
--   id uuid default gen_random_uuid() primary key,
--   order_id uuid references orders(id) on delete cascade not null,
--   product_id uuid references products(id) not null,
--   quantity int default 1,
--   price_per_unit decimal default 0,
--   notes text
-- );

-- -- 🔐 4. ENABLE RLS
-- alter table products enable row level security;
-- alter table orders enable row level security;
-- alter table order_items enable row level security;

-- create policy "Public Read Products" on products for select using (true);
-- create policy "Public Write Products" on products for all using (true) with check (true);
-- create policy "Public Access Orders" on orders for all using (true) with check (true);
-- create policy "Public Access OrderItems" on order_items for all using (true) with check (true);


-- lot#2
-- 1. เคลียร์ Policy เก่าออกก่อน (กันซ้ำ)
drop policy if exists "Public Access Orders" on orders;
drop policy if exists "Public Access OrderItems" on order_items;
drop policy if exists "Allow All Orders" on orders;
drop policy if exists "Allow All OrderItems" on order_items;

-- 2. เปิดสิทธิ์ Orders ให้ทุกคน (Read / Write / Update)
alter table orders enable row level security;
create policy "Allow All Orders"
on orders for all
using (true)
with check (true);

-- 3. เปิดสิทธิ์ Order Items ให้ทุกคน
alter table order_items enable row level security;
create policy "Allow All OrderItems"
on order_items for all
using (true)
with check (true);

-- 4. (เผื่อไว้) เปิดสิทธิ์ Realtime
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
