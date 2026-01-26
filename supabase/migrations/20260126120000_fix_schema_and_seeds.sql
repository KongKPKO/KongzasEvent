-- 1. แก้ Error: column "is_queue_open" of relation "artists" does not exist
-- เพิ่มคอลัมน์ is_queue_open เข้าไปในตาราง artists
ALTER TABLE IF EXISTS "public"."artists" 
ADD COLUMN IF NOT EXISTS "is_queue_open" boolean DEFAULT false;

-- 2. แก้ Error: table "supabase_migrations.seed_files" does not exist
-- สร้าง Table ระบบที่ CI ร้องขอ (เพื่อกันเหนียว)
CREATE SCHEMA IF NOT EXISTS "supabase_migrations";

CREATE TABLE IF NOT EXISTS "supabase_migrations"."seed_files" (
    "path" text PRIMARY KEY,
    "hash" text NOT NULL
);

-- (แถม) ให้สิทธิ์ให้ครบ เพื่อกันปัญหา Permission
GRANT ALL ON TABLE "supabase_migrations"."seed_files" TO postgres;
GRANT ALL ON TABLE "supabase_migrations"."seed_files" TO service_role;