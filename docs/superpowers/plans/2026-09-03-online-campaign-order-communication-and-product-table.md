# Online Campaign Order Communication and Product Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a dense campaign product table, readable generated SKUs, in-page slip preview, explicit settings save, clear customer tracking, and quota-conscious campaign emails.

**Architecture:** Keep campaign UI work inside the existing workspace and status pages, reuse the existing signed-slip and Resend/idempotency patterns, and add one append-only database migration for SKU generation plus notification event support. Email delivery remains a non-transactional follow-up so an email-provider failure cannot undo stock, payment, or fulfillment state.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Supabase Postgres/RPC/Edge Functions, Resend, Playwright, pgTAP.

---

## File map

- Modify `src/pages/creators/OnlineCampaignWorkspace.tsx`: dense product table, filters/pagination, slip modal, settings draft/save, and seller notification calls.
- Modify `src/pages/customer/OnlineCampaignStorefront.tsx`: request the creation email after the order RPC succeeds.
- Modify `src/pages/customer/CampaignAwareOrderStatus.tsx`: labeled carrier/tracking UI and copy action.
- Modify `src/lib/onlineCampaigns.ts`: typed notification function invocation.
- Modify `src/i18n.tsx`: Thai and English copy for the new controls and feedback.
- Modify `src/tests/regression/online-campaign.spec.ts`: browser regression coverage.
- Create `supabase/migrations/20260903194239_readable_skus_and_campaign_notifications.sql`: append-only SKU migration and notification-ledger event expansion.
- Create `supabase/functions/notify-online-campaign-order/index.ts`: verified, idempotent transactional campaign email delivery.
- Modify `supabase/config.toml`: expose the notification function with internal authorization checks.
- Modify `scripts/api-smoke-local.sh`: malformed/canonical request checks for the new function.
- Modify `supabase/tests/online_campaign_test.sql`: readable SKU and snapshot assertions.
- Modify `supabase/tests/notification_delivery_security_test.sql`: expanded ledger permission/event assertions.

### Task 1: Readable SKU migration

**Files:**
- Create: `supabase/migrations/20260903194239_readable_skus_and_campaign_notifications.sql`
- Modify: `supabase/tests/online_campaign_test.sql`

- [ ] **Step 1: Add failing pgTAP assertions**

Add products with blank and manual SKUs, then assert:

```sql
select like(
  (select sku from public.products where name = 'Cheki HSR SW999'),
  'CHE-SW999-%',
  'blank SKU becomes readable'
);

select is(
  (select sku from public.products where name = 'Manual SKU Product'),
  'MY-OWN-7',
  'manual SKU remains unchanged'
);
```

Also snapshot an existing order item before changing its product SKU and assert `sku_snapshot` is unchanged afterward.

- [ ] **Step 2: Run the narrow database test and verify failure**

Run `supabase test db supabase/tests/online_campaign_test.sql`.

Expected: the readable-SKU assertion fails against the current `NQ-*` generator.

- [ ] **Step 3: Add the append-only migration**

Implement small SQL helpers used by the trigger and legacy update:

```sql
create or replace function public.product_sku_type_code(p_category text, p_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ 'hair[ -]?clip' then 'HCL'
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ 'cheki' then 'CHE'
    when lower(coalesce(p_category, '') || ' ' || coalesce(p_name, '')) ~ '(^| )fs( |$)|photo.?set' then 'FS'
    else coalesce(nullif(left(regexp_replace(upper(coalesce(p_category, '')), '[^A-Z0-9]', '', 'g'), 3), ''), 'PRD')
  end
$$;
```

Generate a normalized item segment from the final meaningful name/variant tokens, take a per-artist advisory lock, allocate the next three-digit suffix, and retain the existing unique index. Replace only active `NQ-*` product SKUs in deterministic creation/id order; do not update `order_items.sku_snapshot`.

- [ ] **Step 4: Re-run the database test**

Run the same pgTAP command. Expected: readable, manual, uniqueness, and snapshot assertions pass.

