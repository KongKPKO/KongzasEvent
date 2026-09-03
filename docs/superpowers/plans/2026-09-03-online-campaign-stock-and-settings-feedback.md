# Online Campaign Stock and Settings Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify campaign stock, restore public storefront images, and make pickup/payment settings visibly manageable without accidental duplicates.

**Architecture:** Reuse the existing campaign workspace and RLS-backed tables. Put Menu image-path resolution in the existing image utility so both merchant and customer pages share one path, while keeping settings interaction state local to the existing workspace page.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Supabase JS, Playwright.

---

## File map

- Modify `src/utils/imageUtils.ts`: shared resolver for legacy Menu paths and public URLs.
- Modify `src/pages/customer/OnlineCampaignStorefront.tsx`: render resolved images with a broken-image fallback.
- Modify `src/pages/creators/OnlineCampaignWorkspace.tsx`: clarify stock labels/breakdown and manage saved pickup/payment records.
- Modify `src/i18n.tsx`: English and Thai labels, explanations, and feedback.
- Modify `src/tests/regression/online-campaign.spec.ts`: real browser regression coverage.

### Task 1: Public campaign product images

**Files:**
- Modify: `src/utils/imageUtils.ts`
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/pages/customer/OnlineCampaignStorefront.tsx`
- Test: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Write the failing storefront image test**

Seed the E2E product with a legacy value such as `public/e2e-cheki.webp`. Route the expected ImageKit request to a one-pixel image and assert the storefront image loads:

```ts
await page.route('https://ik.imagekit.io/kongzas/Menu/public/e2e-cheki.webp?tr=w-520,q-80', route =>
  route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }),
);
await page.goto(`/${ARTIST_SLUG}/campaign/${CAMPAIGN_SLUG}`);
const image = page.getByRole('img', { name: 'E2E Cheki' });
await expect(image).toBeVisible();
await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "legacy campaign product image"
```

Expected: FAIL because the storefront sends the relative path directly to `img.src`.

- [ ] **Step 3: Add one shared Menu image resolver**

Extend `src/utils/imageUtils.ts` using the existing Supabase client:

```ts
import { supabase } from '../supabaseClient';

export const getMenuImageUrl = (dbValue: string, width = 600): string => {
  if (!dbValue) return '';
  let path = dbValue;
  if (dbValue.includes('http') && dbValue.includes('Menu/')) {
    path = dbValue.split('Menu/')[1] || dbValue;
  }
  if (path.includes('http')) return getOptimizedImageUrl(path, width);
  return getOptimizedImageUrl(supabase.storage.from('Menu').getPublicUrl(path).data.publicUrl, width);
};
```

Remove the workspace-local resolver and call `getMenuImageUrl(product.image_url, 520)` from both pages.

- [ ] **Step 4: Add a customer-facing image fallback**

Keep fallback state inside a small storefront-local product image component:

```tsx
function CampaignProductImage({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) {
    return <div className="grid aspect-square place-items-center bg-gray-100 text-gray-400"><Store /></div>;
  }
  return <img src={getMenuImageUrl(imageUrl, 520)} alt={name} onError={() => setFailed(true)} className="aspect-square w-full object-cover" />;
}
```

- [ ] **Step 5: Run the focused test and commit**

Run the command from Step 2. Expected: PASS.

```bash
git add src/utils/imageUtils.ts src/pages/customer/OnlineCampaignStorefront.tsx src/pages/creators/OnlineCampaignWorkspace.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "fix: resolve public campaign product images"
```

### Task 2: Plain-language stock breakdown

**Files:**
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/i18n.tsx`
- Test: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Extend the allocated-product regression**

For the existing fully event-allocated fixture, assert these Thai or English labels and the explanatory count are visible:

```ts
await expect(page.getByText(/สต็อกทั้งหมด|Total stock/).first()).toBeVisible();
await expect(page.getByText(/พร้อมจัดสรร|Ready to allocate/).first()).toBeVisible();
await expect(page.getByText(/แคมเปญนี้|This campaign/).first()).toBeVisible();
await expect(page.getByText(/8 ชิ้นอยู่ในช่องทางขายอื่น|8 units are in other sales/)).toBeVisible();
```

