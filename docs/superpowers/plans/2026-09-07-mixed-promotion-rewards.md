# Mixed Promotion Rewards Implementation Plan

**Goal:** Fulfill the approved mixed/partial reward spec without replacing checkout.
**Architecture:** Keep reward choices as product ID arrays. A shared picker confirms counts; the existing resolver validates stock and explicit partial acceptance. Existing checkout transactions remain the final stock authority.
**Tech Stack:** React, TypeScript, PostgreSQL, pgTAP, Playwright. Inline execution; executing-plans skill is unavailable in this session.

## Tasks

- [x] Add SQL regression `supabase/tests/promotion_mixed_rewards_test.sql`: A1+B1 resolves two, A2 fails against A1, partial requires accepted quantity and earned quantity, fixed partial waits, zero stock remains exhausted, unlimited resolves.
- [x] Run `supabase test db --local supabase/tests/promotion_mixed_rewards_test.sql` before/after implementation.
- [x] Append migration `20260907015744_mixed_partial_promotion_rewards.sql`: keep every positive-stock option, resolve to min(earned,total available), require `accepted_quantity` and `accepted_earned_quantity` when partial, validate per-SKU counts; include acceptance metadata in reward lines and required choices.
- [x] Add `src/components/promotions/PromotionChoicePicker.tsx`: local selection counts, 44px increment/decrement buttons, explicit confirm, partial warning. Callers only send choices after confirmation.
- [x] Replace reward branches in Campaign storefront, MenuView and PosPanel; leave exclusive-promotion choices unchanged. Extend `src/types/promotion.ts`.
- [x] Exercise shared picker through actual storefront in Playwright with controlled RPC responses: mixed counts, partial confirmation, exhausted text and blocked incomplete selection. Real SQL integration additionally verifies mixed checkout, holds, expiry and partial pricing snapshots.
- [x] Run existing promotion SQL checkout/expiry/live regressions, `npm run verify`, inspect diff, rerun focused tests. No remote deployment.

## Verification

- 102 SQL assertions passed across mixed rewards, sales channels, atomic save and RPC authorization.
- Storefront Playwright passed on desktop Chromium and Android Chrome using controlled RPC responses, including stock-change recovery and exhausted gifts.
- `npm run verify` passed after review (lint, build, public browser smoke and local API smoke).
- Migration applied and recorded locally only. No DEV/PROD deployment. Full browser journeys for Pre/Post-order and POS were not rerun; their transaction regressions passed in SQL.
