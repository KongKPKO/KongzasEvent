# Catalog Focused Table and Compact SKU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Catalog easy to scan in both card and focused-table modes, simplify product actions, and migrate generated SKUs to the approved compact readable format without changing historical order snapshots.

**Architecture:** Keep `ManageProducts.tsx` as the existing Catalog owner and reuse its filters, stock RPCs, allocation modal, edit flow, variant flow, and delete confirmation. Add one append-only PostgreSQL migration for compact SKU generation plus provenance, then make the Catalog presentation consume existing stock summaries as explicit columns. Add focused pgTAP and Playwright coverage; no new package, route, service, or product abstraction is needed.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Supabase/PostgreSQL triggers and RLS, pgTAP, Playwright, and the existing Vite release checks.

---

## File map

- Create `supabase/migrations/20260904130000_compact_generated_product_skus.sql` — add SKU provenance, compact the generator, and migrate existing generated SKUs once.
- Modify `supabase/tests/online_campaign_test.sql` — protect compact generation, manual ownership, uniqueness, and immutable order snapshots.
- Modify `src/i18n.tsx` — add explicit Thai/English Catalog labels for the header, modes, stock columns, status, and actions.
- Modify `src/pages/creators/ManageProducts.tsx` — simplify the Catalog header, keep cards as default, render the focused table, add the two-level action hierarchy, and make stock adjustment choose increase/decrease inside the existing dialog.
- Create `src/tests/regression/catalog-workspace.spec.ts` — cover the real Catalog display and action flows in both languages.
- Modify `src/tests/regression/regression.spec.ts` — update the existing edit/status regression to use the new overflow action menu and `Inactive` label.
- Modify `src/tests/security.extend.spec.ts` — keep search-injection coverage stable after translated Catalog copy changes.

### Task 1: Compact generated SKUs and record SKU ownership

**Files:**
- Create: `supabase/migrations/20260904130000_compact_generated_product_skus.sql`
- Modify: `supabase/tests/online_campaign_test.sql:1-140`
- Verify: `supabase/tests/online_campaign_test.sql:430-455`

- [ ] **Step 1: Extend the pgTAP contract before changing the database**

Raise the plan from 42 to 52 assertions, add the provenance column assertion, seed the two Yaoguang option examples, and replace the current readable-SKU checks with the compact contract:

```sql
select plan(52);

select has_column(
  'public',
  'products',
  'sku_is_generated',
  'products record whether an SKU is automatic'
);

insert into public.products (
  artist_id, name, category, variant_name, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values
  ((select artist_id from _campaign_ids), 'Cheki HSR SW999', 'Cheki', null, 350, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Cheki HSR Yaoguang Normal', 'Cheki', 'Normal', 350, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Cheki HSR Yaoguang SP', 'Cheki', 'SP', 400, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Hairclip Keito', 'Hairclip', null, 200, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Manual SKU Product', 'Other', null, 100, 'THB', 1, 0, 0, false, 'enable');

update public.products
set sku = 'my-own-7'
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select ok(
  (select sku ~ '^CHE-SW999-[0-9]{3}$' from public.products where name = 'Cheki HSR SW999'),
  'SW999 keeps meaningful digits in a compact automatic SKU'
);

select ok(
  (select sku ~ '^CHE-YAOG-N-[0-9]{3}$' from public.products where name = 'Cheki HSR Yaoguang Normal'),
  'Normal becomes the compact N option code'
);

select ok(
  (select sku ~ '^CHE-YAOG-SP-[0-9]{3}$' from public.products where name = 'Cheki HSR Yaoguang SP'),
  'SP remains an explicit compact option code'
);

select ok(
  (select sku ~ '^HCL-KEIT-[0-9]{3}$' from public.products where name = 'Hairclip Keito'),
  'alphabetic item names use four readable characters'
);

select is(
  (select sku from public.products where name = 'Manual SKU Product'),
  'MY-OWN-7',
  'manual SKU remains unchanged apart from normalization'
);

select ok(
  (select sku_is_generated from public.products where name = 'Cheki HSR SW999'),
  'blank SKU is marked generated'
);

select isnt(
  (select sku_is_generated from public.products where name = 'Manual SKU Product'),
  true,
  'seller-provided SKU is marked manual'
);
```

Append ownership and stability checks after those assertions:

