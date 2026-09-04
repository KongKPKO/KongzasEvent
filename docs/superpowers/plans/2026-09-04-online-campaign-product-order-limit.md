# Online Campaign Product Order Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional maximum quantity per order to each Online Campaign product and enforce it in the storefront and checkout RPC.

**Architecture:** Store a nullable positive integer on `online_campaign_products`. Pass it through the existing campaign save/public/workspace RPCs, cap the React quantity control, and enforce the same rule transactionally in `create_online_campaign_order` before reserving stock.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, React/TypeScript, Playwright, existing i18n utilities.

---

### Task 1: Add the database rule with failing coverage

**Files:**
- Modify: `supabase/tests/online_campaign_test.sql`
- Create: `supabase/migrations/20260904020000_add_campaign_product_order_limits.sql`

- [ ] **Step 1: Write failing pgTAP coverage**

Increase the plan count and add assertions that the column exists, a quantity equal to the configured limit succeeds, a quantity above it raises the dedicated error, and the rejected transaction does not change `stock_reserved`:

```sql
select has_column('public', 'online_campaign_products', 'max_quantity_per_order');

update public.online_campaign_products
set max_quantity_per_order = 2
where id = (select campaign_product_id from _campaign_ids);

select throws_ok(
  $$ select * from public.create_online_campaign_order(
    (select campaign_id from _campaign_ids),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select product_id from _campaign_ids), 'quantity', 3
    )),
    'shipping', null, 'Limited Buyer', 'limited@example.com',
    '0800000098', 'Bangkok', '', gen_random_uuid()
  ) $$,
  'campaign_product_order_limit_exceeded',
  'checkout rejects a quantity above the campaign product order limit'
);
```

- [ ] **Step 2: Run the database test and verify it fails**

Run: `supabase test db supabase/tests/online_campaign_test.sql`

Expected: FAIL because `max_quantity_per_order` does not exist.

- [ ] **Step 3: Create the append-only migration**

Add the nullable constrained column, expose it from both campaign read RPCs, parse and persist it in `save_online_campaign_products`, and select/check it in `create_online_campaign_order`:

```sql
alter table public.online_campaign_products
  add column max_quantity_per_order integer
  check (max_quantity_per_order is null or max_quantity_per_order > 0);

-- In save_online_campaign_products:
v_max_quantity_per_order := nullif(v_item ->> 'max_quantity_per_order', '')::integer;
if v_max_quantity_per_order is not null and v_max_quantity_per_order <= 0 then
  raise exception 'invalid_campaign_product_order_limit';
end if;

-- In create_online_campaign_order after the campaign product row is locked:
if v_product.max_quantity_per_order is not null
   and v_qty > v_product.max_quantity_per_order then
  raise exception 'campaign_product_order_limit_exceeded';
end if;
```

- [ ] **Step 4: Run pgTAP and verify it passes**

Run: `supabase test db supabase/tests/online_campaign_test.sql`

Expected: all Online Campaign database assertions pass.

### Task 2: Add merchant configuration and public quantity feedback

**Files:**
- Modify: `src/types/onlineCampaign.ts`
- Modify: `src/lib/onlineCampaigns.ts`
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/pages/customer/OnlineCampaignStorefront.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Write a failing browser regression**

Configure a product limit through the merchant field, reload the storefront, and assert the quantity cannot exceed the limit:

```ts
const limitInput = campaignRow.getByLabel(/Maximum per order|สูงสุดต่อออเดอร์/);
await limitInput.fill('2');
await limitInput.blur();
await expect.poll(async () => {
  const row = await fixture.service.from('online_campaign_products')
    .select('max_quantity_per_order').eq('campaign_id', campaignId)
    .eq('product_id', productId).single();
  return row.data?.max_quantity_per_order;
}).toBe(2);

await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
const increase = page.getByRole('button', { name: /Increase quantity|เพิ่มจำนวน/ });
await increase.click();
await increase.click();
await expect(increase).toBeDisabled();
await expect(page.getByText(/Maximum 2 per order|สูงสุด 2 ชิ้นต่อออเดอร์/)).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx playwright test src/tests/regression/online-campaign.spec.ts --grep "maximum quantity per order" --project=desktop-chromium`

Expected: FAIL because the field and public limit do not exist.

- [ ] **Step 3: Implement the minimal UI and data plumbing**

Add `max_quantity_per_order?: number | null` to `CampaignProduct`, include it in the existing save payload, render one nullable number input in the merchant table, and cap the storefront with:

```ts
const quantityLimit = product.max_quantity_per_order == null
  ? available
  : available == null
    ? product.max_quantity_per_order
    : Math.min(available, product.max_quantity_per_order);
```

Add the i18n keys `campaignMaxPerOrder`, `campaignMaxPerOrderPlaceholder`, `campaignProductOrderLimit`, and `campaignProductOrderLimitExceeded` in English and Thai. Preserve `null` when other allocation fields are edited.

- [ ] **Step 4: Run the focused and full Online Campaign regression**

Run: `npx playwright test src/tests/regression/online-campaign.spec.ts --grep "maximum quantity per order" --project=desktop-chromium`

Run: `npx playwright test src/tests/regression/online-campaign.spec.ts`

Expected: all tests pass.

### Task 3: Verify stock and security boundaries

**Files:**
- Modify only if a confirmed regression is found.

- [ ] **Step 1: Run relevant security tests**

Run: `npm run test:security`

Expected: all security/RLS tests pass and anonymous callers can only configure the limit indirectly through the guarded checkout RPC.

- [ ] **Step 2: Run full repository verification**

Run: `npm run verify`

Expected: lint, type checking, build, and release checks pass.

- [ ] **Step 3: Review the final diff**

Run: `git diff --check && git diff --stat && git status --short`

Expected: only the spec, plan, migration, targeted Online Campaign code, i18n, and tests are changed; unrelated user files remain unstaged.

- [ ] **Step 4: Commit the implementation**

```bash
git add supabase/migrations/20260904020000_add_campaign_product_order_limits.sql \
  supabase/tests/online_campaign_test.sql src/types/onlineCampaign.ts \
  src/lib/onlineCampaigns.ts src/pages/creators/OnlineCampaignWorkspace.tsx \
  src/pages/customer/OnlineCampaignStorefront.tsx src/i18n.tsx \
  src/tests/regression/online-campaign.spec.ts
git commit -m "feat: limit campaign product quantity per order"
```