- [ ] **Step 5: Commit the database slice**

```bash
git add supabase/migrations/20260903194239_readable_skus_and_campaign_notifications.sql supabase/tests/online_campaign_test.sql
git commit -m "feat: generate readable product SKUs"
```

### Task 2: Dense campaign product table

**Files:**
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Add failing browser coverage**

Extend the merchant workspace test to assert the toolbar and filtering:

```ts
await page.getByRole('button', { name: /Products|สินค้า/ }).click();
await page.getByPlaceholder(/Search product name or SKU|ค้นหาชื่อสินค้า หรือ SKU/).fill(productName);
await expect(page.getByRole('row', { name: new RegExp(productName) })).toBeVisible();
await page.getByLabel(/Campaign membership|สถานะในแคมเปญ/).selectOption('not_added');
```

- [ ] **Step 2: Run the focused Playwright test and verify failure**

Run:

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium -g "merchant sees campaign workspace"
```

Expected: the search field/row semantics do not exist yet.

- [ ] **Step 3: Implement the approved table**

Add local state only:

```ts
const [productSearch, setProductSearch] = useState('');
const [productCategory, setProductCategory] = useState('all');
const [productMembership, setProductMembership] = useState<'all' | 'included' | 'not_added'>('all');
const [productPage, setProductPage] = useState(1);
const PRODUCT_PAGE_SIZE = 20;
```

Derive filtered and paged rows with `useMemo`, reset page to 1 when a filter changes, and render a semantic table inside `overflow-x-auto`. Preserve existing `toggleProduct`, `updateAllocation`, zero-stock copy, and stock constraints. Keep at least 44px for filter controls and row actions.

- [ ] **Step 4: Run the focused test and lint the file**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium -g "merchant sees campaign workspace"
npx eslint src/pages/creators/OnlineCampaignWorkspace.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts --max-warnings 0
```

Expected: both commands pass.

- [ ] **Step 5: Commit the product table slice**

```bash
git add src/pages/creators/OnlineCampaignWorkspace.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: add dense campaign product table"
```

### Task 3: Slip preview, explicit settings save, and tracking labels

**Files:**
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/pages/customer/CampaignAwareOrderStatus.tsx`
- Modify: `src/i18n.tsx`
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Add failing UI assertions**

Cover three user-visible behaviors:

```ts
await page.getByRole('button', { name: /View payment evidence|ดูหลักฐาน/ }).click();
await expect(page.getByRole('dialog', { name: /Payment evidence|หลักฐานการชำระเงิน/ })).toBeVisible();
await page.getByRole('button', { name: /Settings|ตั้งค่า/ }).click();
await page.getByLabel(/Campaign name|ชื่อแคมเปญ/).fill('Edited campaign');
await expect(page.getByRole('button', { name: /Save changes|บันทึกการเปลี่ยนแปลง/ })).toBeEnabled();
```

- [ ] **Step 2: Verify the focused test fails**

Run the matching Playwright cases. Expected: new dialog, save button, and labels are absent.

- [ ] **Step 3: Implement the slip modal**

Replace `window.open` with preview state:

```ts
const [evidencePreview, setEvidencePreview] = useState<{ order: CampaignOrder; url: string } | null>(null);
```

Load/cache the signed URL, render the existing Pre-order modal interaction pattern, focus the close button, close on Escape/backdrop, and show order code, customer, expected amount, and image alt text.

- [ ] **Step 4: Implement settings draft/save**

Initialize controlled state from the loaded campaign and save all four fields in one update:

```ts
const saveCampaignSettings = async () => updateCampaign({
  name: settingsDraft.name.trim(),
  flat_shipping_fee: Number(settingsDraft.flatShippingFee),
  shipping_enabled: settingsDraft.shippingEnabled,
  pickup_enabled: settingsDraft.pickupEnabled,
});
```

Disable save when unchanged, invalid, or saving. Disable Publish while settings are dirty and show `Save changes before publishing`.

- [ ] **Step 5: Implement labeled tracking and copy**

Render separate localized labels for `shipping_carrier` and `tracking_number`, keep the number visible when clipboard access fails, and use `navigator.clipboard.writeText` with two-second copied feedback.

- [ ] **Step 6: Run focused tests and commit**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium
git add src/pages/creators/OnlineCampaignWorkspace.tsx src/pages/customer/CampaignAwareOrderStatus.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "fix: clarify campaign payment and settings flows"
```