```sql
create temp table _automatic_sku_before as
select sku
from public.products
where name = 'Cheki HSR SW999';

update public.products
set name = 'Cheki HSR SW999 Renamed'
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Cheki HSR SW999';

select is(
  (select sku from public.products where name = 'Cheki HSR SW999 Renamed'),
  (select sku from _automatic_sku_before),
  'renaming a product does not regenerate its automatic SKU'
);

update public.products
set sku = sku
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select isnt(
  (select sku_is_generated from public.products where name = 'Manual SKU Product'),
  true,
  'submitting the unchanged manual SKU preserves manual ownership'
);

update public.products
set sku = null
where artist_id = (select artist_id from _campaign_ids)
  and name = 'Manual SKU Product';

select ok(
  (select sku_is_generated and sku ~ '^OTH-MANU-[0-9]{3}$'
   from public.products where name = 'Manual SKU Product'),
  'clearing an SKU regenerates it and restores automatic ownership'
);

insert into public.products (
  artist_id, name, category, price, currency, stock_total,
  stock_reserved, stock_sold, is_unlimited, status
) values
  ((select artist_id from _campaign_ids), 'Hairclip Batch', 'Hairclip', 100, 'THB', 1, 0, 0, false, 'enable'),
  ((select artist_id from _campaign_ids), 'Hairclip Batch', 'Hairclip', 100, 'THB', 1, 0, 0, false, 'enable');

select is(
  (select count(distinct sku) from public.products
   where artist_id = (select artist_id from _campaign_ids)
     and name = 'Hairclip Batch'),
  2::bigint,
  'a multi-row blank-SKU insert remains unique within one artist'
);

insert into public.artists (id, slug, display_name, is_public)
values ('44444444-4444-4444-8444-444444444444'::uuid, 'second-sku-artist', 'Second SKU Artist', false);

select lives_ok(
  $$ insert into public.products (
       artist_id, name, category, sku, price, currency, stock_total,
       stock_reserved, stock_sold, is_unlimited, status
     ) values (
       '44444444-4444-4444-8444-444444444444'::uuid,
       'Other shop product', 'Other', 'CAT-DUP-001', 100, 'THB', 1,
       0, 0, false, 'enable'
     ) $$,
  'different artists may use the same SKU'
);
```

Keep the existing final `order_items.sku_snapshot` assertion unchanged; it is the regression boundary that proves the migration does not rewrite historical orders.

- [ ] **Step 2: Run the focused database test and confirm the new contract fails**

Run:

```bash
supabase test db supabase/tests/online_campaign_test.sql
```

Expected: FAIL because `products.sku_is_generated` does not exist and the current generator emits long `YAOGUANG-*` item segments.

- [ ] **Step 3: Add the append-only migration and compact item-code function**

Create `supabase/migrations/20260904130000_compact_generated_product_skus.sql` with the existing type codes, a four-letter item segment, meaningful trailing digits, and `Normal`/`SP` option suffixes:

```sql
alter table public.products
  add column if not exists sku_is_generated boolean not null default true;

comment on column public.products.sku_is_generated is
  'True when sku was generated by Nireq; false after a seller supplies or edits it.';

create or replace function public.product_sku_item_code(
  p_name text,
  p_variant_name text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := upper(coalesce(nullif(trim(p_name), ''), 'ITEM'));
  v_option_source text := upper(coalesce(nullif(trim(p_variant_name), ''), v_name));
  v_tokens text[];
  v_token text;
  v_letters text;
  v_digits text;
  v_item text;
  v_option text := '';
begin
  if v_option_source ~ '(^|[^A-Z0-9])NORMAL([^A-Z0-9]|$)' then
    v_option := 'N';
  elsif v_option_source ~ '(^|[^A-Z0-9])SP([^A-Z0-9]|$)' then
    v_option := 'SP';
  end if;

  select array_agg(part order by ordinal)
  into v_tokens
  from regexp_split_to_table(regexp_replace(v_name, '[^A-Z0-9]+', ' ', 'g'), ' +')
       with ordinality parts(part, ordinal)
  where part <> ''
    and part not in ('CHEKI', 'HAIRCLIP', 'HAIR', 'CLIP', 'PHOTO', 'SET', 'FS', 'HSR', 'NORMAL', 'SP');

  v_token := coalesce(v_tokens[1], 'ITEM');
  if v_token ~ '^[A-Z]{1,3}$' and coalesce(v_tokens[2], '') ~ '^[0-9]+$' then
    v_token := v_token || v_tokens[2];
  end if;
  v_token := coalesce(nullif(regexp_replace(v_token, '[^A-Z0-9]', '', 'g'), ''), 'ITEM');
  v_letters := substring(v_token from '^([A-Z]+)');
  v_digits := substring(v_token from '([0-9]+)$');
  v_item := coalesce(nullif(left(coalesce(v_letters, ''), 4) || coalesce(v_digits, ''), ''), left(v_token, 8));

  return coalesce(nullif(v_item, ''), 'ITEM')
    || case when v_option = '' then '' else '-' || v_option end;
end;
$$;
```

This deliberately keeps the current `product_sku_type_code(...)`, unique `(artist_id, lower(sku))` index, and per-artist advisory lock. Do not add another sequence table or SKU service.

- [ ] **Step 4: Migrate only current product rows while preserving each numeric suffix**

In the same migration, stage current rows, temporarily move active SKUs out of the compact namespace, then process oldest-first so the earlier product keeps a colliding suffix:

