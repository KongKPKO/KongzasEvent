# Event Workspace Restructure Design

## Goal

แก้ปัญหาหน้า Event Management ที่กลายเป็น command shelf (row table ที่มีปุ่ม Dashboard, Orders, Pre-order, Pickup, Live Queue, Live POS, Edit, Delete ต่อหนึ่ง event) ให้เป็น **event-first workspace** ที่บอกผู้ใช้ได้ว่า event นี้ตอนนี้ควรทำอะไรต่อ ตาม state ของ event เอง

ออกแบบให้รองรับ usage จริง: ~90% ของผู้ใช้รัน 1 event ต่อครั้ง, มี 2 event พร้อมกันบ้างแต่น้อย, สูงสุด 3 event เคยเห็นครั้งเดียว โอกาสเกิดน้อยมาก

## Design Principles

1. **Single event คือ default case** — grid ของ event ไม่ใช่พระเอก เพราะ 90% เห็น event เดียว grid ที่มี card ใบเดียวคือ click layer ที่ไม่ให้คุณค่า
2. **Workspace เป็น state-aware** — ไม่ใช่ grid ปุ่มตายตัว 8 อัน แต่ละ module เด่น/ปกติ/เทา/ซ่อน ตาม `selling_mode` + lifecycle ของ event
3. **Live Ops ต้องเข้าถึงได้ใน 1 คลิก** — ตอน booth เปิดหน้างานจริง ห้ามฝัง Queue/POS ลึกใน hub ต้องมี deep link จากทุกที่
4. **Past events แยกออกจาก logic การเด้งอัตโนมัติ** — event ที่จบแล้วไม่นับใน "จำนวน active event" และไม่บล็อกการ redirect

## Navigation Rules

### `/manage-events` (entry)

นับเฉพาะ event ที่ **active/upcoming** (ยังไม่จบ และยังไม่ถูก close/archive):

- **0 active event** → empty state + ปุ่มสร้าง event
- **1 active event** → redirect/เรนเดอร์ workspace ของ event นั้นตรงๆ ไม่ต้องโชว์ grid (flow ของ 90%)
- **2-3 active event** → โชว์ grid ให้เลือก แล้วคลิกเข้า workspace

> Grid เป็น **thin fallback** ลงแรงน้อย ทุ่มเวลาไปที่ workspace แทน

### ทางกลับไปหน้า list (สำคัญเมื่อ auto-redirect)

แม้ตอนมี 1 active event จะเด้งเข้า workspace ตรงๆ ผู้ใช้ต้องมีทางกลับไปดู event ทั้งหมด (โดยเฉพาะ past event) ได้ง่ายเสมอ:

- workspace header มี **breadcrumb / ปุ่ม "ดู event ทั้งหมด"** กลับไป `/manage-events` ในมุมมอง grid เต็ม (force grid ไม่ redirect ซ้ำ)
- หน้า list เต็มต้องเข้าถึง tab "กำลังดำเนินการ" และ "จบแล้ว" ได้
- กัน redirect loop: เมื่อผู้ใช้กด "ดู event ทั้งหมด" ต้อง land ที่ grid จริง ไม่ใช่ถูกเด้งกลับเข้า workspace อัตโนมัติอีก
- ใช้ `?view=all` เป็น primary escape hatch เพราะ share/debug ง่าย และเสริม `sessionStorage.forceEventGrid = 'true'` เฉพาะตอนกดปุ่มจาก workspace เพื่อกัน browser back/refresh พาผู้ใช้เด้งวนกลับ workspace

### Creator Profile access

ปัจจุบัน `/manage-events` มีทั้ง **Profile Settings** และ Event Management อยู่ในหน้าเดียวกัน การทำ single-event auto-redirect ห้ามทำให้ผู้ใช้หา profile ไม่เจอ:

