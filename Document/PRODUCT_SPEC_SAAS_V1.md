# EventQueueSocial SaaS Product Specification (V1)

Document version: `1.0`  
Date: `2026-02-13`  
Status: `Draft for implementation`  
Owner: `Product + Engineering`

## 1) Product Intent

### Problem
บูธศิลปิน/คอสเพลย์ที่คนเยอะมักเกิดปัญหา:
- คิวล้นหน้าบูธ กีดขวางทางเดิน
- ลูกค้าไม่รู้ว่าต้องรอตรงไหน
- เวลาหน้าบูธถูกใช้กับการจัดคิว แทนการขาย/พูดคุย

### Product Thesis
ให้ลูกค้า "รับคิว + ดูเมนู + ส่งออเดอร์" ผ่านเว็บทันที (ไม่ต้องติดตั้งแอป) และให้เจ้าของบูธใช้หน้าควบคุมคิวกับ POS เพื่อเร่ง throughput และเก็บข้อมูลยอดขายจริง

### Target Segment (Primary)
- บูธเดี่ยวศิลปิน/คอสเพลย์
- ทีมงานในบูธ `1-3` คน
- งานอีเวนต์คอมมูนิตี้ เช่น comic / cosplay convention

## 2) Personas

### P1: Booth Owner
- ควบคุมงานทั้งหมด
- ต้องการลดความแออัดหน้าบูธ
- ต้องการรายงานยอดขายและประวัติธุรกรรม

### P2: Staff Queue (`queue_only`)
- เรียกคิว/จัดการสถานะคิว
- ไม่เข้าถึงการคิดเงิน

### P3: Staff POS (`queue_pos`)
- เรียกคิว + ใช้ POS
- ทำงานคู่กับเจ้าของบูธช่วงคนแน่น

### P4: Attendee (Customer)
- เข้าหน้าคิวไว รับเลขคิวได้ทันที
- รอดูสถานะคิวและเมนู
- สั่งรายการล่วงหน้าเพื่อย่นเวลาหน้าบูธ

## 3) Product Goals / Non-Goals

### Goals (12 months)
- ลดเวลารอหน้าบูธและลดคอขวดคิว
- เพิ่มจำนวนออเดอร์ที่ปิดได้ต่อชั่วโมง
- รองรับการทำงานพร้อมกันหลายคนในบูธ
- มีระบบที่พร้อมเป็น SaaS หลายร้าน (multi-tenant)

### Non-Goals (V1)
- ไม่พัฒนา native app (iOS/Android) ในระยะสั้น
- ไม่ทำ social feed/live เป็น scope หลักของ V1
- ยังไม่บังคับ promptpay auto-check จนกว่าจะเลือก provider

## 4) Current System Baseline

Current code baseline:
- Public routes: `/:slug/home`, `/:slug/menu`, `/:slug/queue`
- Admin routes: `/manage-events`, `/manage-products`, `/manage-pos-queues`, `/manage-events/:eventId/history`
- Stack: `React + Vite + Supabase (Auth, Postgres, Realtime, Storage)`

Core already exists:
- Queue ticket issuance and status updates
- Event and product management
- POS checkout (`cash`, `transfer`)
- Order history view
- Realtime updates for queue/products/orders

Core gaps:
- ไม่มี staff role (`queue_only`, `queue_pos`)
- ไม่มี stock reservation/commit model
- ไม่มี ETA wait time model
- ไม่มี auto payment verification
- Timezone event ยังไม่ explicit per event

## 5) Scope and Releases

### Release A (Hardening + Core Ops)
- Security hardening and policy stabilization
- Staff roles and member management
- Stock model (`total/reserved/sold`)
- ETA computation and display

### Release B (Payment Integrity)
- PromptPay QR flow with provider integration
- Webhook-based payment confirmation
- Payment states and reconciliation

### Release C (Growth Layer)
- Feed (image/video)
- Creator profile expansion
- Loyalty primitives from transaction history

## 6) Functional Requirements

### FR-001 Queue Ticket
- Customer can receive queue number for currently active event
- Queue only open when booth is open and event is active

### FR-002 Queue Lifecycle
- States: `waiting -> calling -> serving -> complete`
- Customer can leave queue (`missed`) while active

### FR-003 Pre-order from Menu
- Customer with active ticket can submit order
- Order must validate queue status + event status + product availability

### FR-004 POS Checkout
- Admin can checkout walk-in and queued customers
- Payment methods: `cash`, `transfer`

### FR-005 Multi-Currency Menu
- Product currency can be set
- Visible active menu must not mix incompatible active currencies

### FR-006 Event Management
- Owner can CRUD events
- Event status supports `Confirmed`, `Cancelled`, `Ended`

### FR-007 Staff Role Access (New)
- `owner`: full access
- `queue_only`: queue controls only
- `queue_pos`: queue controls + POS

### FR-008 Stock Control (New)
- Product has stock fields
- Order submit reserves stock
- Payment completion commits stock sale
- Cancellation/expiry releases stock

### FR-009 ETA Wait Time (New)
- System estimates waiting time from recent throughput
- Display ETA range on queue page

### FR-010 Payment Verification (Deferred)
- Provider-based promptpay verification via webhook
- No manual slip upload requirement for customer flow

### FR-011 Event Timezone (New)
- Event must support explicit timezone field
- All queue/menu/open-close logic must use event timezone consistently

## 7) Non-Functional Requirements

### NFR-001 Performance
- Queue status update perceived latency target: `< 2 sec`
- Public pages should render first content quickly on mobile networks

### NFR-002 Availability
- Core queue/POS paths must degrade gracefully when realtime disconnects

### NFR-003 Security
- RLS enforced across exposed data
- No service role key in frontend

### NFR-004 Auditability
- Orders and status changes should be traceable for dispute/tax workflows

### NFR-005 Operability
- Staging smoke tests must cover queue open/close, ticket flow, POS payment

## 8) Out-of-Scope Questions (to resolve later)

- Loyalty point logic (earn/spend/expiry)
- Live streaming infra and moderation policy
- Cross-event inventory pooling strategy

## 9) Dependencies

- Supabase project + migrations
- Storage buckets: `Menu`, `Avatar`
- Optional payment gateway provider (future)

## 10) Acceptance Milestone for V1 SaaS Core

V1 SaaS core is accepted when:
- Staff roles enforced in both UI and RLS
- Stock cannot go negative under concurrent checkout
- ETA appears and updates with live queue progression
- Queue + POS end-to-end passes smoke tests on mobile and desktop
