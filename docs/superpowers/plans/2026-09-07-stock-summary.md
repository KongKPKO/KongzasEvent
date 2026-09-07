# Stock Summary Implementation Plan

**Goal:** Sold and held units never become allocatable just because a sale closes.
**Architecture:** Preserve the stock-summary RPC contract and stock totals. Count sold units from every channel; allocated includes outstanding holds plus free allocation only while a channel is active. Available = catalog total − catalog sold/held − channel sold − channel allocated. No UI redesign or restocking on refund.
**Tech Stack:** PostgreSQL, pgTAP, existing Supabase RPCs.

Inline execution as requested; executing-plans skill is unavailable.

- [x] Add `supabase/tests/stock_summary_lifecycle_test.sql` using transaction-local fixtures for Campaign and Event. Assert 30 total → allocate20 → available10; sell1 →10; hold1 →10; close →28; release hold →29. Include disabled rows, archived campaigns and missing-caller denial.
- [x] Run `supabase test db --local supabase/tests/stock_summary_lifecycle_test.sql` before changing the function; 10 of 13 initial assertions failed after sale/close.
- [x] Replace `list_product_stock_summaries` in append-only migration `20260907071454_fix_stock_summary_committed_units.sql`. Retain `on_hand=stock_total`, role guard and grants. For each channel: allocated = reserved + (active ? greatest(total-sold-reserved,0) : 0). Available subtracts sold independently, including inactive channels.
- [x] Inspect every allocation helper and adjustment caller for the same stale formula. Reuse the summary where it matches the caller contract; preserve locking and excluded-event semantics. Event adjustments now use unallocated capacity, not their existing allocation again.
- [x] Run lifecycle, stock-adjustment and promotion transaction regressions: 85 SQL assertions passed. Updated old expectations from 21 to 20 (sold unit) and 20 to 16 (existing allocation). `npm run verify` passed; reviewed diff and reran focused checks. Local security advisor at error level reported no issues.
- [x] Record local migration history after successful verification. No push, DEV or PROD deployment.