- เพิ่มทางเข้า **Creator Profile** ที่ persistent กว่า table เดิม เช่น route `/manage-profile` หรือปุ่ม/เมนูใน `AdminHeader`
- ในรอบแรกที่ยังไม่แยก route เต็ม ให้หน้า full grid (`/manage-events?view=all`) ยังแสดง/เข้าถึง profile panel ได้ และ workspace header มี action "Creator Profile"
- auto-redirect จาก `/manage-events` ไป workspace ใช้ได้เฉพาะเมื่อไม่ได้อยู่ใน profile editing intent เช่น ไม่มี `?view=all`, ไม่มี `?tab=profile`, และไม่มี `sessionStorage.forceEventGrid`
- ถ้ามีการแยก `/manage-profile` ภายหลัง ให้ route เดิม `/manage-events?tab=profile` redirect ไป route ใหม่ได้ แต่ต้องไม่ทำใน task เดียวกับการสร้าง workspace เว้นแต่จำเป็น

### Tabs

- **"กำลังดำเนินการ" (Active/Upcoming)** — default tab, ใช้ logic การเด้งด้านบน
- **"จบแล้ว" (Ended/Closed)** — grid เสมอ (แม้มีอันเดียว) เป็น archive ไว้กดดู record. คลิก past event → เข้า **EventWorkspace ตัวเดิม** ใน context `Ended` (read/record focused)

นิยาม active/upcoming vs ended:
- **Active/Upcoming**: `end_date >= now()` และ `selling_mode != 'closed'`
- **Ended**: `end_date < now()` หรือ `selling_mode = 'closed'`

## Event Card (grid)

โชว์เฉพาะเมื่อมี 2-3 active event หรือใน tab "จบแล้ว" แต่ละ card มี:

- ชื่อ event + วันที่ (event-local time)
- status chip: selling mode + booth open/closed
- metric ย่อ 1-2 ตัวตาม state (เช่น awaiting pickup count, revenue, queue length)
- **primary action เดียว: Manage** (เข้า workspace)
- quick action เล็ก ๆ ได้แค่ตอน active เช่น **Live Ops** (deep link เข้า Queue/POS)
- Edit/Delete อยู่ในเมนู `...` ไม่โผล่เป็นปุ่มหลัก

## Event Workspace

route ใหม่: `/manage-events/:eventId/workspace`

- **Header**: ชื่อ event + status + booth toggle (เมื่อ context อนุญาต) + deep link Live Ops
- **Body**: module cards เรียงตาม priority ของ context (ดู matrix) แต่ละ card = icon + ชื่อ + metric สั้น ๆ + next action เฉพาะ state นั้น

Module ทั้งหมด (wrap component ที่มีอยู่แล้ว ไม่เขียน logic ใหม่):
Event Settings · Catalog/Stock · Pre-order Settings · Pickup Orders · Live Queue · Live POS · Dashboard · Order History

### Module card behavior

Module cards ต้องเป็น **task cards** ไม่ใช่ nav grid เฉยๆ:

- แต่ละ card แสดง metric หรือ readiness signal ที่ช่วยตัดสินใจ เช่น `สินค้าเปิดขาย 8 รายการ`, `รอรับ 12 ออเดอร์`, `คิวค้าง 4 ใบ`, `รายได้วันนี้ ฿3,240`
- card มี primary CTA เดียวตาม context เช่น `ตั้งค่า stock`, `ดูรายการรอรับ`, `เปิด Live Queue`, `ดูยอดขาย`
- ถ้า module ยังไม่พร้อม ให้บอกสถานะสั้นๆ ใน card เช่น `ยังไม่มีสินค้าที่เปิดขาย` และ CTA พาไปแก้จุดนั้น
- หลีกเลี่ยง in-app explanatory text ยาวๆ; ใช้ label/metric/CTA ที่ scan ได้เร็ว
- card ที่ disabled/read-only ใช้เฉพาะเมื่อมีคุณค่าต่อการรับรู้สถานะ ถ้า user ไม่มีสิทธิ์และไม่จำเป็นต้องเห็น ให้ซ่อน

## State → Module Priority Matrix

Priority: **P** = Primary (เด่น บนสุด/ใหญ่) · **S** = Standard (ปกติ) · **M** = Muted (เทา กดได้แต่ไม่เด่น) · **H** = Hidden (ซ่อน)