```sql
create temporary table _compact_product_skus on commit drop as
select
  p.id,
  p.artist_id,
  p.created_at,
  public.product_sku_type_code(p.category, p.name)
    || '-' || public.product_sku_item_code(p.name, p.variant_name) as sku_base,
  coalesce((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer, 0) as old_sequence
from public.products p
where p.deleted_at is null;

update public.products p
set sku = 'MIG-' || replace(p.id::text, '-', ''),
    sku_is_generated = true
where p.deleted_at is null;

do $$
declare
  v_product record;
  v_sequence integer;
  v_candidate text;
begin
  for v_product in
    select * from _compact_product_skus order by artist_id, created_at, id
  loop
    v_sequence := v_product.old_sequence;
    if v_sequence <= 0 then
      select greatest(
        coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0),
        coalesce((select max(s.old_sequence) from _compact_product_skus s where s.artist_id = v_product.artist_id), 0)
      ) + 1
      into v_sequence
      from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null
        and p.sku ~ '-[0-9]+$';
    end if;

    v_candidate := v_product.sku_base || '-' || lpad(v_sequence::text, 3, '0');
    while exists (
      select 1 from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null
        and lower(p.sku) = lower(v_candidate)
        and p.id <> v_product.id
    ) loop
      select greatest(
        coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0),
        coalesce((select max(s.old_sequence) from _compact_product_skus s where s.artist_id = v_product.artist_id), 0)
      ) + 1
      into v_sequence
      from public.products p
      where p.artist_id = v_product.artist_id
        and p.deleted_at is null;
      v_candidate := v_product.sku_base || '-' || lpad(v_sequence::text, 3, '0');
    end loop;

    update public.products
    set sku = v_candidate,
        sku_is_generated = true
    where id = v_product.id;
  end loop;
end;
$$;
```

Do not update `order_items` in this migration. Deleted products are also left untouched because the uniqueness index excludes them and they are not active Catalog data.

- [ ] **Step 5: Replace the trigger with ownership-preserving behavior**

Define the trigger function after the one-time rewrite so migration updates are not mistaken for seller edits:

```sql
create or replace function public.generate_product_sku()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sequence integer;
begin
  if tg_op = 'UPDATE' and new.sku is not distinct from old.sku then
    new.sku_is_generated := old.sku_is_generated;
    return new;
  end if;

  if nullif(trim(coalesce(new.sku, '')), '') is not null then
    new.sku := upper(trim(new.sku));
    new.sku_is_generated := false;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.artist_id::text, 0));

  select coalesce(max((regexp_match(p.sku, '-([0-9]+)$'))[1]::integer), 0) + 1
  into v_sequence
  from public.products p
  where p.artist_id = new.artist_id
    and p.deleted_at is null
    and p.sku ~ '-[0-9]+$';

  new.sku := public.product_sku_type_code(new.category, new.name)
    || '-' || public.product_sku_item_code(new.name, new.variant_name)
    || '-' || lpad(v_sequence::text, 3, '0');
  new.sku_is_generated := true;
  return new;
end;
$$;

comment on function public.generate_product_sku() is
  'Generates a compact editable TYPE-ITEM[-OPTION]-SEQUENCE SKU when blank and records automatic/manual ownership.';
```

- [ ] **Step 6: Run the database test and commit the schema slice**

Run:

```bash
supabase migration up --local
supabase test db supabase/tests/online_campaign_test.sql
```

Expected: the new local migration applies, then pgTAP reports `1..52` with every assertion passing, including the existing historical `sku_snapshot` assertion.

Commit only the migration and pgTAP test:

```bash
git add supabase/migrations/20260904130000_compact_generated_product_skus.sql supabase/tests/online_campaign_test.sql
git commit -m "feat: compact generated product skus"
```

### Task 2: Establish explicit Catalog copy and the card-default shell

**Files:**
- Modify: `src/i18n.tsx:433-464`
- Modify: `src/i18n.tsx:1110-1141`
- Modify: `src/pages/creators/ManageProducts.tsx:2410-2490`
- Modify: `src/pages/creators/ManageProducts.tsx:3620-3710`
- Create: `src/tests/regression/catalog-workspace.spec.ts`

- [ ] **Step 1: Add a focused Catalog fixture and failing shell test**

Create `src/tests/regression/catalog-workspace.spec.ts` using the existing admin fixture instead of signing up from the UI:

