# Promotion Searchable Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Promotion category and tag inputs immediately recognizable as searchable catalog selections.

**Architecture:** Keep the existing native `input` and `datalist` behavior. Add presentation-only affordances in `PromotionManager`: localized placeholder/helper copy and a decorative chevron positioned inside each input.

**Tech Stack:** React, TypeScript, Tailwind CSS, native HTML datalist

---

### Task 1: Clarify the searchable selection fields

**Files:**
- Modify: `src/components/promotions/PromotionManager.tsx`

- [ ] **Step 1: Add a reusable local searchable-selection renderer**

Add a small local function inside `PromotionManager` that renders the existing label, input, datalist, decorative chevron, and localized helper text. Keep `value`, `onChange`, suggestion IDs, and suggestion arrays controlled by the parent state.

- [ ] **Step 2: Replace the category and tag input blocks**

Use the renderer for both fields with these Thai placeholders: `เลือกหรือพิมพ์ค้นหาหมวดหมู่` and `เลือกหรือพิมพ์ค้นหาแท็ก`. Use matching English copy and hide the chevron from assistive technology.

- [ ] **Step 3: Verify the implementation**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit successfully. Manually confirm the category and tag fields retain typing, native suggestion selection, and keyboard behavior.

- [ ] **Step 4: Commit**

```bash
git add src/components/promotions/PromotionManager.tsx docs/superpowers/plans/2026-09-06-promotion-searchable-select.md
git commit -m "fix: clarify searchable promotion fields"
```
