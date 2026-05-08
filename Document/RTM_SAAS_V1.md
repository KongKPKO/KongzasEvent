# Requirements Traceability Matrix (RTM) - SaaS V1

Document version: `1.0`  
Date: `2026-02-13`  
Scope: `Current system + prioritized backlog`

Legend:
- Status: `Implemented`, `Partial`, `Missing`, `Deferred`
- Priority: `P0` critical, `P1` high, `P2` medium

| Req ID | Requirement | Priority | Current Status | Current Implementation (Code / DB) | Gap / Risk | Planned Phase | Verification |
|---|---|---:|---|---|---|---|---|
| `REQ-001` | Customer รับคิวสำหรับงานที่กำลังเปิด | P0 | Partial | `src/pages/customer/QueueView.tsx`, table `queues` | ไม่มี hard lock ว่า 1 user ต่อ 1 active ticket | A | Create ticket when active event and booth open |
| `REQ-002` | ควบคุมสถานะคิว (`waiting/calling/serving/complete/missed`) | P0 | Implemented | `src/components/dashboard/QueuePanel.tsx`, `src/components/dashboard/PosPanel.tsx` | ยังไม่มี SLA/alert หากติดค้างสถานะนานผิดปกติ | A | Transition state integration tests |
| `REQ-003` | ลูกค้าออกจากคิวเองได้ | P1 | Implemented | `src/pages/customer/QueueView.tsx` | ต้องพิจารณาการยืนยันตัวตน ticket owner ระยะถัดไป | A | Leave queue updates to `missed` |
| `REQ-004` | ลูกค้าดูเมนูระหว่างรอคิว | P0 | Implemented | `src/pages/customer/MenuView.tsx`, `src/components/menu/ProductList.tsx` | ไม่รองรับ stock จริง | A | Menu loads and filters correctly |
| `REQ-005` | ลูกค้าส่งออเดอร์ล่วงหน้า | P0 | Implemented | `src/pages/customer/MenuView.tsx`, tables `orders`, `order_items` | ยังไม่ reserve stock | A | Confirm order creates order + items |
| `REQ-006` | POS จ่ายเงินสำหรับคิว/Walk-in | P0 | Implemented | `src/components/dashboard/PosPanel.tsx` | ยังไม่มี payment verify automation | A/B | Complete order updates queue + history |
| `REQ-007` | ประวัติการขายราย event | P1 | Implemented | `src/pages/creators/OrderHistory.tsx` | ยังไม่รองรับ export ภาษีเชิงบัญชีเต็มรูปแบบ | A | Event history summary matches transactions |
| `REQ-008` | จัดการสินค้า CRUD + soft delete | P0 | Implemented | `src/pages/creators/ManageProducts.tsx`, `products.deleted_at` | ยังไม่มี stock fields | A | Create/edit/delete products works |
| `REQ-009` | รองรับ currency ต่อสินค้า | P1 | Implemented | `products.currency`, trigger `check_active_currency_consistency` | Mixed currency UX ยังต้องชัดเจนกว่าเดิม | A | Active currency consistency enforced |
| `REQ-010` | จัดการ Event และสถานะงาน | P0 | Implemented | `src/pages/creators/ManageArtist.tsx`, table `events` | Timezone per event ยังไม่ explicit | A | Create/edit event and booth control |
| `REQ-011` | Realtime queue/menu/order updates | P0 | Implemented | Supabase Realtime channels across pages | 일부 channel filter ยัง broad, เสี่ยง scale cost | A | Realtime update latency under threshold |
| `REQ-012` | Multi-staff login พร้อมกัน | P0 | Missing | Current model = owner account เดียว | ต้องเพิ่ม member schema + invite flow | A | 2-3 staff concurrent sessions |
| `REQ-013` | Role `queue_only` | P0 | Missing | N/A | ต้องมี permission matrix UI+RLS | A | Queue controls visible, POS hidden |
| `REQ-014` | Role `queue_pos` | P0 | Missing | N/A | ต้อง map role to routes/components | A | Queue+POS allowed, admin settings restricted |
| `REQ-015` | Stock reservation/commit/release | P0 | Missing | N/A | ไม่มี guard ป้องกัน oversell | A | Concurrency test no negative stock |
| `REQ-016` | ETA เวลารอคิว | P1 | Missing | N/A | ต้องเก็บ throughput window + model | A | ETA shown and updates with queue progress |
| `REQ-017` | PromptPay QR + auto verification | P1 | Deferred | N/A | ต้องพึ่ง provider + webhook infra | B | Payment status auto-completed from webhook |
| `REQ-018` | Manual slip upload | P2 | Deferred | Not desired by business | ไม่ตรง requirement ความเร็วหน้างาน | N/A | Explicitly out of current plan |
| `REQ-019` | Feed (image/video) | P2 | Missing | N/A | เพิ่ม domain complexity และ moderation | C | Post/feed render and basic engagement |
| `REQ-020` | Live streaming | P2 | Missing | N/A | Infra cost + moderation + abuse handling | C | Live session start/stop stability |
| `REQ-021` | Loyalty from transaction history | P2 | Missing | N/A | ต้องมี member identity strategy | C | Point issuance/redeem consistency |
| `REQ-022` | Multi-timezone event scheduling | P1 | Missing | Current uses ISO/local conversions | เสี่ยงเวลาเพี้ยนข้ามประเทศ | A | Event logic correct under selected timezone |
| `REQ-023` | Multi-tenant data isolation | P0 | Partial | RLS hardening migration exists | ต้อง validate all user journeys after policy tighten | A | No cross-artist access in tests |
| `REQ-024` | Public web no-app onboarding | P0 | Implemented | Public routes by slug | ต้อง optimize first-load and friction | A | First visit -> ticket within minimal steps |

## Priority Delivery Order (Agreed)

1. `Stock`
2. `ETA Queue`
3. `Payment verification`
4. `Feed/Live`

Note: payment verification remains gated by provider integration decision.
