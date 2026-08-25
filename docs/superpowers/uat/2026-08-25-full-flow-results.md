# Full-flow local UAT — 25 Aug 2026

## Outcome

ทดสอบบน local Supabase + Vite ด้วย browser flow จริงครบตั้งแต่สร้าง creator, catalog/stock, event allocation, pre-order, live event, post-order และสิทธิ์ทั้ง 4 roles แล้ว

- บั๊ก creator signup ซ้ำจาก concurrent requests: แก้และผ่าน regression
- บั๊ก pre-order notification: แก้ทั้ง UUID validation และ schema lookup; Mailpit รับ submitted/confirmed/rejected ครบ
- Full lifecycle: ผ่านทุกเส้นทางหลัก
- Authorization: backend/RLS tests ผ่าน; browser role matrix ทำงานตามที่คาด ยกเว้น UX findings ด้านล่าง
- ไม่มี production mutation หรือ remote migration

## Fixes verified

### Creator signup idempotency

- เรียก `complete_verified_creator_signup()` พร้อมกัน 2 requests
- ผลลัพธ์เป็น `created` 1 ครั้งและ `exists` 1 ครั้ง
- เหลือ active creator application 1 แถว, artist 1 แถว, owner membership 1 แถว
- partial unique index ป้องกัน active application ซ้ำที่ระดับ database

### Pre-order email notification

- canonical UUID ไปถึง order lookup ได้; malformed UUID ถูกปฏิเสธด้วย 400
- แก้ query ที่เคยเลือก `orders.pickup_instructions` ซึ่งไม่มีใน schema ให้ใช้ `events.preorder_pickup_instructions`
- database/query errors ไม่ถูกกลบเป็น “Order not found” อีกต่อไป
- notification ledger ก่อน cleanup มี 6 records และทั้งหมดเป็น `delivered`:
  - submitted + rejected สำหรับ order ที่ staff reject
  - submitted + confirmed สำหรับ order ที่ pickup สำเร็จ
  - submitted + confirmed สำหรับ post-order ที่ ship สำเร็จ

## Real user-flow results

### Catalog and stock

- สร้าง finite product 12 ชิ้น และ unlimited product
- จัด finite stock เข้า future event 6 ชิ้น และ live event 4 ชิ้น
- POS ป้องกันการเพิ่ม finite item เกิน event allocation
- self-cancel และ staff reject คืน reserved stock ถูกต้อง
- pickup เปลี่ยน reserved เป็น sold ถูกต้อง
- ก่อน cleanup: future allocation `total=6, reserved=0, sold=1`; live allocation `total=4, reserved=0, sold=0`; global finite `total=12, sold=1`

### Pre-order

| Scenario | Result |
|---|---|
| Customer cancel before payment | order `cancelled`, payment `payment_cancelled`, stock released |
| Staff reject submitted evidence | order `cancelled`, reason saved, stock released, rejection email delivered |
| Confirm payment then pickup | payment `payment_confirmed`, pickup completed, order `completed`, sold stock incremented |
| Required email / evidence / confirmation dialogs | validation and state transitions shown correctly |

### Live event day

- เปิด booth และ publish public page
- Customer queue #1: owner call/arrive, queue-linked POS cash order ฿170 completed
- Walk-in POS: transfer order ฿50 completed
- Customer queue #2: queue staff call/arrive, seller queue-linked POS cash order ฿50 completed
- ทั้ง queue #1 และ #2 จบที่ `complete`; order จบที่ `completed`

### Post-order

- เปิด post-order window หลัง event จบ และ readiness 6/6
- Customer เลือก unlimited product, กรอก shipping address, upload evidence
- Negative validation: ใส่เบอร์ใน address อย่างเดียวไม่พอ; ระบบบังคับช่อง phone
- Owner confirm payment, ใส่ carrier + tracking แล้ว mark shipped
- Customer page แสดง `Shipped`, carrier และ tracking number ถูกต้อง

## Role permission matrix

| Role | Positive browser evidence | Negative browser/security evidence |
|---|---|---|
| Owner | Team, catalog, all own events, queue, POS, payment review, pickup, shipping | cross-artist mutation/access regression passed; no foreign mutation attempted during UAT |
| Manager | profile/catalog/events ทุก event, live queue/POS, future pre-order dashboard | Team route redirects to staff workspace; Team nav absent |
| Seller | assigned live event queue + POS; completed queue #2 cash sale | Team redirects; unassigned future pre-order dashboard shows `Permission denied` and no order data |
| Queue Staff | assigned live queue; called and arrived queue #2 | POS area explicitly says `POS Access Restricted`; Team redirects; unassigned event returns no protected order data |

Backend checks additionally cover direct writes, cross-artist access, payment idempotency, stock boundaries and queue ownership.

## Verification

- `npx supabase test db`: 7 files, 102 tests passed
- `npm run test:security`: 147 tests passed across configured desktop/mobile/tablet projects
- `npm run verify`: lint, repository hygiene, env validation, production build, 6 public smoke tests and local API smoke passed
- Manual browser UAT: all lifecycle scenarios above completed against the real local API/database

## Findings not fixed in this scope

1. Manager invitation row is created, but local `notify-team-invitation` reports email failure. Seller/queue magic-link email works. Manager signup and acceptance still worked through the real pending invitation.
2. A new event catalog initially looks usable through global-product fallback before `event_products` is persisted. Explicitly changing/saving event stock creates the allocation; the UI should make this distinction clearer.
3. Unassigned seller/queue routes can render an empty page shell instead of redirecting immediately. RLS protects rows/mutations, but the UX should show a clear access-denied state.
4. A foreign event dashboard can render public event metadata with zero protected aggregates before route-level ownership feedback. Cross-artist product/event access and mutation regression still passes.
5. Success toasts can temporarily intercept header clicks until dismissed.
6. Post-order phone input is labeled optional although shipping flow requires it.

## Evidence

Screenshots are in `output/playwright/full-flow-20260825/`:

- `01-owner-workspace.png` through `07-pos-stock-cap.png`: creator, catalog, allocation, booth, queue, POS and stock cap
- `08-preorder-picked-up.png`: completed pickup customer page
- `09-postorder-shipped.png`: shipped customer page with tracking
- `10-seller-pos-complete.png`: seller POS completion
- `11-queue-role-restricted.png`: queue-only workspace / POS restriction
- `12-manager-all-events.png`: manager event/payment access
- `13-owner-team-matrix.png`: all four active roles and event assignments

## Cleanup

Local-only UAT fixtures were removed after evidence collection:

- UAT artist/events/products/orders/queues and memberships
- four `uat-20260825-*` auth users
- three payment-evidence storage objects
- eight Mailpit messages

Post-cleanup checks returned zero remaining UAT artist, auth user, storage object and Mailpit message records.
