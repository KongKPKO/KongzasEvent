# Online Campaign Product Table Fit

## Goal

Keep the full product column while fitting the rightmost action column inside the campaign workspace on a standard desktop viewport.

## Design

- Preserve the current product image, name, SKU, allocation note, and minimum product-column width.
- Reduce horizontal padding and width only in category, numeric, price, limit, and action columns.
- Give the table explicit compact column widths so browser auto-layout cannot let intermediate columns push actions outside the card.
- Keep horizontal scrolling as the fallback on narrower screens; do not hide product or stock information.
- Do not change campaign behavior, validation, or data.

## Acceptance

- The complete action button and supporting text are visible at the desktop width shown in the reported screenshot.
- Product content remains the same size and does not wrap more aggressively than before.
- Included-product inputs remain usable.
- Narrow screens can scroll horizontally without clipping content.
