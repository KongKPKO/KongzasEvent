# UX Audit WebApp Owner Customer

## Scope
- Reviewed owner-side workflows with focus on `/manage-products`, `/manage-events`, and POS/Queue operations.
- Reviewed customer-side workflows with focus on home discovery, menu browsing, queue awareness, and cart/confirmation behavior.
- Recommendations are prioritized for pilot use with real booths rather than public-scale SaaS polish.

## Current Strengths
- Core information architecture is understandable: event, menu, queue, POS.
- Customer-side navigation is simple enough for first-time users.
- POS already supports large catalogs, promotions, tags, and stock-aware selling.
- Owner-side workflow covers real booth needs: events, products, promotions, team roles, and analytics.

## Main UX Risks
- Owner-side pages still combine too many actions into one surface. This increases cognitive load during setup.
- POS has good functionality but weak scan hierarchy in a busy booth context. The operator should be able to identify `who is buying`, `what is in cart`, and `what to charge` in under a second.
- Some pages communicate system state but not operator intent. The UI should more clearly guide the next action.
- Discovery and reporting are functional, but not yet opinionated enough to help users decide what to do next.

## Owner Side Findings

### 1. Manage Products
- Problem: add item, CSV upload, promotions, search, and browsing are all on one page with equal weight.
- Impact: setup feels heavier than it needs to, especially when creators only want to do one task.
- Recommendation:
  - Keep `Add Item`, `Bulk Upload`, and `Promotions` in separate collapsible sections.
  - Show search/filter state explicitly and provide a single `Clear all filters` action.
  - Keep the current menu area focused on browse/edit/delete, not setup.

### 2. POS
- Problem: the cart and browser sections contain the right data but the action hierarchy is not explicit enough.
- Impact: in a live booth, staff may scan more than think. The screen should bias toward fast recognition.
- Recommendation:
  - Reinforce cart summary at the top of the cart column.
  - Show savings and queue context above line items.
  - Expose active product filters so staff can see why products disappeared.
  - Keep the payment block visually distinct and stable.

### 3. Event Management
- Problem: the table is efficient but action icons still depend on recall.
- Impact: new users need to memorize what each icon does.
- Recommendation:
  - Add text labels or tooltips consistently for dashboard, orders, edit, and delete.
  - Promote “open POS for this event” as the operational CTA for current events.

### 4. Dashboard
- Problem: metrics are useful but still descriptive more than prescriptive.
- Impact: creators see numbers but not immediate next actions.
- Recommendation:
  - Add interpretation modules such as `top-selling category`, `stock risk`, and `peak sales window`.
  - Add compare-to-previous-event later when event volume is high enough.

## Customer Side Findings

### 1. Home
- Current status: good start for event discovery.
- Recommendation:
  - Make booth states more visible: `booth open`, `queue open`, `selling now`.
  - Promote one main CTA per booth card: `View Booth`.

### 2. Menu
- Current status: search, category, tag, promotions, and cart behavior are now materially better.
- Recommendation:
  - Keep promotion feedback visible near the cart total and line items.
  - Show disabled confirm reasons clearly when queue state does not allow confirmation.
  - If booth staff rely on queue timing, keep preselect allowed but gate confirm to `calling/serving`.

### 3. Queue
- Current status: readable, simple, and operational.
- Recommendation:
  - Keep one primary instruction per state.
  - If `queueing area` exists, surface it prominently in the calling state.
  - Avoid extra explanatory text once the core instruction is visible.

## Priority Actions

### Must Have Before Wider Pilot
1. Stronger POS hierarchy for cart, promotions, and payment.
2. Product management sections separated by intent.
3. Clear filter visibility and reset actions on high-density pages.
4. Event dashboard interpretation, not just raw metrics.

### Should Have Next
1. Better labeled event actions.
2. Creator directory cards with stronger booth state visibility.
3. More explicit empty states with direct next actions.

### Later
1. Cross-event comparison.
2. Saved filter presets.
3. Deeper promo explanation on customer-side product cards.

## Changes Applied In This Iteration
- `Manage Products` reorganized into collapsible sections for `Add New Item`, `Bulk Upload`, and `Promotions`.
- `Manage Products` now shows active filter state and a `Clear all filters` control.
- `POS` now has a stronger cart summary header and a clearer product browser header.
- `POS` now exposes active filter state and provides a direct `Clear filters` action.

## Recommended Next Iteration
1. Add action labels/tooltips to event management.
2. Improve dashboard interpretation with recommendation cards.
3. Add saved views in manage products for `Low stock`, `Promo`, and key categories.
4. Add customer-side booth cards with stronger event/open status hierarchy.