Context มาจาก `selling_mode` + lifecycle + `is_booth_open`:

| Module | A. Upcoming · Prep<br>(preorder, ก่อน opens_at / ยังตั้งค่า) | B. Upcoming · Pre-order Open<br>(preorder, ใน window) | C. Live · Booth Open<br>(live, booth_open) | D. Live · Booth Closed<br>(live, booth_closed) | E. Ended<br>(closed / end_date ผ่าน) |
|---|---|---|---|---|---|
| Event Settings    | **P** | S | S | S | M |
| Catalog / Stock   | **P** | **P** | S | S | M (read-only) |
| Pre-order Settings| **P** | **P** | M | M | H |
| Pickup Orders     | S | **P** (awaiting count) | S → **P** ถ้า awaiting>0 | S → **P** ถ้า awaiting>0 | **P** (expire no-show + record) |
| Live Queue        | H | M | **P** | **P** (CTA: เปิด booth) | H |
| Live POS          | H | M | **P** | S | H |
| Dashboard         | S | S | S | S | **P** |
| Order History     | S | S | S | S | **P** |

### หมายเหตุ matrix

- **Awaiting pickup bump**: ถ้า `pickup_status = awaiting_pickup` count > 0 ให้ Pickup Orders เลื่อนขึ้นเป็น Primary ทุก context ที่ขายอยู่ (B/C/D) เพราะเป็นงาน operational ที่ค้าง
- **Live Ops deep link**: context C และ D ต้องมีปุ่ม deep link ตรงเข้า Queue/POS ที่ header + ที่ event card — ไม่บังคับให้ผ่าน hub
- **post_event mode**: design doc สำรอง mode `post_event` ไว้ ถ้าเปิดใช้ทีหลังให้ map ใกล้เคียง context B (ขายได้ แต่เน้น Catalog + Pickup) — ยังไม่อยู่ใน scope รอบนี้
- **Ended context (E)**: Queue/POS/Pre-order Settings ซ่อน เพราะไม่ขายแล้ว Catalog เป็น read-only เหลือ Pickup (ไว้ expire no-show + ดูว่าใครมารับ), Dashboard, Order History เป็นหลัก

## Role-Aware Module Visibility

Workspace ต้องไม่โชว์ action ที่ role นั้นกดไม่ได้ เพราะจะทำให้ hub ดูรกและทำให้ staff สับสน:

| Module | Owner | Manager | Seller | Queue Staff |
|---|---|---|---|---|
| Event Settings | Full | Full | Hidden | Hidden |
| Catalog / Stock | Full | Full | Read-only ถ้าต้องดูสินค้าเพื่อขาย | Hidden หรือ read-only เฉพาะที่จำเป็น |
| Pre-order Settings | Full | Full | Hidden | Hidden |
| Pickup Orders | Full | Full | Full | Full |
| Live Queue | Full | Full | Full | Full |
| Live POS | Full | Full | Full | Hidden |
| Dashboard | Full | Full | Read-only summary | Read-only summary |
| Order History | Full | Full | Read-only หรือ limited ตาม policy เดิม | Read-only หรือ hidden ตาม policy เดิม |
| Creator Profile | Full | Hidden เว้นแต่ policy เดิมอนุญาต | Hidden | Hidden |

Rules:

- ใช้ helper role/access ที่มีอยู่แล้วเป็น source of truth เช่น `canAccessManagementPages`, `canAccessQueuePages`, `canUsePos`
- ถ้า module เป็น Primary ตาม state matrix แต่ user ไม่มีสิทธิ์ ให้เลือก module ถัดไปที่ user ใช้ได้ขึ้นมาเป็น Primary แทน
- ถ้า role ไม่ควรเห็น customer PII ให้ module card/metric ห้ามแสดง `customer_name`, `customer_contact` หรือข้อมูลละเอียด; ให้เข้า page ที่มี RLS/RPC คุมต่ออีกชั้น
- Seller และ Queue Staff ต้องยังเข้า Live Ops ได้เร็ว ไม่ถูกบังคับให้ผ่าน management-only route ที่โดน guard

