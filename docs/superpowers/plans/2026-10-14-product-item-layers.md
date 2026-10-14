# Product item layers and per-item photo galleries

Approved: category → main product → sellable item; tags filter by series. Photoset items each own their images; retain current gallery limits and existing data. Thai editor terminology uses รายการสินค้า; SKU remains generated and editable under Advanced.

- [x] Append nullable per-item gallery override; preserve shared-gallery inheritance, item UUIDs, SKU, stock, allocations, orders and auth/stale-save guards. Add SQL regression.
- [x] Simplify ProductFamilyEditor, per-item upload/preview, SKU/URLs under Advanced.
- [x] Group Event visual cards by product parent; retain per-item channel enable/price/stock. Show parent/category in flat tables. Reuse gallery media.
- [x] Align catalog/customer/Campaign/POS and CSV with item gallery; prevent menus clipping outside cards.
- [x] Browser regression for two series, separate 3/4-photo items, reload/edit, customer/POS, event allocation, menus/mobile; npm run verify and fresh diff review.

Validate only on disposable local NireqDevLocalization20261013 (API60321). Temporary pause of four original stacks is authorized; restore exact containers afterward. No production changes. Remote DEV schema migration requires explicit target/action authorization before application; prepare validated code first. No destructive conversion of existing families or gallery truncation. Revert frontend release if needed; do not delete saved gallery data.

Validation: fresh disposable migration reset succeeded; npm run verify passed (96 browser tests, 24 SQL suites / 525 assertions, five stock races, eight API smoke checks). DEV dry-run lists only 20261014043626_product_variant_gallery_images.sql; remote application remains pending approval.
