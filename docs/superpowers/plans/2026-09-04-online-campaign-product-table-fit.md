# Online Campaign Product Table Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing product column size while fitting every campaign product table column, including actions, inside a standard desktop workspace.

**Architecture:** Retain the current semantic table and horizontal-scroll wrapper. Constrain browser table layout with an explicit `colgroup`, reduce only non-product cell padding/input widths, and lower the table minimum width to the compact column total.

**Tech Stack:** React, TypeScript, Tailwind CSS, Playwright

---

### Task 1: Add the desktop fit regression

**Files:**
- Modify: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Add a failing geometry check**

In the existing merchant campaign workspace test, verify that the table does not require horizontal scrolling at the desktop test viewport and that the product cell stays at least 250px wide:

```ts
const campaignTable = page.getByRole('table');
await expect.poll(() => campaignTable.evaluate((table) => {
  const scroller = table.parentElement;
  return Boolean(scroller && scroller.scrollWidth <= scroller.clientWidth + 1);
})).toBe(true);
const productCellWidth = await campaignRow.locator('td').first().evaluate((cell) => cell.getBoundingClientRect().width);
expect(productCellWidth).toBeGreaterThanOrEqual(250);
```

- [ ] **Step 2: Run the focused test and confirm the current layout fails**

Run:

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "merchant sees campaign workspace"
```

Expected: FAIL because the table scroll width exceeds its visible desktop width.

### Task 2: Compact the non-product columns

**Files:**
- Modify: `src/pages/creators/OnlineCampaignWorkspace.tsx:618-700`
- Test: `src/tests/regression/online-campaign.spec.ts`

- [ ] **Step 1: Fix the table at compact explicit widths**

Change the table to `table-fixed min-w-[1080px]`, add a `colgroup` whose first column remains 300px, and allocate compact widths to the remaining columns:

```tsx
<table className="w-full min-w-[1080px] table-fixed border-collapse text-left">
  <colgroup>
    <col className="w-[300px]" />
    <col className="w-[80px]" />
    <col className="w-[90px]" />
    <col className="w-[90px]" />
    <col className="w-[90px]" />
    <col className="w-[110px]" />
    <col className="w-[130px]" />
    <col className="w-[190px]" />
  </colgroup>
```

- [ ] **Step 2: Reduce only non-product spacing**

Keep the product cell at `px-3` with `min-w-[250px]`. Change the other cells from `px-3` to `px-2`, and reduce the three editable input widths from `w-24/w-28/w-28` to `w-20/w-24/w-24`.

- [ ] **Step 3: Run the focused regression**

Run:

```bash
npx playwright test src/tests/regression/online-campaign.spec.ts --project=desktop-chromium --grep "merchant sees campaign workspace"
```

Expected: PASS; the desktop table has no horizontal overflow and the product cell remains at least 250px wide.

- [ ] **Step 4: Run repository verification**

Run:

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 5: Review and commit**

Review the diff for unrelated changes, then commit only the table and regression files:

```bash
git add src/pages/creators/OnlineCampaignWorkspace.tsx src/tests/regression/online-campaign.spec.ts
git commit -m "fix: fit campaign product table actions"
```