```ts
import { expect, test, type Page } from '@playwright/test';
import { ensureOwnerArtistFixture } from '../helpers/adminFixture';

const EMAIL = 'catalog-workspace-e2e@nireq.local';
const PASSWORD = 'LocalOnlyCatalogWorkspace123!';
const SLUG = 'catalog-workspace-e2e';

let fixture: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>;
let productId = '';

async function login(page: Page) {
  await page.goto('/manage-login');
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /Login to Dashboard|Sign in|Login/i }).click();
  await expect(page).not.toHaveURL(/manage-login/, { timeout: 20_000 });
}

test.describe('catalog workspace', () => {
  test.beforeAll(async () => {
    fixture = await ensureOwnerArtistFixture({
      email: EMAIL,
      password: PASSWORD,
      slug: SLUG,
      displayName: 'Catalog Workspace E2E',
    });
    await fixture.service.from('products').delete().eq('artist_id', fixture.userId);
    const product = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Cheki HSR Yaoguang Normal',
      category: 'Cheki',
      variant_name: 'Normal',
      tags: ['HSR'],
      price: 350,
      currency: 'THB',
      stock_total: 12,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
      status: 'enable',
    }).select('id').single();
    if (product.error) throw product.error;
    productId = product.data.id;
    const manualSkuProduct = await fixture.service.from('products').insert({
      artist_id: fixture.userId,
      name: 'Manual SKU fixture',
      category: 'Other',
      sku: 'CAT-DUP-001',
      price: 100,
      currency: 'THB',
      stock_total: 1,
      stock_reserved: 0,
      stock_sold: 0,
      is_unlimited: false,
      status: 'enable',
    });
    if (manualSkuProduct.error) throw manualSkuProduct.error;
  });

  test.afterAll(async () => {
    if (fixture) await fixture.service.from('products').delete().eq('artist_id', fixture.userId);
  });

  test('uses product cards by default and preserves filters when switching to table', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');

    await expect(page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ })).toBeVisible();
    const cards = page.getByRole('button', { name: /Product cards|การ์ดสินค้า/ });
    const table = page.getByRole('button', { name: /^Table$|^ตาราง$/ });
    await expect(cards).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`catalog-card-${productId}`)).toBeVisible();

    const search = page.getByPlaceholder(/Search products|ค้นหาสินค้า/);
    await search.fill('Yaoguang');
    await table.click();

    await expect(search).toHaveValue('Yaoguang');
    await expect(table).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`catalog-row-${productId}`)).toContainText('Cheki HSR Yaoguang Normal');
  });

  test('keeps a duplicate manual SKU in the form and shows a friendly error', async ({ page }) => {
    await login(page);
    await page.goto('/manage-products');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/ }).click();
    await page.getByLabel(/Product name|ชื่อสินค้า/).fill('Different product name');
    await page.getByLabel(/Price & currency|ราคาและสกุลเงิน/).fill('100');
    await page.getByText(/Advanced details|ข้อมูลเพิ่มเติม/).click();
    await page.getByLabel('SKU').fill('cat-dup-001');
    await page.getByRole('button', { name: /^Add product$|^เพิ่มสินค้า$/ }).last().click();

    await expect(page.getByText(/SKU already exists|SKU นี้มีสินค้าใช้อยู่แล้ว/)).toBeVisible();
    await expect(page.getByLabel('SKU')).toHaveValue('CAT-DUP-001');
  });
});
```

- [ ] **Step 2: Run the shell test and confirm it fails on the old copy/test IDs**

Run:

```bash
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=desktop-chromium --grep "uses product cards"
```

Expected: FAIL because the page still says `Catalog Workspace`, `Visual`, and `Operations`, and no stable Catalog card/row test IDs exist.

- [ ] **Step 3: Add all touched Catalog translations in one place**

Add these keys to both locale objects in `src/i18n.tsx`:

```ts
// English
catalogTitle: 'Product catalog',
catalogSubtitle: 'Products shared across every sales channel',
catalogProducts: 'Products',
catalogMissingImages: 'Missing images',
catalogLowStock: 'Low stock',
catalogDisabled: 'Inactive',
catalogFindProducts: 'Find products',
catalogFindProductsHint: 'Search, filter, and sort before managing products.',
catalogProductCards: 'Product cards',
catalogTable: 'Table',
catalogResultCount: '{shown} of {total} products',
catalogTotalStock: 'Total stock',
catalogReadyToAllocate: 'Ready to allocate',
catalogInSalesChannels: 'In sales channels',
catalogReserved: 'Reserved',
catalogSoldOut: 'Sold out',
catalogChooseSalesChannel: 'Choose sales channel',
catalogAdjustStock: 'Adjust stock',
catalogIncreaseStock: 'Increase',
catalogDecreaseStock: 'Decrease',
catalogAddProductOption: 'Add product option',
catalogEditProduct: 'Edit product',
catalogDeleteProduct: 'Delete product',
catalogMoreActions: 'More actions for {name}',
catalogDuplicateSku: 'SKU already exists',
catalogDuplicateSkuDetail: 'Use a different SKU. Your entered value has been kept.',

// Thai
catalogTitle: 'คลังสินค้า',
catalogSubtitle: 'สินค้ากลางสำหรับทุกช่องทางขาย',
catalogProducts: 'สินค้า',
catalogMissingImages: 'ไม่มีรูป',
catalogLowStock: 'สต็อกใกล้หมด',
catalogDisabled: 'ปิดใช้งาน',
catalogFindProducts: 'ค้นหาสินค้า',
catalogFindProductsHint: 'ค้นหา กรอง และเรียงสินค้าก่อนจัดการ',
catalogProductCards: 'การ์ดสินค้า',
catalogTable: 'ตาราง',
catalogResultCount: '{shown} จาก {total} รายการ',
catalogTotalStock: 'สต็อกทั้งหมด',
catalogReadyToAllocate: 'พร้อมจัดสรร',
catalogInSalesChannels: 'อยู่ในช่องทางขาย',
catalogReserved: 'ถูกจอง',
catalogSoldOut: 'สต็อกหมด',
catalogChooseSalesChannel: 'เลือกช่องทางขาย',
catalogAdjustStock: 'ปรับสต็อก',
catalogIncreaseStock: 'เพิ่ม',
catalogDecreaseStock: 'ลด',
catalogAddProductOption: 'เพิ่มตัวเลือกสินค้า',
catalogEditProduct: 'แก้ไขสินค้า',
catalogDeleteProduct: 'ลบสินค้า',
catalogMoreActions: 'การทำงานเพิ่มเติมสำหรับ {name}',
catalogDuplicateSku: 'SKU นี้มีสินค้าใช้อยู่แล้ว',
catalogDuplicateSkuDetail: 'กรุณาใช้ SKU อื่น ระบบเก็บค่าที่กรอกไว้ให้แล้ว',
```

