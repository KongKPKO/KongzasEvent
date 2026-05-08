# Implementation Plan - Phase A (Core SaaS)

Date: `2026-02-13`  
Goal: `Deliver staff roles + stock + ETA on stable secure base`

## 1) Workstreams

### WS-1 Security and Access
- Add membership schema (`artist_members`, `artist_invites`)
- Add role-based RLS
- Add role-aware UI guards

### WS-2 Inventory
- Add stock columns and constraints
- Implement reservation on order submit
- Implement commit/release on payment/cancel

### WS-3 Queue ETA
- Define throughput window model
- Compute ETA range per active ticket
- Render ETA in queue UI and refresh via realtime

### WS-4 Timezone correctness
- Add `event_timezone`
- Normalize all event-active and queue-day calculations

## 2) Suggested Sequence

1. DB schema migrations
2. RLS + policy tests
3. API/data access changes
4. UI permission and flow updates
5. E2E regression and smoke tests

## 3) Milestones

### M1
- Staff roles working end-to-end

### M2
- Stock no-negative guarantee under concurrent orders

### M3
- ETA visible and stable for live queue

### M4
- Timezone logic validated for at least 2 different regions

## 4) Success Criteria

- No cross-artist access in RLS checks
- No oversell in concurrency test
- Queue progression and ETA updates within target latency
- Existing queue/POS/customer flows remain passing after changes
