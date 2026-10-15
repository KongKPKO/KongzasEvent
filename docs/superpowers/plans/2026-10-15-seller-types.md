# Seller type presentation

Outcome: creator / cosplayer / shop selected at registration, editable in profile, reflected across shop-specific TH/EN copy. Existing shops remain creator. This does not change permissions or certify licensing.

- [x] Add validated seller_type and preserve signup and public data contracts in an append-only migration; test role boundaries and defaults.
- [x] Use one frontend label mapping, add profile/registration controls, use neutral wording for general entry screens.
- [x] Carry type through storefront, discovery, queue and order views, preserving legacy creator fallback.
- [x] Run focused signup/profile/public tests, all npm run verify checks, and fresh diff review.

Preserve preceding uncommitted banner/gallery/payment edits. No remote migration or deploy in this task without release authorization. Rollback of a deployed migration is forward-only; old clients remain compatible with default creator.

Validation: isolated local Supabase API60321; npm run verify passed (25 SQL suites / 550 assertions, 105 Chromium tests, five stock concurrency checks and eight API smoke checks). Additional public entry responsive/browser tests passed. Signup selects cosplayer, confirmed workspace preserves it, profile changes to shop and survives reload; frontend labels cover all three types and legacy fallback. No remote migrations, commits or deployments in this task.
