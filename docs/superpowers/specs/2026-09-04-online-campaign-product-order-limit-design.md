# Online Campaign Product Order Limit Design

## Goal

Let a merchant set an optional maximum quantity per order for each product in an Online Campaign, preventing one order from taking too much of a limited item.

## Product rules

- The limit belongs to a campaign product, not the catalog product or campaign as a whole.
- A blank limit means unlimited. Existing campaign products remain unlimited by default.
- A configured limit must be a positive integer.
- The limit applies independently to each product in one order. It does not aggregate a customer's separate orders.
- Stock availability remains a separate, stricter ceiling when less stock is available than the configured order limit.

## Merchant experience

The campaign product table adds a compact "Max / order" field beside campaign price for included products. The merchant can enter a positive whole number or clear the field for unlimited. The existing save-on-blur behavior saves stock, price, and limit together through the campaign product RPC.

## Customer experience

The storefront shows the configured per-order limit below the remaining-stock copy. Quantity controls stop at the lower of available stock and the per-order limit. The increase button is disabled at that ceiling.

If checkout is rejected because the submitted quantity exceeds the limit, the customer sees a specific message instead of a generic checkout failure.

## Data and enforcement

`online_campaign_products.max_quantity_per_order` is a nullable positive integer. Public storefront and merchant workspace RPC responses include it. `save_online_campaign_products` validates and persists it.

`create_online_campaign_order` enforces the limit inside the same transaction and locked campaign-product row used for stock reservation. A request above the limit raises `campaign_product_order_limit_exceeded` before stock is reserved, so direct RPC callers cannot bypass the storefront.

## Compatibility and scope

Existing rows use `NULL` and preserve current unlimited-per-order behavior. This change does not add customer identity tracking, cross-order limits, cart-wide limits, or changes to physical events and pre-orders.

## Verification

- Database tests cover null/unlimited, equal-to-limit success, above-limit rejection, and unchanged reserved stock after rejection.
- Browser regression covers merchant configuration, public display, and quantity control ceiling.
- Existing Online Campaign regression, stock/security tests, and `npm run verify` must pass.
