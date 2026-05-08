# POS + Home MVP UX Spec

## เป้าหมาย

ยกระดับระบบให้พร้อมทดลองใช้จริงในงานขนาดเล็กถึงกลาง โดยโฟกัส 2 เรื่อง:

1. POS ใช้งานกับสินค้าจำนวนมากได้เร็วและพลาดน้อย
2. หน้า Home ช่วยให้ผู้ใช้เห็นและเข้าถึงบูธอื่นในงานเดียวกันได้ง่าย

## ขอบเขตของรอบนี้

### ทำทันที

- ปรับ POS ให้ค้นหาเร็วขึ้นและเห็นสินค้าเยอะได้ง่ายขึ้น
- เพิ่ม quick filters สำหรับ promo, low stock, recent, pinned
- เพิ่ม cart promo helper เพื่อช่วย staff ปิดการขายได้เร็วขึ้น
- เพิ่ม section รวมบูธอื่นบนหน้า Home

### ยังไม่ทำในรอบนี้

- promotion engine ฝั่ง backend ที่กระทบยอดเงินจริง
- auto discount ใน database/order history
- global directory แยกเป็นหน้าเต็ม
- social feed

## POS UX ที่ต้องได้

### ปัญหาปัจจุบัน

- สินค้าจำนวนมากทำให้การหา item ช้า
- staff ต้องจำ promo เอง
- ไม่มี quick path สำหรับสินค้าขายบ่อย
- ไม่มีมุมมองที่ช่วยคุม low stock / promo item ชัดเจน

### แนวทางหน้าจอ

```text
+---------------------------------------------------------------+
| Customer Context / Queue Tabs                                 |
+---------------------------------------------------------------+
| Search | Sort | View Mode | Quick Filters                     |
| Category Tabs (All / Photocard / Sticker / Keychain / ...)    |
+--------------------------------------+------------------------+
| Product Browser                       | Cart / Summary         |
| - compact cards or visual cards       | - items                |
| - promo badges                        | - promo helper         |
| - stock badges                        | - total                |
| - pin / recent shortcuts              | - payment              |
+--------------------------------------+------------------------+
```

### โครงข้อมูลหมวดสินค้าที่แนะนำ

- `Photocard`
- `Polaroid`
- `Sticker`
- `Keychain`
- `Poster`
- `Standee`
- `Shaker`
- `Add-on`

### Quick Filters

- `All`
- `Promo`
- `Low stock`
- `Recent`
- `Pinned`

### View Modes

- `Compact`
  - ใช้เป็น default
  - เหมาะกับของ 100+ SKU
  - แสดงรูปเล็ก, ชื่อ, ราคา, stock, promo chip
- `Visual`
  - ใช้ตอนช่วยลูกค้าเลือกของจากรูป
  - รูปใหญ่ขึ้น, ข้อมูลน้อยลง

### Promotion Helper ที่ต้องสื่อใน UI

- `Photocard 3 for 130`
- `Polaroid 3 for 100`
- `Sticker 5 get 1`
  - Otaku A6 Sticker
  - OC Sticker
  - Half A6 Sticker
- `Shaker + free add-on character`

### กติกาในรอบนี้

- UI แสดง `progress/ready state` ของ promo
- ยังไม่หัก discount อัตโนมัติในยอดจริง
- staff ใช้ helper เป็นตัวช่วยปิดการขายก่อน
- promotion engine จริงเป็น phase ถัดไป

### Promotion Engine Phase ถัดไป

- รองรับ `bundle price`
- รองรับ `buy X get Y`
- รองรับ `required free add-on selection`
- คำนวณราคาจริงใน order/POS backend

## Home UX ที่ต้องได้

### เป้าหมาย

- คนที่เข้ามาดูบูธหนึ่ง ควรเห็นว่ามีบูธอื่นในงานเดียวกันด้วย
- ช่วย cross-discovery ให้ creator ในเครือข่ายเดียวกัน

### แนวทางหน้าจอ

```text
+--------------------------------------------------+
| Artist Header                                    |
| Bio / Booth Status                               |
+--------------------------------------------------+
| Next Events                                      |
+--------------------------------------------------+
| Explore Creators                                 |
| - card 2 คอลัมน์                                |
| - รูป, ชื่อ, event, location, booth status       |
| - ปุ่ม View Booth                                |
+--------------------------------------------------+
| Social Footer                                    |
+--------------------------------------------------+
```

### Logic การเลือกบูธมาแสดง

- ใช้งานจาก event ที่ `Confirmed`
- ให้ priority บูธที่มี `location` เดียวกับ event ปัจจุบันของหน้า
- ถ้าไม่พอ ให้ fallback ไป upcoming creators อื่นทั้งหมด
- ไม่แสดงตัวเองซ้ำ

### ข้อมูลในการ์ด creator

- avatar
- display name
- current/next event name
- location
- booth open badge
- ปุ่ม `View Booth`

## Definition of Done

### POS

- staff หา item จาก 100+ SKU ได้เร็วขึ้น
- promo item มองเห็นง่าย
- low stock มองเห็นง่าย
- สลับระหว่าง quick scan กับ browse รูปได้

### Home

- หน้า Home มี section รวม creator อื่น
- ผู้ใช้กดเข้า booth อื่นได้ใน 1 tap
- section นี้ไม่ทำให้หน้าเดิมซับซ้อนเกินไป

## หมายเหตุเชิงธุรกิจ

สำหรับการขึ้นใช้จริงกับกลุ่มเพื่อน รอบนี้ถือว่าเพียงพอถ้า:

- queue flow เสถียร
- POS ใช้งานเร็ว
- staff ไม่ต้องจำ promo ทั้งหมดเอง
- creator อื่นได้รับ discovery ผ่านหน้า Home