Reuse the existing `t(key, values)` interpolation API for counts and product names; do not add a second translation helper.

- [ ] **Step 4: Simplify the Catalog header and rename the mode controls**

In `ManageProducts.tsx`, retain the existing `'visual'` initial state, remove the `Catalog / Import` segmented control, and render the existing page-title wrapper only for event-scoped workspaces or Promotion. The unscoped Catalog/Import path uses the Catalog header below as its single title:

```tsx
{(isEventScopedWorkspace || activeWorkspaceTab === 'promotions') && (
  <div className="mx-auto mb-2 max-w-6xl px-4 pt-4 md:px-6">
    <h1 className="text-xl font-black tracking-tight text-gray-800">{pageTitle}</h1>
    <p className="text-sm font-bold text-pink-600">{pageSubtitle}</p>
  </div>
)}
```

Then use translated text in the Catalog header:

```tsx
<p className="text-xs font-black uppercase tracking-wide text-pink-600">
  {t('catalogTitle')}
</p>
<h2 className="mt-1 text-lg font-black text-gray-900">{t('catalogTitle')}</h2>
<p className="mt-1 max-w-2xl text-sm font-semibold text-gray-500">
  {t('catalogSubtitle')}
</p>

<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
  <button type="button" onClick={() => setIsAddProductModalOpen(true)}>
    <Plus size={16} aria-hidden="true" />
    {t('catalogAddProduct')}
  </button>
  <button type="button" onClick={() => setActiveWorkspaceTab('import')}>
    <Upload size={16} aria-hidden="true" />
    {t('catalogImportCsv')}
  </button>
</div>
```

Add `catalogImportCsv` in both locales (`Import CSV` / `นำเข้า CSV`). The existing `catalogDisabled` English value changes from `Disabled` to `Inactive`, so the edit form and table use the same status vocabulary. Replace the summary chip labels and filter heading with the translated keys. Rename only the visible mode labels; keep internal values `'visual' | 'operations'` to avoid unnecessary state churn:

```tsx
{([
  ['visual', LayoutGrid, t('catalogProductCards')],
  ['operations', List, t('catalogTable')],
] as const).map(([mode, Icon, label]) => (
  <button
    key={mode}
    type="button"
    onClick={() => setCatalogDisplayMode(mode)}
    aria-pressed={catalogDisplayMode === mode}
  >
    <Icon size={14} aria-hidden="true" />
    {label}
  </button>
))}
```

Add `data-testid={`catalog-card-${product.id}`}` to the card root and `data-testid={`catalog-row-${product.id}`}` to the desktop row. These identify domain rows without coupling tests to Tailwind classes.

Give both existing SKU inputs a real label association (`htmlFor="add-product-sku"` / `id="add-product-sku"` and `htmlFor="edit-product-sku"` / `id="edit-product-sku"`). In both add/update catches, translate the database uniqueness failure without closing or resetting the form:

```ts
const isDuplicateSkuError = (error: { code?: string; message?: string }) =>
  error.code === '23505' && String(error.message || '').includes('products_artist_sku_unique');

// In handleAddProduct catch:
if (isDuplicateSkuError(error)) {
  showToast({
    tone: 'error',
    title: t('catalogDuplicateSku'),
    detail: t('catalogDuplicateSkuDetail'),
  });
} else {
  showToast({ tone: 'error', title: 'Error adding product', detail: error.message });
}

// In handleUpdateProduct catch:
if (isDuplicateSkuError(error)) {
  showToast({
    tone: 'error',
    title: t('catalogDuplicateSku'),
    detail: t('catalogDuplicateSkuDetail'),
  });
} else {
  showToast({ tone: 'error', title: 'Error updating product', detail: error.message });
}
```

Keep the existing reset statements exclusively after a successful mutation. Do not clear `sku` in either error branch.

- [ ] **Step 5: Run the focused shell test and commit the copy/control slice**

Run:

```bash
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=desktop-chromium --grep "uses product cards|duplicate manual SKU"
```

Expected: PASS.

Commit:

```bash
git add src/i18n.tsx src/pages/creators/ManageProducts.tsx src/tests/regression/catalog-workspace.spec.ts
git commit -m "feat: clarify catalog workspace controls"
```

### Task 3: Build the focused table and consistent Catalog actions

**Files:**
- Modify: `src/pages/creators/ManageProducts.tsx:320-390`
- Modify: `src/pages/creators/ManageProducts.tsx:500-555`
- Modify: `src/pages/creators/ManageProducts.tsx:3835-4200`
- Modify: `src/pages/creators/ManageProducts.tsx:2160-2268`
- Modify: `src/tests/regression/catalog-workspace.spec.ts`