### Task 4: Quota-conscious campaign emails

**Files:**
- Create: `supabase/functions/notify-online-campaign-order/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/onlineCampaigns.ts`
- Modify: `src/pages/customer/OnlineCampaignStorefront.tsx`
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `scripts/api-smoke-local.sh`
- Modify: `supabase/tests/notification_delivery_security_test.sql`

- [ ] **Step 1: Expand the delivery-ledger test first**

Assert the ledger remains RLS-protected and accepts campaign event values while retaining preorder event values.

- [ ] **Step 2: Add failing API smoke requests**

Add canonical and malformed UUID checks for `/functions/v1/notify-online-campaign-order`, matching the existing preorder smoke-test style. Expected before implementation: missing handler.

- [ ] **Step 3: Implement the edge function**

Accept this request shape:

```ts
type CampaignNotificationEvent = 'created' | 'ready_for_pickup' | 'shipped' | 'payment_rejected' | 'refund_required';
type RequestBody = { order_id: string; order_code?: string | null; event: CampaignNotificationEvent };
```

For `created`, verify `order_code` exactly against an online-campaign order before sending. For seller events, authenticate the bearer token and verify the caller has owner/manager/seller access to the order's artist. Validate the database state matches the requested event. Claim `preorder_notification_deliveries` with a campaign-prefixed delivery key, build the email with the canonical `PUBLIC_SITE_URL/:slug/order/:code` URL, then deliver through the same Mailpit/Resend environment variables used by preorder email.

- [ ] **Step 4: Wire non-blocking client calls**

```ts
export const notifyOnlineCampaignOrder = (input: {
  orderId: string;
  orderCode?: string;
  event: CampaignNotificationEvent;
}) => supabase.functions.invoke('notify-online-campaign-order', { body: {
  order_id: input.orderId,
  order_code: input.orderCode || null,
  event: input.event,
} });
```

After checkout succeeds, request `created` and navigate regardless of email outcome. After seller actions, send only the approved customer-action or exception event. Show warning feedback on delivery failure without repeating the order mutation.

- [ ] **Step 5: Run database, API, and browser checks**

```bash
supabase test db supabase/tests/notification_delivery_security_test.sql
npm run test:api:smoke
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium
```

Expected: all pass and duplicate email calls return a successful duplicate/no-delivery response.

- [ ] **Step 6: Commit the email slice**

```bash
git add supabase/functions/notify-online-campaign-order/index.ts supabase/config.toml src/lib/onlineCampaigns.ts src/pages/customer/OnlineCampaignStorefront.tsx src/pages/creators/OnlineCampaignWorkspace.tsx scripts/api-smoke-local.sh supabase/tests/notification_delivery_security_test.sql
git commit -m "feat: email online campaign order updates"
```

### Task 5: Full verification and review

**Files:**
- Review all files changed in Tasks 1-4.

- [ ] **Step 1: Run risk-focused suites**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium
npm run test:security
```

Expected: all online-campaign and security tests pass.

- [ ] **Step 2: Run repository verification**

```bash
npm run verify
```

Expected: lint, build, public i18n smoke, and local API smoke pass.

- [ ] **Step 3: Review the diff with fresh context**

```bash
git diff HEAD~4 --check
git diff HEAD~4 --stat
git status --short
```

Confirm no unrelated `.gitignore`, `docs/api/`, `docs/specs/`, or `scripts/docs/` changes entered commits.

- [ ] **Step 4: Fix only confirmed findings and verify again**

Re-run the narrow affected check and `npm run verify` after any fix.
