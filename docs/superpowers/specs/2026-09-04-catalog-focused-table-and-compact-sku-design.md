# Catalog Focused Table and Compact SKU Design

**Date:** 2026-09-04  
**Status:** Approved for written review

## Goal

Make the existing Catalog card and table modes immediately understandable, make the dense table usable for large catalogs, and shorten automatic SKUs without overwriting later seller-authored identifiers or historical order snapshots.

## Confirmed direction

- Keep both existing Catalog display modes.
- **Product cards remain the default.**
- Rename the modes to **Product cards / Table** (`การ์ดสินค้า / ตาราง`).
- Redesign the table using the compact visual hierarchy proven in Online Campaign.
- Keep the product column readable and reduce action clutter.
- Do not add a shop prefix to SKU because SKU uniqueness is scoped to one artist/shop.

## Catalog header and controls

Use one clear Catalog header:

- Thai title: `คลังสินค้า`
- English title: `Product catalog`
- Thai description: `สินค้ากลางสำหรับทุกช่องทางขาย`
- English description: `Products shared across every sales channel`

Remove the duplicate `Catalog / Import` segmented control. Keep the explicit header actions:

- `เพิ่มสินค้า` / `Add product`
- `นำเข้า CSV` / `Import CSV`

Keep the existing search, category, tag, stock/image-state, currency, and sort controls. Changed Catalog surfaces use explicit Thai and English translation keys rather than adding more DOM text replacement.

## Display modes

### Product cards — default

Keep the image-led product cards for checking photos and storefront readiness. Use the same action wording and hierarchy as the table so changing modes does not change the seller's mental model.

### Focused table

The desktop table shows these columns:

1. Product: thumbnail, full readable name, SKU, and compact variant/tag context.
2. Category.
3. Price.
4. Total stock.
5. Ready to allocate.
6. In sales channels.
7. Status.
8. Actions.

Use explicit values instead of the current compressed Stock Flow visualization. Preserve a wide product column and fit the action column inside the Catalog workspace. On mobile, this mode renders as the existing dense vertical list rather than requiring horizontal table scrolling.

## Copy

| Current | English | Thai |
|---|---|---|
| Visual | Product cards | การ์ดสินค้า |
| Operations | Table | ตาราง |
| On hand | Total stock | สต็อกทั้งหมด |
| Available | Ready to allocate | พร้อมจัดสรร |
| Allocated / Event | In sales channels | อยู่ในช่องทางขาย |
| Held | Reserved | ถูกจอง |
| Active | Active | ใช้งาน |
| Disabled | Inactive | ปิดใช้งาน |
| Sold out | Sold out | สต็อกหมด |

## Row actions

Show only two frequent actions directly:

- `Choose sales channel` / `เลือกช่องทางขาย` opens the existing Event or Online Campaign allocation flow.
- `Adjust stock` / `ปรับสต็อก` opens the existing stock dialog with a clear Increase/Decrease (`เพิ่ม/ลด`) choice inside it.

Move secondary actions into one accessible `•••` menu:

- `Add product option` / `เพิ่มตัวเลือกสินค้า` opens the existing variant creation flow.
- `Edit product` / `แก้ไขสินค้า`.
- `Delete product` / `ลบสินค้า`.

The menu is keyboard-operable, closes with Escape or an outside click, and returns focus to its trigger. Deletion keeps the existing confirmation. Stock constraints and success/error toasts remain authoritative.

## Compact automatic SKU

### Format

Automatic SKU format:

```text
<TYPE>-<ITEM>[-<OPTION>]-<SEQUENCE>
```

Examples:

- `Cheki HSR SW999` → `CHE-SW999-009`
- `Cheki HSR Yaoguang Normal` → `CHE-YAOG-N-010`
- `Cheki HSR Yaoguang SP` → `CHE-YAOG-SP-011`
- `Hairclip Keito` → `HCL-KEIT-012`

Rules:

- Keep the existing useful type codes such as `CHE`, `HCL`, and `FS`.
- Remove product-type noise before deriving the item segment.
- Shorten the main alphabetic identifier to four characters while preserving meaningful adjacent digits, so `Yaoguang` becomes `YAOG` and `SW999` remains `SW999`.
- Recognize explicit option suffixes used by this catalog: `Normal` becomes `N` and `SP` remains `SP`.
- Use the structured option/variant value when available; otherwise use the product name as a fallback.
- Keep a three-digit sequence unique within each artist/shop.
- Do not include the shop name or shop code in SKU. Cross-shop exports must use a separate artist/shop identifier column.
- Automatic SKU stays stable when the product name changes.
- SKU remains editable by the seller.

### Generation ownership

Add `products.sku_is_generated boolean not null default true` so future writes distinguish automatic and manual identifiers.

- Blank SKU on insert or explicit regeneration: generate a compact SKU and set `sku_is_generated = true`.
- Seller-provided SKU on insert: normalize it and set `sku_is_generated = false`.
- Seller changes an existing SKU: normalize it and set `sku_is_generated = false`.
- An update that sends the existing unchanged SKU preserves its current ownership flag.
- Clearing an SKU requests regeneration and returns it to automatic ownership.

The unique `(artist_id, lower(sku))` index remains the final collision guard. Generation retains the existing per-artist transaction lock.

## Existing SKU migration

The owner confirmed there are no real users with manually authored SKU values yet. An append-only migration may therefore mark existing non-deleted product SKUs as generated and rewrite them into the compact format once.

- Preserve the existing numeric sequence suffix whenever one exists.
- Preserve each suffix first. If two compacted values still collide, keep the earlier-created row's suffix and give the later row the next unused per-artist sequence.
- Do not modify `order_items.sku_snapshot` or any other historical order snapshot.
- After this migration, only rows marked `sku_is_generated = true` are eligible for automatic regeneration tools or future automatic format migrations.

## Errors and edge cases

- A duplicate manual SKU is rejected with translated, non-database error copy and the seller's entered value remains in the form.
- A name that cannot produce a useful item segment falls back to `ITEM`; the seller can edit it.
- Unlimited-stock products show `Unlimited / ไม่จำกัด` instead of numeric stock columns.
- Stock adjustment continues to use existing server validation and cannot reduce below allocated, held, or sold quantities.
- Failed Catalog actions keep the current data on screen and show the existing error toast.

## Verification

### Catalog UI

- Product cards are selected on initial Catalog load.
- Switching between Product cards and Table preserves search and filters.
- The focused desktop table displays complete product names and all action controls without clipping.
- Mobile Table mode remains a usable dense vertical list.
- Choose sales channel, Adjust stock Increase/Decrease, and each secondary menu action reach the existing correct flows.
- The menu supports keyboard focus, Escape, outside click, and focus restoration.
- Touched Catalog copy is complete in Thai and English.

### SKU and data safety

- New blank SKU produces each approved compact example.
- Seller-provided and seller-edited SKUs are marked manual and remain unchanged by later product-name edits.
- Unchanged form submissions preserve SKU ownership.
- Clearing SKU regenerates and marks it automatic.
- Existing automatic SKUs retain their numeric suffix after migration.
- Concurrent creation remains unique per artist.
- Two artists may use the same SKU.
- Existing `order_items.sku_snapshot` values remain unchanged.

Run the focused Catalog regression, database migration tests, security suite, and `npm run verify` before handoff. Because this changes schema and stock-management UI, deploy database migration before frontend when the owner later authorizes a DEV deployment.

## Out of scope

- Rebuilding the variant editor; this change only renames and routes the existing action.
- Promotion integration.
- A global cross-shop SKU namespace or shop-prefixed SKU.
- Changes to Event or Online Campaign stock-accounting rules.
