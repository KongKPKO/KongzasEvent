# Online Campaign Order Communication and Product Table Design

Date: 2026-09-03
Status: Approved for implementation

## Goal

Make online campaigns practical for catalogs with many products, make generated SKUs useful to sellers, and make order/payment/settings feedback explicit without changing the existing 15-minute stock-hold rules.

## Campaign product table

Replace the large product cards in the campaign Products tab with the approved dense table layout (visual option B).

- Show a small product thumbnail, product name, SKU, category, price, total stock, stock ready to allocate, stock in this campaign, allocation input, and add/remove action.
- Add client-side search by product name or SKU.
- Add category and campaign-membership filters: all, in campaign, and not added.
- Keep name sorting, a visible result count, and clear-filters action.
- Paginate the already-loaded catalog so large catalogs do not become one long page.
- Preserve the current stock validation and zero-stock inclusion behavior.
- On narrow screens, keep the name/action visible and allow the operational columns to scroll horizontally.

The Catalog workspace is not redesigned in this change. Its existing Operations view is the reusable direction for a later consistency pass.

## Readable SKU generation

Replace the current `NQ-<random>` fallback with an editable, readable SKU generated when the seller leaves SKU blank.

Format:

`<TYPE>-<ITEM>-<SEQUENCE>`

Examples:

- `CHE-SW999-001`
- `HCL-KEITO-002`

Rules:

- Derive a short uppercase type code from the product category/type, with known useful abbreviations such as `CHE`, `HCL`, and `FS`.
- Derive the item segment from the product name or variant, removing punctuation and redundant type words.
- Use a three-digit per-artist sequence to prevent otherwise identical readable names from colliding.
- Keep manually entered SKUs unchanged apart from existing uppercase/trim normalization.
- Add an append-only migration that replaces current `NQ-*` SKUs on active products. Do not rewrite historical order-item SKU snapshots.
- Keep the existing per-artist unique index as the final integrity guard.

## Payment evidence preview

Open payment evidence in an accessible in-page modal instead of a new browser tab.

- Reuse the established Pre-order slip-preview interaction: signed URL loading, centered image, close button, Escape key, and backdrop close.
- Show order code, customer name, and expected amount next to the preview.
- Keep payment approval/rejection actions outside this first modal change to avoid changing the review workflow.

## Customer order status and tracking

The existing customer status URL remains the canonical link for the lifetime of the order:

`/:artistSlug/order/:orderCode`

On the status page:

- Label the carrier and tracking number separately.
- Add a copy-tracking action.
- Continue polling active orders so the same URL reflects payment and fulfillment changes.

## Campaign email notifications

Reuse the existing Resend delivery approach and idempotency pattern. Email failure must never roll back a completed order or seller action.

Normal flow sends at most two emails per order:

1. Order created: order number, summary, and canonical status link.
2. Customer action point:
   - shipping order: shipped, carrier, and tracking number;
   - pickup order: payment accepted and ready for pickup.

Send an additional exception email only when the customer must act or know about a problem, such as rejected payment or refund required.

The notification endpoint must verify the public order code for the creation event and authenticated artist role for seller-triggered events. Delivery claims must be idempotent so retries do not send duplicates.

## Explicit campaign settings save

Campaign name, flat shipping fee, shipping enabled, and pickup enabled become controlled draft fields.

- Editing a field does not write immediately.
- Show one `Save changes` button, disabled when unchanged or while saving.
- On success, refresh the workspace and show the existing saved toast/feedback.
- On failure, retain the draft values and show the existing error feedback.
- Publish remains a separate action and requires settings to be saved first.
- Cancel and archive remain explicit confirmed actions and are not mixed into the settings draft.

## Verification

- Regression coverage for table search/filter/pagination, explicit settings save, evidence modal, tracking labels/copy, and readable new SKU generation.
- Migration assertions for legacy `NQ-*` conversion, manual SKU preservation, uniqueness, and historical snapshot preservation.
- Notification security tests for public order-code verification, artist authorization, state validation, and duplicate delivery claims.
- Run the online-campaign regression suite, security suite, and `npm run verify`.