- [ ] **Step 1: Add failing table/action/accessibility tests**

Append these tests inside the existing `catalog workspace` describe block:

```ts
test('shows explicit focused-table stock columns and complete product data', async ({ page }) => {
  await login(page);
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();

  const row = page.getByTestId(`catalog-row-${productId}`);
  await expect(row).toContainText('Cheki HSR Yaoguang Normal');
  await expect(row).toContainText(/CHE-YAOG-N-[0-9]{3}/);
  await expect(row).toContainText('Cheki');
  await expect(row).toContainText('12');
  await expect(page.getByRole('columnheader', { name: /Total stock|สต็อกทั้งหมด/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Ready to allocate|พร้อมจัดสรร/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /In sales channels|อยู่ในช่องทางขาย/ })).toBeVisible();
  await expect(row.getByRole('button', { name: /Choose sales channel|เลือกช่องทางขาย/ })).toBeVisible();
  await expect(row.getByRole('button', { name: /Adjust stock|ปรับสต็อก/ })).toBeVisible();
});

test('chooses increase or decrease inside the existing stock dialog', async ({ page }) => {
  await login(page);
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();
  const row = page.getByTestId(`catalog-row-${productId}`);

  await row.getByRole('button', { name: /Adjust stock|ปรับสต็อก/ }).click();
  const dialog = page.getByRole('dialog', { name: /Adjust stock|ปรับสต็อก/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Increase|เพิ่ม/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: /Decrease|ลด/ }).click();
  await expect(dialog.getByText(/Reason|เหตุผล/)).toBeVisible();
});

test('secondary actions use one keyboard-safe menu', async ({ page }) => {
  await login(page);
  await page.goto('/manage-products');
  await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();
  const row = page.getByTestId(`catalog-row-${productId}`);
  const trigger = row.getByRole('button', { name: /More actions|การทำงานเพิ่มเติม/ });

  await trigger.focus();
  await trigger.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: /Add product option|เพิ่มตัวเลือกสินค้า/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Edit product|แก้ไขสินค้า/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Delete product|ลบสินค้า/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the new tests and verify the old dense table fails them**

Run:

```bash
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=desktop-chromium --grep "focused-table|stock dialog|keyboard-safe"
```

Expected: FAIL because the current table has one `Stock Flow` column, exposes six row actions, and has no `Adjust stock` chooser or accessible overflow menu.

- [ ] **Step 3: Replace Stock Flow with explicit reusable values**

Keep `getProductStockSummary` as the single source of truth. Replace `renderCatalogStockFlow` usages in Catalog cards/mobile rows with a compact summary and use direct values in desktop table cells:

```ts
const getCatalogStockValues = (product: Product) => {
  const summary = getProductStockSummary(product);
  return {
    total: Math.max(summary.on_hand || 0, 0),
    available: Math.max(summary.available || 0, 0),
    allocated: Math.max(summary.allocated || 0, 0),
    reserved: Math.max((summary.on_hand || 0) - (summary.available || 0) - (summary.allocated || 0), 0),
  };
};
```

For unlimited products, show `t('catalogUnlimited')` in all three stock cells. For finite rows render `total`, `available`, and `allocated`; show a small `Reserved {reserved}` / `ถูกจอง {reserved}` subline under `In sales channels` only when `reserved > 0`.

- [ ] **Step 4: Render the focused desktop table without shrinking the product column**

Replace the desktop header and cell layout with the approved eight columns. Use a fixed table layout and compact `px-3` cells so actions remain inside the workspace while Product keeps the largest width:

```tsx
<table className="w-full table-fixed border-collapse text-left">
  <thead>
    <tr className="border-b border-gray-100 bg-gray-50 text-[11px] text-gray-500">
      <th className="w-[29%] px-3 py-3 font-bold">{t('catalogProducts')}</th>
      <th className="w-[9%] px-3 py-3 font-bold">{t('catalogCategory')}</th>
      <th className="w-[8%] px-3 py-3 font-bold">{t('catalogPriceCurrency')}</th>
      <th className="w-[9%] px-3 py-3 text-center font-bold">{t('catalogTotalStock')}</th>
      <th className="w-[10%] px-3 py-3 text-center font-bold">{t('catalogReadyToAllocate')}</th>
      <th className="w-[11%] px-3 py-3 text-center font-bold">{t('catalogInSalesChannels')}</th>
      <th className="w-[8%] px-3 py-3 font-bold">{t('catalogStatus')}</th>
      <th className="w-[16%] px-3 py-3 text-right font-bold">{t('catalogActions')}</th>
    </tr>
  </thead>
</table>
```

Add `catalogActions` (`Actions` / `การทำงาน`) to `src/i18n.tsx`. Remove `line-clamp-1` from the table product name and give its text wrapper `min-w-0`; keep thumbnail, SKU, option, and up to three tags. Status badges use `catalogActive`, `catalogDisabled`, and `catalogSoldOut`. Preserve the existing `md:hidden` dense list for mobile rather than adding horizontal scrolling.

- [ ] **Step 5: Add one minimal menu controller shared by cards, mobile rows, and table rows**

Import `MoreHorizontal` and add one open-menu state plus refs near existing Catalog state:

```ts
const [catalogActionMenuKey, setCatalogActionMenuKey] = useState<string | null>(null);
const catalogActionMenuRef = useRef<HTMLDivElement>(null);
const catalogActionTriggerRef = useRef<HTMLButtonElement>(null);