## Implementation Sequencing

ทำแบบ **additive** อย่าเพิ่งรื้อของเก่า เพื่อกัน debug ambiguity:

1. สร้าง `EventWorkspace.tsx` + route ใหม่ที่ **wrap component เดิม** ทั้งหมด — ไม่แตะ logic ของ pre-order/pickup/queue/POS
2. ทำ event grid + tab (active / ended) + redirect rule สำหรับ single active event
3. เพิ่มทางเข้า Creator Profile ที่ไม่หายหลัง auto-redirect และทำ full grid escape hatch (`?view=all`) ให้จบก่อนเปิด redirect จริง
4. เก็บ route/ปุ่มเดิมใน Event Management ไว้ให้ยังใช้ได้คู่กัน
5. **flip ทิ้ง route เก่า หลัง Task 8 (DB test 18 ข้อ ของ pre-order MVP) ผ่าน** — ตอนนั้น pre-order flow ถูก verify แล้ว ถ้าพังจะรู้ว่าเป็น logic ไม่ใช่ routing ใหม่

## Past Event Behavior

Past/ended event เป็น record-first workspace:

- module ที่แก้ configuration ได้ เช่น Event Settings, Catalog, Pre-order Settings ต้องเป็น read-only หรือซ่อนตาม role
- action ที่ยังมีผลกับ operations หลังงาน เช่น `expire no-show preorders` ทำได้เฉพาะ owner/manager และต้องแสดงเหตุผล/ผลลัพธ์ชัดเจน
- Dashboard และ Order History เป็น Primary โดย default เพราะผู้ใช้มักเข้ามาดูยอด/records หลังงาน
- Live Queue/POS ไม่ควรแสดงเป็น action หลักใน ended context แม้ route เก่าจะยังเปิดได้ช่วง transition

## Out of Scope (รอบนี้)

- sidebar product-style workspace แบบเต็ม (scope ใหญ่ไป)
- `post_event` selling mode (สำรองไว้ใน type แต่ยังไม่ทำ UI)
- multi-event bulk actions
- การรื้อ Profile Settings เป็น page ใหม่เต็มรูปแบบ ถ้าไม่จำเป็นต่อ auto-redirect รอบแรก

## Acceptance Criteria

- ผู้ใช้ที่มี 1 active event เข้า `/manage-events` แล้วเห็น workspace ของ event นั้นเลย ไม่ต้องคลิกผ่าน grid
- แม้ถูก auto-redirect เข้า workspace ผู้ใช้ยังกด "ดู event ทั้งหมด" จาก header กลับไปหน้า grid เต็ม (เห็นทั้ง active และ past) ได้ และไม่ถูกเด้งกลับเข้า workspace ซ้ำ
- ผู้ใช้ยังเข้าถึง Creator Profile ได้หลังปรับเป็น event-first workspace โดยไม่ต้องรู้ URL ลับ
- ผู้ใช้ที่มี 2-3 active event เห็น grid แล้วคลิก Manage เข้า workspace ได้
- event ที่จบแล้วอยู่ใน tab "จบแล้ว" เป็น grid กดเข้าไปดู Dashboard/Order History/Pickup record ได้
- จำนวน past event ไม่กระทบ logic การเด้ง single active event
- workspace แสดง module priority ต่างกันตาม selling_mode + lifecycle ตาม matrix
- workspace ซ่อนหรือ downgrade module ตาม role โดยไม่โชว์ action ที่ user ไม่มีสิทธิ์ใช้
- module cards แสดง metric/next action ตาม state ไม่ใช่แค่ grid ปุ่มนำทาง
- past event workspace เป็น record/read-only focused และไม่ชวนเข้า Live Queue/POS เป็น action หลัก
- ตอน event live (booth open) กดเข้า Live Queue/POS ได้ใน 1 คลิกจาก card และ workspace header
- route/ปุ่มเดิมยังใช้ได้จนกว่า pre-order MVP จะ verify เสร็จ แล้วค่อยตัดออก
