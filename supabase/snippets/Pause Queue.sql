-- ALTER TABLE artists 
-- ADD COLUMN is_queue_open BOOLEAN DEFAULT true;

-- -- 2. สร้างกฎ: "ให้ลูกค้าทุกคน (Public) ดูรูปใน Menu ได้"
-- CREATE POLICY "Public_View_Menu_Images"
-- ON storage.objects FOR SELECT
-- USING ( bucket_id = 'Menu' );

-- -- 3. สร้างกฎ: "ให้ร้านค้า (Login แล้ว) อัปโหลด/ลบ/แก้ไข รูปใน Menu ได้"
-- CREATE POLICY "Artists_Manage_Menu_Images"
-- ON storage.objects FOR ALL
-- TO authenticated
-- USING ( bucket_id = 'Menu' )
-- WITH CHECK ( bucket_id = 'Menu' );

-- -- 2. อนุญาตให้ลูกค้าทุกคนเห็นรูปในถัง Avatar ได้ (ผ่าน ImageKit)
-- CREATE POLICY "Public_View_Avatars"
-- ON storage.objects FOR SELECT
-- USING ( bucket_id = 'Avatar' );

-- -- 3. อนุญาตให้ร้านค้า (Login แล้ว) จัดการรูปในถัง Avatar ของตัวเองได้
-- -- Tip: ใช้ Path ฝากไฟล์เป็น user_id เพื่อป้องกันการตั้งชื่อไฟล์ทับกัน
-- CREATE POLICY "Artists_Manage_Avatars"
-- ON storage.objects FOR ALL
-- TO authenticated
-- USING ( bucket_id = 'Avatar' AND name LIKE (auth.uid() || '/%') )
-- WITH CHECK ( bucket_id = 'Avatar' AND name LIKE (auth.uid() || '/%') );

-- -- 1. เช็คชัวร์ว่ามีช่องเก็บ URL รูปไหม (ถ้าไม่มีให้สร้างเพิ่ม)
-- ALTER TABLE public.artists 
-- ADD COLUMN IF NOT EXISTS image_url text;

-- -- 2. ล้างกฎการแก้ไขเก่าที่อาจจะเขียนผิด
-- DROP POLICY IF EXISTS "Owner_Update_Artist" ON public.artists;
-- DROP POLICY IF EXISTS "Enable update for authenticated users only" ON public.artists;
-- DROP POLICY IF EXISTS "Artist can update own profile" ON public.artists;

-- -- 3. สร้างกฎใหม่: "อนุญาตให้เจ้าของร้าน แก้ไขข้อมูลร้านตัวเองได้ทุกช่อง"
-- CREATE POLICY "Owner_Update_Artist"
-- ON public.artists
-- FOR UPDATE
-- TO authenticated
-- USING (auth.uid() = id)
-- WITH CHECK (auth.uid() = id);

-- -- 4. บังคับเปิดระบบความปลอดภัย (เผื่อใครเผลอปิด)
-- ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

-- ALTER TABLE artists 
-- ADD COLUMN IF NOT EXISTS is_queue_open BOOLEAN DEFAULT true;

ALTER TABLE orders ADD COLUMN currency VARCHAR(3) DEFAULT 'THB';