const closeCatalogActionMenu = () => setCatalogActionMenuKey(null);

useEffect(() => {
  if (!catalogActionMenuKey) return;
  const handlePointerDown = (event: PointerEvent) => {
    if (!catalogActionMenuRef.current?.contains(event.target as Node)) setCatalogActionMenuKey(null);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      const trigger = catalogActionTriggerRef.current;
      setCatalogActionMenuKey(null);
      requestAnimationFrame(() => trigger?.focus());
    }
  };
  document.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('pointerdown', handlePointerDown);
    document.removeEventListener('keydown', handleKeyDown);
  };
}, [catalogActionMenuKey]);
```

Render the same action hierarchy in each Catalog surface. Give each instance a stable key such as `${surface}:${product.id}` so hidden responsive variants do not share an open state:

```tsx
<button type="button" onClick={() => void openAddToSale(product)}>
  {t('catalogChooseSalesChannel')}
</button>
{!product.is_unlimited && (
  <button
    type="button"
    onClick={() => openStockAction({ scope: 'catalog', kind: 'add', product })}
  >
    {t('catalogAdjustStock')}
  </button>
)}
<div className="relative" ref={catalogActionMenuKey === menuKey ? catalogActionMenuRef : undefined}>
  <button
    type="button"
    aria-haspopup="menu"
    aria-expanded={catalogActionMenuKey === menuKey}
    aria-label={t('catalogMoreActions', { name: product.name })}
    onClick={(event) => {
      catalogActionTriggerRef.current = event.currentTarget;
      setCatalogActionMenuKey((current) => current === menuKey ? null : menuKey);
    }}
  >
    <MoreHorizontal size={18} aria-hidden="true" />
  </button>
  {catalogActionMenuKey === menuKey && (
    <div role="menu" className="absolute right-0 top-10 z-20 w-52 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
      <button role="menuitem" onClick={() => { closeCatalogActionMenu(); openDuplicateVariants(product); }}>
        {t('catalogAddProductOption')}
      </button>
      <button role="menuitem" onClick={() => { closeCatalogActionMenu(); handleEditClick(product); }}>
        {t('catalogEditProduct')}
      </button>
      <button role="menuitem" onClick={() => { closeCatalogActionMenu(); requestDeleteProduct(product); }}>
        {t('catalogDeleteProduct')}
      </button>
    </div>
  )}
</div>
```

Use one local render function for this repeated block because it is consumed by three existing Catalog layouts; do not create a new component file or generalized menu framework.

- [ ] **Step 6: Turn the Catalog stock modal into Adjust stock with an increase/decrease switch**

Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="catalog-stock-dialog-title"` to the existing overlay section. For `scope === 'catalog'`, always title it `catalogAdjustStock` and place this control above Quantity:

```tsx
{stockAction.scope === 'catalog' && (
  <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
    {(['add', 'remove'] as const).map((kind) => (
      <button
        key={kind}
        type="button"
        aria-pressed={stockAction.kind === kind}
        onClick={() => {
          setStockAction((current) => current && current.scope === 'catalog' ? { ...current, kind } : current);
          setStockActionError('');
          if (kind === 'add') setStockActionReason('');
        }}
      >
        {kind === 'add' ? t('catalogIncreaseStock') : t('catalogDecreaseStock')}
      </button>
    ))}
  </div>
)}
```

Keep `handleStockAction`, `addCatalogStock`, `removeCatalogStock`, reason validation, post-action refresh, and existing toast behavior unchanged. Opening from Catalog defaults to `kind: 'add'`; users who need removal choose `Decrease` inside the dialog.

- [ ] **Step 7: Run the focused Catalog suite in desktop and mobile Chromium**

Run:

```bash
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=desktop-chromium
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=mobile-android-chrome-pixel5
```

Expected: PASS. Desktop shows the eight-column table without clipped actions; mobile keeps the dense vertical list and the same direct/menu actions.

- [ ] **Step 8: Commit the focused Catalog behavior**

```bash
git add src/i18n.tsx src/pages/creators/ManageProducts.tsx src/tests/regression/catalog-workspace.spec.ts
git commit -m "feat: add focused catalog table"
```

### Task 4: Update existing regression and security contracts

**Files:**
- Modify: `src/tests/regression/regression.spec.ts:100-135`
- Modify: `src/tests/regression/regression.spec.ts:441-490`
- Modify: `src/tests/security.extend.spec.ts:112-132`

- [ ] **Step 1: Make the existing edit helper open the new secondary-action menu**

Replace DOM-position assumptions in `findProductEditButton` with accessible action names. Switch to Table in the product-status test before locating the row:

