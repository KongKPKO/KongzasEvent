# NireQ Engineering Notes

Read only the section relevant to the affected flow. Verify current schemas and callers; these notes do not authorize changes to business rules. Product and UX context lives in [PRODUCT.md](../PRODUCT.md).

## Queue Domain

Queue fairness and operational clarity are core product concerns.

When touching queue behavior, consider:

- service type
- queue position
- customer status
- booth open/closed state
- staff actions
- calling and serving transitions
- missed or expired customers
- duplicate actions
- refresh/reconnect behavior
- concurrency between multiple staff devices
- permissions
- what the customer sees versus what staff sees

Do not change queue ordering, eligibility, expiry, or transition rules casually. Trace the existing behavior first because small changes can affect fairness.

Prefer explicit state transitions over scattered boolean logic.

## POS and Inventory Domain

For products and stock, prefer conventional retail concepts when they make the interface easier to understand.

Keep these concepts distinct when the product requires them:

- Product: the thing being sold
- Variant: a purchasable variation such as size or design
- SKU: an identifier for a sellable inventory item
- Stock on hand: current physical quantity
- Stock movement: why quantity changed
- Sale item: what was purchased in a transaction

Avoid creating SKU complexity when the booth does not need it, but do not collapse concepts together in ways that make future stock tracking unreliable.

Inventory changes should be auditable where practical.

Avoid silently modifying stock without a traceable reason.

## Supabase and Database Work

Treat database and RLS changes as high-impact.

Before changing database behavior:

- inspect related tables, migrations, RPCs, policies, and callers as needed;
- understand ownership and role boundaries;
- search for existing helpers or RPC patterns.

For schema changes:

- prefer explicit migrations;
- preserve existing data unless the requested change intentionally transforms it;
- consider backward compatibility with deployed clients when relevant.

For RLS:

- default to least privilege;
- never solve an access problem by broadly disabling or weakening RLS;
- verify that owner, manager, seller, queue staff, public/kiosk, and unauthenticated behavior remain appropriately separated where applicable.

Do not expose service-role credentials or secrets to client code.

Prefer server/database enforcement for authorization and critical business invariants rather than relying only on hidden or disabled UI.

## TypeScript and React

Maintain strong type safety.

- Avoid `any` unless interacting with genuinely untyped boundaries and no reasonable typed alternative exists.
- Avoid chains such as `as unknown as X` to bypass type errors.
- Fix the actual type relationship when practical.
- Reuse existing domain types and helpers.
- Keep components focused.
- Extract reusable logic when there is demonstrated reuse or meaningful complexity; do not create abstractions solely for theoretical future use.
- Avoid unnecessary state duplication.
- Prefer deriving state when possible.
- Be careful with stale asynchronous state and race conditions.
- Preserve accessibility for interactive UI.

Follow the repository's current conventions over personal preference.
