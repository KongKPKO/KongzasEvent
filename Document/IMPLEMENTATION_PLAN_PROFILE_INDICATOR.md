# [Feature] Profile & Role Indicator

## Goal Description
ในปัจจุบันผู้ใช้ไม่สามารถทราบได้ว่าตัวเองล็อกอินเข้าสู่ระบบ Admin/Staff ด้วยอีเมลอะไร และได้รับสิทธิ (Role) อะไร ทำให้เกิดความสับสน เช่น เผลอล็อกอินด้วยบัญชี Staff (`queue_pos` หรือ `queue_only`) แต่ดันพยายามจะไปเข้าถึงหน้าของ `Owner` (เช่น สินค้า, ตั้งค่างาน) แล้วไม่เห็นเมนู 

ฉันจะเพิ่มส่วน **Profile Indicator** ที่บริเวณมุมขวาบนของหน้า `AdminHeader` โดยจะแสดง:
*   สัญลักษณ์ Avatar (อาจเป็นวงกลมตัวอักษรแรกของอีเมลเพื่อความเรียบง่ายสวยงาม หรือดึงรูปจาก Auth ถ้ามี)
*   ที่อยู่อีเมล หรือชื่อผู้ใช้ (Email/Name)
*   ป้ายระบุสิทธิ (Role Badge) เช่น `Owner`, `Queue & POS`, `Queue Only`

## Proposed Changes
จะแก้ไขส่วนบน (Header) ของทางฝั่งร้านค้า/แอดมิน เพื่อเพิ่มการแสดงผลข้อมูล

### Component: `AdminHeader`
การเปลี่ยนแปลงจะใช้ข้อมูลจาก `auth.user` ผสมกับ Role ปัจจุบันมาแสดงผลใน Header

#### [MODIFY] [`src/components/AdminHeader.tsx`](file:///Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent/src/components/AdminHeader.tsx)

*   **Logic:**
    *   ดึงข้อมูล Email จาก Supabase `supabase.auth.getUser()` ตอน Component โหลด
    *   แปลง `actorRole` (ที่มีอยู่แล้ว) ให้ออกมาเป็น Label ที่อ่านง่าย เช่น `Owner`, `Staff POS`, `Staff Queue`
*   **UI Updates (Desktop):**
    *   แทรกสถานะ Profile ไว้ด้านซ้ายของปุ่ม Logout (บริเวณขวาบนจอ)
    *   ดีไซน์เป็นแนวนอน ประกอบด้วยวงกลม Profile + Email + Role Badge สีที่แตกต่างกัน
*   **UI Updates (Mobile):**
    *   แทรกข้อมูลโปรไฟล์ไว้บนสุดของ Hamburger Dropdown Menu

## Verification Plan

### Automated Tests
*   เนื่องจากเป็นการแก้ไข UI แนะนำให้เทสด้วย Browser/Manual เป็นหลัก

### Manual Verification
*   (จำเป็นต้องรันใน Development วิ่งไปที่ `localhost:5173/manage-login`)
*   ล็อกอินด้วยบัญชีที่เป็น `Owner` (เช่น `konglnwzas@gmail.com`) สังเกตป้ายกำกับ Role มุมขวา
*   ลองล็อกอินด้วยบัญชี Staff (ถ้ามี) สังเกตการแสดงผลว่าบอกสถานะอีเมลและ Role ถูกต้องหรือไม่
*   ย่อหน้าจอเป็น Mobile ดูว่า Email และ Role ไปแสดงใน Hamburger เมนูหรือไม่