```ts
async function findProductEditButton(page: Page, productName: string) {
  const row = page.getByRole('row').filter({ hasText: productName }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.getByRole('button', { name: /More actions|การทำงานเพิ่มเติม/ }).click();
    return page.getByRole('menuitem', { name: /Edit product|แก้ไขสินค้า/ });
  }

  const card = page.locator('[data-testid^="catalog-card-"]').filter({ hasText: productName }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: /More actions|การทำงานเพิ่มเติม/ }).click();
  return page.getByRole('menuitem', { name: /Edit product|แก้ไขสินค้า/ });
}
```

Immediately after loading `/manage-products` in the R2.1 status test, add:

```ts
await page.getByRole('button', { name: /^Table$|^ตาราง$/ }).click();
```

Change the disabled expectation from `/Disabled|DISABLED/` to `/Inactive|ปิดใช้งาน/`, and keep the sold-out expectation bilingual: `/Sold out|สต็อกหมด/`.

- [ ] **Step 2: Update the security smoke selectors without weakening the checks**

In `src/tests/security.extend.spec.ts`, use bilingual accessible selectors while preserving every injection payload and the result-count assertion:

```ts
const search = page.getByPlaceholder(/Search products|ค้นหาสินค้า/);
await expect(search).toBeVisible({ timeout: 20_000 });

for (const pattern of suspiciousPatterns) {
  await search.fill(pattern);
  await expect(page.getByRole('heading', { name: /Product catalog|คลังสินค้า/ })).toBeVisible();
}
```

- [ ] **Step 3: Run the affected legacy tests**

Run:

```bash
npx playwright test src/tests/regression/regression.spec.ts --project=desktop-chromium --grep "Product Status"
npx playwright test src/tests/security.extend.spec.ts --project=desktop-chromium --grep "Product search handles special characters"
```

Expected: PASS with the new menu and translated Catalog copy.

- [ ] **Step 4: Commit compatibility updates**

```bash
git add src/tests/regression/regression.spec.ts src/tests/security.extend.spec.ts
git commit -m "test: align catalog regressions with focused table"
```

### Task 5: Full verification and fresh-context review

**Files:**
- Review: `supabase/migrations/20260904130000_compact_generated_product_skus.sql`
- Review: `supabase/tests/online_campaign_test.sql`
- Review: `src/i18n.tsx`
- Review: `src/pages/creators/ManageProducts.tsx`
- Review: `src/tests/regression/catalog-workspace.spec.ts`
- Review: `src/tests/regression/regression.spec.ts`
- Review: `src/tests/security.extend.spec.ts`

- [ ] **Step 1: Run all risk-relevant database and browser checks**

```bash
supabase migration up --local
supabase test db supabase/tests/online_campaign_test.sql
npm run test:security
npx playwright test src/tests/regression/catalog-workspace.spec.ts --project=desktop-chromium --project=mobile-android-chrome-pixel5
```

Expected: all commands pass. This covers schema/SKU ownership, stock-management UI, authorization regressions, desktop layout, and the mobile dense-list fallback.

- [ ] **Step 2: Run the repository Definition of Done check**

```bash
npm run verify
```

Expected: lint, release checks, TypeScript build, and configured release tests all pass.

- [ ] **Step 3: Review only the intended diff with fresh context**

```bash
git status --short
git diff --check
git diff HEAD~3 -- supabase/migrations/20260904130000_compact_generated_product_skus.sql supabase/tests/online_campaign_test.sql src/i18n.tsx src/pages/creators/ManageProducts.tsx src/tests/regression/catalog-workspace.spec.ts src/tests/regression/regression.spec.ts src/tests/security.extend.spec.ts
```

Confirm:

- No write touches `order_items.sku_snapshot`.
- The SKU trigger preserves unchanged manual/generated ownership and still takes the per-artist advisory lock before generation.
- Cards are the initial mode and switching modes does not reset filters.
- Product names are not clamped in the desktop table.
- The action menu closes on Escape/outside click and restores trigger focus after Escape.
- Existing stock RPCs and delete confirmation remain the only mutation paths.
- Thai and English keys exist for every new visible Catalog label.
- The unrelated `.gitignore`, `docs/api/`, `docs/specs/`, and `scripts/docs/` worktree changes remain untouched.

- [ ] **Step 4: Fix only confirmed findings, then repeat verification**

If the review finds a concrete defect, patch the narrow owning file, rerun the closest failed command, then rerun:

```bash
npm run verify
```

Expected: PASS. Do not add speculative pagination, a new SKU service, a generalized menu component, Promotion integration, or cross-shop SKU prefixes.

- [ ] **Step 5: Commit any review fix separately**

Run only when Step 4 changed code:

```bash
git add supabase/migrations/20260904130000_compact_generated_product_skus.sql supabase/tests/online_campaign_test.sql src/i18n.tsx src/pages/creators/ManageProducts.tsx src/tests/regression/catalog-workspace.spec.ts src/tests/regression/regression.spec.ts src/tests/security.extend.spec.ts
git commit -m "fix: resolve catalog focused-table review findings"
```

Do not deploy as part of this implementation plan. A later explicit DEV deployment should apply the database migration first, then commit/push the final branch and run the existing DEV deployment command.
