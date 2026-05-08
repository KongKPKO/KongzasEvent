# Data Platform Decision: Supabase vs BigQuery/Firebase

Document version: `1.0`  
Date: `2026-02-13`  
Status: `Recommended architecture decision`

## 1) Decision Question

ควรย้ายฐานข้อมูลหลักของระบบ (queue + POS + orders) ไป Google stack (`Firebase + BigQuery`) หรือคง `Supabase/Postgres` ต่อ?

## 2) Context

Current business priority:
- ความเร็วหน้างานบูธ
- queue correctness
- POS correctness
- stock/ETA เป็นลำดับถัดไป

These are transactional (`OLTP`) workloads, not analytics-first workloads.

## 3) Option Analysis

| Option | Description | Pros | Cons | Fit for current priority |
|---|---|---|---|---|
| `A` | Keep Supabase/Postgres as primary DB | Strong transactional model, SQL constraints, existing code/migrations already aligned | ต้องทำ hardening และ schema evolution ต่อเนื่อง | `High` |
| `B` | Move core operations to Firebase + BigQuery | BigQuery analytics ecosystem strong | BigQuery is not the right primary engine for low-latency transactional queue/POS writes | `Low` |
| `C` | Hybrid: keep Supabase OLTP + export analytics to BigQuery | Best of both: stable operations + scalable analytics | เพิ่ม integration complexity | `High` (later phase) |

## 4) Recommendation

### Recommended Now
- **Do not migrate transactional core away from Supabase/Postgres now**
- Keep queue/POS/orders on Supabase
- Build missing business capabilities first:
  - staff roles
  - stock
  - ETA

### Recommended Later
- Add BigQuery as analytics sink (hybrid), not as transactional source of truth
- Export event/order aggregates for BI/reporting workloads

## 5) Why this is the pragmatic choice

1. Current codebase and schema are already centered on Postgres semantics and RLS.
2. Queue/POS path needs predictable low-latency row-level writes and strong transaction behavior.
3. Migration to a different transactional stack now delays core business value delivery.
4. Analytics requirements can be added incrementally without rewriting queue/POS core.

## 6) What BigQuery should be used for in this product

- Daily/weekly sales analytics
- Event performance cohorts
- Funnel analysis across queue -> order -> payment
- Long-term retention/loyalty analysis

Not recommended as direct source-of-truth for:
- active queue state transitions
- stock reservation and checkout write path

## 7) Suggested Hybrid Data Roadmap

### Step 1
- Stabilize OLTP domain in Supabase

### Step 2
- Add data export pipeline to BigQuery (batch or streaming)

### Step 3
- Build BI dashboards from BigQuery datasets

### Step 4
- Keep write-path services on Supabase, analytics on BigQuery

## 8) Revisit Triggers

Re-evaluate architecture only if:
- transaction scale exceeds current OLTP tuning capacity
- analytics workload materially impacts OLTP performance
- there is a hard platform requirement that cannot be met on Postgres path
