# Online Campaign Stock and Settings Feedback

## Goal

Make Online Campaign stock allocation understandable without inventory experience, restore product images on the public storefront, and make saved pickup points and payment methods visible and difficult to duplicate accidentally.

## Product stock cards

Use these labels in Thai:

- **สต็อกทั้งหมด**: the product's catalog stock total.
- **พร้อมจัดสรร**: stock not committed to another active sale and available to this campaign.
- **แคมเปญนี้**: stock allocated to the current campaign.

Show a short allocation explanation below the totals. For example, when all 30 units are committed elsewhere: **อีก 30 ชิ้นอยู่ในช่องทางขายอื่น**. The complete breakdown, including sold or held units when present, must reconcile to the displayed total rather than implying that unavailable stock disappeared.

Keep the existing safe behavior: a product with no available stock may be included with zero campaign stock, but cannot oversell catalog inventory.

## Public storefront images

Resolve product image values through the same Menu storage-path handling used by the catalog workspace. Support both legacy relative storage paths and existing full URLs. If an image is missing or fails to load, show the existing product placeholder instead of a broken image.

No database model change is required for image storage.

## Pickup points and payment methods

Each settings section displays saved records before its add form:

- Show the saved count in the section heading.
- Render compact cards containing the information needed to identify each record.
- Mask sensitive payment identifiers in the list.
- Provide a remove action with confirmation.
- Keep the add form collapsed behind an explicit add button.

After a successful insert, close and reset the form, refresh the visible list, and show an accessible success toast naming the new record. On failure, keep the entered values and show an error toast.

Before inserting, compare normalized values against the records already loaded for this campaign. If the record is an exact duplicate, do not insert it and show a warning toast. Existing duplicates remain visible so the merchant can remove the unwanted records deliberately; the implementation must not delete campaign data automatically.

## Data flow and permissions

Reuse the existing Supabase tables and RLS policies. Owners and managers retain their current management access. Seller visibility remains unchanged. All additions and removals refresh the existing campaign workspace response so the UI reflects the database.

## Verification

- Add a regression assertion that legacy relative image paths resolve on the public campaign storefront and broken images fall back cleanly.
- Add browser coverage for the saved-list state, success feedback, duplicate prevention, and removal confirmation.
- Run the focused Online Campaign regression suite.
- Run the relevant security/RLS regression suite because settings records are protected campaign data.
- Run `npm run verify`.
- Commit and push before an approved DEV deployment; do not deploy PROD.
