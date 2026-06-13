# Product Variant Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let creators group existing sellable products into variant folders while keeping each variant as its own product with separate price, stock, and order history.

**Architecture:** Add optional variant metadata columns to `public.products` and expose them through `list_event_products`. The UI treats products sharing `variant_group_name` as a folder, but stock, cart items, event catalog rows, and order items continue to use the existing product id.

**Tech Stack:** Supabase Postgres migrations, React, TypeScript, Vite, Tailwind CSS.

---

### Task 1: Database Metadata

**Files:**
- Modify: `supabase/migrations/20260613153704_product_variant_folders.sql`

- [x] **Step 1: Add optional columns**

```sql
alter table public.products
  add column if not exists variant_group_name text,
  add column if not exists variant_name text,
  add column if not exists variant_sort_order integer not null default 0;
```

- [x] **Step 2: Recreate `list_event_products` with the new fields**

Use the latest stock lifecycle function body and append `variant_group_name`, `variant_name`, and `variant_sort_order` to both event-catalog and fallback result sets.

### Task 2: Shared Normalization And Types

**Files:**
- Modify: `src/utils/schemaCompat.ts`
- Modify: product interfaces in menu, POS, and catalog pages

- [x] **Step 1: Normalize blank variant fields**

Blank folder or variant names become `null`; sort order becomes a finite number or `0`.

- [x] **Step 2: Add optional fields to product interfaces**

Every consumer can safely receive the fields from Supabase without changing cart or stock behavior.

### Task 3: Creator Catalog Editing

**Files:**
- Modify: `src/pages/creators/ManageProducts.tsx`

- [x] **Step 1: Add form state**

Add `variantGroupName`, `variantName`, and `variantSortOrder`.

- [x] **Step 2: Save fields on add/edit/import**

CSV aliases include `variant_group`, `variant_group_name`, `folder`, `variant_name`, `variant`, and `variant_sort_order`.

- [x] **Step 3: Show folder context**

Catalog and event catalog rows show a folder/variant hint without changing existing event stock controls.

### Task 4: Selling Surfaces

**Files:**
- Modify: `src/components/menu/ProductList.tsx`
- Modify: `src/components/dashboard/PosPanel.tsx`

- [x] **Step 1: Group menu products**

Products with the same `variant_group_name` render under a section header; each variant remains an addable product.

- [x] **Step 2: Group POS products**

POS renders folder headers and keeps compact/visual product cards as existing add-to-cart controls.

### Task 5: Verification

**Commands:**

```bash
npm run build
```

Expected: build completes successfully.