- [ ] **Step 2: Run the focused test and confirm it fails**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "fully event-allocated"
```

Expected: FAIL because the current card lacks the allocation explanation.

- [ ] **Step 3: Render the reconciled stock explanation**

Use existing summary and campaign allocation values in the product map:

```ts
const campaignStock = Number(allocated?.stock_total || 0);
const committedElsewhere = Math.max(summary.on_hand - summary.available - campaignStock, 0);
```

Display `สต็อกทั้งหมด / พร้อมจัดสรร / แคมเปญนี้`. Under the totals, render the other-channel message when `committedElsewhere > 0`, and keep the existing zero-stock warning before the add button. The displayed components must reconcile as:

```text
พร้อมจัดสรร + แคมเปญนี้ + ช่องทางอื่น/จองแล้ว = สต็อกทั้งหมด
```

Add bilingual keys for the three labels and `campaignStockElsewhere`.

- [ ] **Step 4: Run the focused test and commit**

Run the command from Step 2. Expected: PASS.

```bash
git add src/pages/creators/OnlineCampaignWorkspace.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: clarify campaign stock allocation"
```

### Task 3: Visible pickup and payment settings

**Files:**
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx`
- Modify: `src/i18n.tsx`
- Test: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Write a failing settings-management browser test**

Log in, open Settings, and exercise both record types:

```ts
test('merchant manages pickup and payment settings with visible feedback', async ({ page }) => {
  await login(page);
  await page.goto(`/manage-online-sales/${campaignId}`);
  await page.getByRole('button', { name: /Settings|ตั้งค่า/ }).click();

  await expect(page.getByText('Siam pickup')).toBeVisible();
  await expect(page.getByText(/PromptPay/).first()).toBeVisible();
  await expect(page.getByText(/•••• 5678/)).toBeVisible();

  await page.getByRole('button', { name: /^Add pickup point$|^เพิ่มจุดรับสินค้า$/ }).click();
  const pickupForm = page.locator('form').filter({ has: page.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/) });
  await pickupForm.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/).fill('Asok pickup');
  await pickupForm.getByPlaceholder(/Address|ที่อยู่/).fill('BTS Asok exit 3');
  await pickupForm.locator('[name="starts_at"]').fill('2026-09-10T18:00');
  await pickupForm.locator('[name="ends_at"]').fill('2026-09-10T20:00');
  await pickupForm.getByRole('button', { name: /Save pickup point|บันทึกจุดรับ/ }).click();
  await expect(page.getByRole('status')).toContainText(/added|เพิ่มจุดรับ/);
  await expect(page.getByText('Asok pickup')).toBeVisible();

  await page.getByRole('button', { name: /^Add pickup point$|^เพิ่มจุดรับสินค้า$/ }).click();
  await pickupForm.getByPlaceholder(/Pickup point name|ชื่อจุดรับ/).fill(' asok pickup ');
  await pickupForm.getByPlaceholder(/Address|ที่อยู่/).fill(' BTS ASOK EXIT 3 ');
  await pickupForm.locator('[name="starts_at"]').fill('2026-09-10T18:00');
  await pickupForm.locator('[name="ends_at"]').fill('2026-09-10T20:00');
  await pickupForm.getByRole('button', { name: /Save pickup point|บันทึกจุดรับ/ }).click();
  await expect(page.getByRole('status')).toContainText(/already exists|มีรายการนี้แล้ว/);
  const duplicateCount = await fixture.service.from('campaign_pickup_points').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).ilike('name', 'Asok pickup');
  expect(duplicateCount.count).toBe(1);

  await page.getByRole('button', { name: /Remove pickup point Asok pickup|ลบจุดรับสินค้า Asok pickup/ }).click();
  await page.getByRole('button', { name: /Cancel|ยกเลิก/ }).click();
  await expect(page.getByText('Asok pickup')).toBeVisible();
  await page.getByRole('button', { name: /Remove pickup point Asok pickup|ลบจุดรับสินค้า Asok pickup/ }).click();
  await page.getByRole('button', { name: /Confirm remove|ยืนยันการลบ/ }).click();
  await expect(page.getByText('Asok pickup')).toHaveCount(0);

  await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
  const paymentForm = page.locator('form').filter({ has: page.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/) });
  await paymentForm.getByPlaceholder('PromptPay').fill('Backup PromptPay');
  await paymentForm.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/).fill('0899994321');
  await paymentForm.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
  await expect(page.getByRole('status')).toContainText(/added|เพิ่มช่องทางชำระเงิน/);
  await expect(page.getByText(/•••• 4321/)).toBeVisible();

  await page.getByRole('button', { name: /^Add payment method$|^เพิ่มช่องทางชำระเงิน$/ }).click();
  await paymentForm.getByPlaceholder('PromptPay').fill(' backup promptpay ');
  await paymentForm.getByPlaceholder(/PromptPay ID|หมายเลขพร้อมเพย์/).fill('0899994321');
  await paymentForm.getByRole('button', { name: /Save payment method|บันทึกช่องทางชำระเงิน/ }).click();
  await expect(page.getByRole('status')).toContainText(/already exists|มีรายการนี้แล้ว/);
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "manages pickup and payment settings"
```

