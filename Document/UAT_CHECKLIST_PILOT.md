# UAT Checklist / Test Scenarios

Date: 2026-03-29
Scope: Pilot readiness for owner, staff, and customer flows before limited real-world use
Environment: Local Supabase + local web app

## Exit Criteria
A pilot build is ready only if all `Must Pass` scenarios pass on:
- Desktop Chrome
- iPhone Safari
- Android Chrome
- iPad Safari

The build is blocked if any issue causes:
- stock mismatch
- wrong totals or promotion totals
- queue state stuck or skipped incorrectly
- booth cannot be opened/closed reliably
- customer cannot join queue or confirm item selection
- POS cannot complete checkout

## Preconditions
- Supabase local is running
- migrations are applied
- at least 1 creator account can log in
- at least 1 confirmed active event exists
- test products exist across multiple categories
- at least 1 promotion exists
- storage buckets `Menu` and `Avatar` exist

## Test Data Baseline
Use one pilot artist with:
- 1 active event
- 50 to 100 products
- tags across 5 to 10 themes
- at least 3 promotion types:
  - category buy X discount Y
  - category/tag buy X get Y free
  - product-group promotion
- at least 2 staff roles:
  - queue only
  - queue + POS

## Owner / Staff UAT

### 1. Login / Access
Must Pass
- Owner can log in at `/manage-login`
- Queue-only staff can log in and cannot use POS actions
- Queue+POS staff can use POS and queue actions
- Owner can access Team and update roles

### 2. Event Management
Must Pass
- Owner can create event with timezone
- Owner can edit event and existing start/end values render correctly
- Owner can see event list and actions in one row
- Owner can open booth from event list
- Owner can open/close booth from POS workspace header
- Active event is shown clearly in POS workspace

### 3. Queue Control
Must Pass
- Booth open allows customer queue join
- Booth closed blocks queue join
- Call next moves waiting queue to calling
- Arrived moves calling to serving
- Serving queue appears as selectable customer in POS
- Calling queue older than 30 minutes expires automatically
- Queue panel can be hidden and re-opened on desktop
- Queue tab works on mobile

### 4. Product Management
Must Pass
- Owner can add item with required fields only
- Owner can edit item
- Tag can be added via UI
- CSV import works with tags and stock
- Duplicate CSV rows are rejected
- Duplicate existing products are rejected during import
- Category and tag filters work in manage-products

### 5. Promotions
Must Pass
- Owner can create promotion by:
  - category
  - tag
  - category + tag
  - specific product group
- Promotion activates immediately in POS
- Multiple specific products can belong to one promotion
- Promotion on customer menu shows discounted total correctly
- POS uses discounted total on actual checkout

### 6. POS / Checkout
Must Pass
- Walk-in can be selected and checked out
- Serving queue can be selected and checked out
- Product search works by name and tag
- Category chips and tag filters work
- Cart quantity increase/decrease/remove works
- Stock is reduced on checkout
- Out-of-stock items disappear from POS selection
- Promotion totals are correct in cart and payment flow
- Payment completion clears cart and updates order state

### 7. Customer Flow
Must Pass
- Artist home loads
- Discovery page loads and creator cards are usable
- Customer can browse menu with category and tag filters
- Customer can add items to cart
- Cart shows applied promotions and total discount
- Confirm is disabled unless queue status is calling/serving
- Queue page shows correct next step messaging
- Queueing area message appears when configured

### 8. Dashboard / Reporting
Should Pass
- Event dashboard loads
- Net revenue, order count, avg order value render
- Top products and category mix render
- Order history loads
- Promotion-adjusted totals match order totals

## Device-Specific Checks

### Desktop
Must Pass
- Full queue + POS workflow
- Event management action row stays on one line

### iPhone / Android
Must Pass
- Queue page usable
- Customer menu usable
- POS mobile product browser usable
- Mobile cart bottom sheet usable
- No critical overlap or blocked tap targets

### iPad
Must Pass
- POS split layout usable
- Queue panel and POS both readable
- Event list and manage-products are usable without clipping

## Pilot Day Checklist
- Open booth from Manage Events or POS header
- Confirm menu and prices before opening queue
- Test one walk-in sale
- Test one queued sale
- Confirm event dashboard updates after sale
- Confirm staff role is correct on each device
- Keep one fallback device logged in as owner

## Sign-off Template
- Owner flow: Pass / Fail
- Queue flow: Pass / Fail
- POS flow: Pass / Fail
- Promotion flow: Pass / Fail
- Stock flow: Pass / Fail
- Customer flow: Pass / Fail
- Mobile flow: Pass / Fail
- iPad flow: Pass / Fail
- Go / No-Go for pilot: ___
