# EventQueueSocial Agent Guide

## Scope

- Work inside this repository unless the user explicitly expands the scope.
- Read `PRODUCT.md` before product or UI decisions.
- Treat `PRODUCT.md` → Commerce Rules as the canonical business-rule summary; follow its linked specs and regression anchors for money, stock, Campaign and Promotion work. Flag contradictions rather than inventing new behavior.
- Preserve unrelated changes and untracked files.
- Reuse existing code and dependencies; do not add infrastructure for speculative needs.
- Read the files needed to understand the affected flow; expand only when dependencies or unresolved questions require it. Load skills only when relevant to the task.

## Commands

```bash
npm ci
npm run dev
npm run verify
```

Use the narrowest existing test while developing. Run `npm run verify` before handing off a code change.

## Definition of Done

- The requested behavior works through the real user flow.
- For code changes, `npm run verify` passes.
- Changes to money, stock, authentication, authorization, or RLS also run the relevant regression or security test.
- Report any skipped check or environment limitation; never describe an unrun check as passing.
- Continue through implementation, relevant validation, and fixes caused by this change. For UI changes, exercise the affected user flow in a browser when available.
- Resolve routine, reversible implementation choices within the requested scope. Ask when missing information materially changes the outcome or an action requires approval under Safety; do not ask again for authorization already given for that action and target.

## Safety

- Never deploy to production or apply remote Supabase migrations without explicit user approval.
- For an approved DEV or PROD deploy, commit the intended code changes and push the current branch to `origin` before deploying; do not wait for a separate push reminder.
- Never expose privileged backend credentials to browser code, logs, commits, or chat output.
- Migration files are append-only; do not rewrite migration history unless explicitly requested.
- Confirm the target environment before commands that can mutate data.

## Review Loop

For code changes, implement, run the narrow check, run `npm run verify`, and review the diff once with fresh context. If the review leads to code changes, fix confirmed findings and rerun the affected checks and `npm run verify`. Stop when checks pass and no material concern remains; do not repeat unchanged checks without a reason. For documentation-only changes, check the diff and any referenced paths or commands; runtime tests are unnecessary unless executable behavior is affected.
