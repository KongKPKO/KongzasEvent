# Agent Verification Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents one reliable local verification command, repair the CI Playwright project mismatch, and document repository safety boundaries.

**Architecture:** Reuse the existing npm, release-check, Playwright, and GitHub Actions setup. Add no dependency or custom runner: `npm run verify` composes existing checks, CI uses the configured Playwright project name, and a short root `AGENTS.md` defines completion and safety rules.

**Tech Stack:** npm scripts, TypeScript/Vite, Playwright, GitHub Actions.

---

### Task 1: Repair CI verification

**Files:**
- Modify: `.github/workflows/ci-pipeline.yml`

- [x] **Step 1: Reproduce the invalid project selection**

Run `npx playwright test src/tests/public-i18n-smoke.spec.ts --project=chromium --list`.

Expected: FAIL with `Project(s) "chromium" not found` and list `desktop-chromium` as available.

- [x] **Step 2: Add deterministic static checks**

After `npm ci`, run `npm run lint && npm run build` with the existing CI Supabase frontend variables.

- [x] **Step 3: Use the configured Playwright project**

Replace every CI-only `--project=chromium` argument with `--project=desktop-chromium`.

- [x] **Step 4: Validate the workflow references**

Run `rg -n -- '--project=(chromium|desktop-chromium)|npm run lint|npm run build' .github/workflows/ci-pipeline.yml`.

Expected: no `--project=chromium`; static checks and `desktop-chromium` are present.

### Task 2: Add the canonical local gate

**Files:**
- Modify: `package.json`

- [x] **Step 1: Compose existing checks**

Add `"verify": "npm run lint && npm run test:release"`.

This reuses hygiene scanning, environment validation, build, desktop Chromium public smoke tests, and local API smoke checks already implemented by `test:release`.

- [x] **Step 2: Confirm npm exposes the command**

Run `npm pkg get scripts.verify`.

Expected: `"npm run lint && npm run test:release"`.

### Task 3: Document agent boundaries

**Files:**
- Create: `AGENTS.md`

- [x] **Step 1: Add the smallest useful guide**

Document repository scope, source-of-truth files, common commands, the `npm run verify` completion gate, targeted checks for money/stock/auth/RLS changes, preservation of unrelated work, secret handling, and explicit approval for production deploys or remote migrations.

- [x] **Step 2: Keep the guide short**

Run `wc -l AGENTS.md`.

Expected: fewer than 60 lines.

### Task 4: Close the loop once

**Files:**
- Verify: `.github/workflows/ci-pipeline.yml`
- Verify: `package.json`
- Verify: `AGENTS.md`

- [x] **Step 1: Run the canonical gate**

Run `npm run verify`.

Expected: lint, repository hygiene, environment validation, build, public Playwright smoke, and local API smoke all pass. If an existing project defect fails the gate, fix only the root cause needed to make this gate trustworthy, then rerun it.

- [x] **Step 2: Review the final diff**

Run `git diff --check` and inspect the four scoped files.

Expected: no whitespace errors and only scoped changes.
