-- 1. ลบกฎเดิมออกก่อน (ถ้ามี)
ALTER TABLE events 
DROP CONSTRAINT IF EXISTS events_status_check;

-- 2. สร้างกฎใหม่ ให้ยอมรับค่า 'Ended' เพิ่มเข้ามา
ALTER TABLE events 
ADD CONSTRAINT events_status_check 
CHECK (status IN ('Confirmed', 'Cancelled', 'Ended'));