Expected: FAIL because saved settings, toast feedback, duplicate guards, and removal controls are not rendered.

- [ ] **Step 3: Reuse the existing feedback components**

Import `Toast` and `ConfirmDialog` from `../../components/ui/Feedback`. Add only the state needed for the two collapsed forms and one pending removal:

```ts
const [toast, setToast] = useState<{ tone?: 'info' | 'success' | 'warning' | 'error'; title: string; detail?: string } | null>(null);
const [addingPickup, setAddingPickup] = useState(false);
const [addingPayment, setAddingPayment] = useState(false);
const [removeTarget, setRemoveTarget] = useState<{ kind: 'pickup' | 'payment'; id: string; name: string } | null>(null);
```

Render `<Toast message={toast} onClose={() => setToast(null)} />` once near the page root.

- [ ] **Step 4: Guard exact duplicates before insert**

Normalize human-entered strings with `trim().toLocaleLowerCase()`. For pickup points compare name, address, and normalized ISO start/end values. For payment methods compare display name and PromptPay ID. If a match exists:

```ts
setToast({ tone: 'warning', title: t('campaignDuplicateSetting') });
return;
```

Do not reset the form on duplicate or insert error. After success, reset, close the form, reload the workspace, and name the new record in a success toast.

- [ ] **Step 5: Render saved records before the collapsed forms**

Pickup cards show name, address, localized date range, and instructions. Payment cards show display name and a masked identifier:

```ts
const maskPaymentId = (value?: string | null) => {
  const clean = String(value || '').trim();
  return clean ? `•••• ${clean.slice(-4)}` : '—';
};
```

Each heading includes the saved count. An add button expands the corresponding form. Each saved card includes an accessible remove button.

- [ ] **Step 6: Confirm deliberate removals**

Use the existing confirmation dialog. On confirmation, delete only the selected ID from the matching table, reload, close the dialog, and show a success toast:

```ts
const table = removeTarget.kind === 'pickup' ? 'campaign_pickup_points' : 'campaign_payment_methods';
const { error } = await supabase.from(table).delete().eq('id', removeTarget.id);
if (error) throw error;
```

Errors leave the record visible and produce an error toast. Existing duplicates are never auto-deleted.

- [ ] **Step 7: Run the focused test and commit**

Run the command from Step 2. Expected: PASS.

```bash
git add src/pages/creators/OnlineCampaignWorkspace.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "feat: show saved campaign fulfillment settings"
```

### Task 4: Release verification and DEV deployment

**Files:**
- Review: all files changed by Tasks 1–3

- [ ] **Step 1: Run Online Campaign regression**

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium
```

Expected: all Online Campaign tests pass.

- [ ] **Step 2: Run the security/RLS suite**

```bash
npm run test:security -- --project=desktop-chromium
```

Expected: all security tests pass.

- [ ] **Step 3: Run the repository verification**

```bash
npm run verify
```

Expected: lint, build, public smoke, and API smoke checks pass.

- [ ] **Step 4: Review the final diff**

```bash
git diff HEAD~3 --check
git diff HEAD~3 -- src/utils/imageUtils.ts src/pages/customer/OnlineCampaignStorefront.tsx src/pages/creators/OnlineCampaignWorkspace.tsx src/i18n.tsx src/tests/regression/online-campaign.spec.ts
```

Confirm no unrelated files or credentials are present.

- [ ] **Step 5: Push and deploy DEV**

The user already approved DEV testing, not PROD:

```bash
npm run push:current
npm run deploy:staging
```

Expected: branch push succeeds and Firebase prints the DEV channel URL. Do not run `npm run deploy:prod`.
