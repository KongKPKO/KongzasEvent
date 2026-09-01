# EventQueueSocial Agent Guide

## Scope

- Work inside this repository unless the user explicitly expands the scope.
- Read `PRODUCT.md` before product or UI decisions.
- Preserve unrelated changes and untracked files.
- Reuse existing code and dependencies; do not add infrastructure for speculative needs.

## Commands

```bash
npm ci
npm run dev
npm run verify
```

Use the narrowest existing test while developing. Run `npm run verify` before handing off a code change.

## Definition of Done

- The requested behavior works through the real user flow.
- `npm run verify` passes.
- Changes to money, stock, authentication, authorization, or RLS also run the relevant regression or security test.
- Report any skipped check or environment limitation; never describe an unrun check as passing.

## Safety

- Never deploy to production or apply remote Supabase migrations without explicit user approval.
- For an approved DEV or PROD deploy, commit the intended code changes and push the current branch to `origin` before deploying; do not wait for a separate push reminder.
- Never expose privileged backend credentials to browser code, logs, commits, or chat output.
- Migration files are append-only; do not rewrite migration history unless explicitly requested.
- Confirm the target environment before commands that can mutate data.

## Review Loop

Implement, run the narrow check, run `npm run verify`, review the diff once with fresh context, fix confirmed findings, and verify again. Add more review rounds only for unresolved high-risk findings.
