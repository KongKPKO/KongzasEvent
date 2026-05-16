# Stock Adjustment Flow Design

## Goal

Make stock management match how creators operate in real life:

- `Catalog stock` represents all physical stock owned by the creator.
- `Event stock` represents stock allocated from the catalog to one event.
- Users should add or remove stock through explicit actions after setup instead of silently overwriting totals.

The flow must stay compatible with the existing stock model:

- `stock_total`
- `stock_reserved`
- `stock_sold`
- event-level catalog allocations

## Product Decision

Use a hybrid model:

- Creation and first setup may use `Initial stock`.
- Ongoing stock changes use explicit movements:
  - `Add stock`
  - `Remove stock`
  - `Add to event`
  - `Remove from event`
- Direct total edits should not be the normal path after a product exists.

This keeps first-time setup fast while making day-to-day operations easier to understand and safer to audit.

## Inventory Model

### Catalog Stock

Catalog-level values shown to users:

- `On hand`: all stock physically owned by the creator.
- `Allocated`: stock already assigned to events.
- `Available`: stock still free to allocate to future or active events.

Conceptual relationship:

```text
available_catalog_stock = on_hand - allocated_to_events
```

Catalog stock is the source of truth for physical inventory.

### Event Stock

Event-level values shown to users:

- `Allocated to this event`
- `Reserved`
- `Sold`
- `Available at event`

Conceptual relationship:

```text
available_event_stock = allocated_to_event - reserved - sold
```

Event stock is a controlled slice of catalog stock, not an independent source of inventory.

## Core Rules

1. Adding stock to the catalog increases physical inventory.
2. Removing stock from the catalog removes physical inventory from the system.
3. Adding stock to an event consumes catalog `Available` stock.
4. Removing stock from an event returns unsold and unreserved stock to catalog `Available` automatically.
5. Catalog stock cannot be removed below the amount already allocated to events.
6. Event stock cannot be removed below `reserved + sold`.
7. If event stock needs to increase but catalog `Available` is insufficient, the user must add stock to the catalog first.
8. After a product exists, editing the total directly is no longer the normal workflow.

## Real-World Scenarios

### Before an Event Starts

1. Creator adds or corrects catalog stock.
2. Creator configures the event catalog.
3. Creator allocates a quantity from catalog `Available` into the event.

Example:

- Catalog on hand: `50`
- Allocate to event: `20`
- Catalog available after allocation: `30`

### After an Event Starts

1. Creator wants to bring more stock to the booth.
2. If catalog `Available` is sufficient, they use `Add to event`.
3. If catalog `Available` is `0`, they must use `Add stock` on the catalog first.
4. Then they use `Add to event` for the active event.

Example:

- Catalog available: `0`
- Need event restock: `10`
- Add catalog stock: `+20`
- Add to event: `+10`
- Catalog available after both actions: `10`

### Returning Stock From an Event

1. Creator uses `Remove from event`.
2. The system allows removal only from stock that is neither reserved nor sold.
3. Removed stock automatically returns to catalog `Available`.

Example:

- Event allocated: `30`
- Reserved: `5`
- Sold: `12`
- Maximum removable: `13`
- Remove from event: `5`
- Event allocated after removal: `25`
- Catalog available increases by `5`

## Screen Design

### Catalog Workspace

Each product row should show:

- `On hand`
- `Allocated`
- `Available`

Primary stock actions:

- `Add stock`
- `Remove stock`

Secondary product action:

- `Edit product`

The list should make stock state readable without opening a modal.

### Add Stock Modal

Fields:

- `Quantity to add`
- `Reason` (optional in the first version)

Preview:

- `Current on hand`
- `After add`

Buttons:

- `Cancel`
- `Add stock`

### Remove Stock Modal

Fields:

- `Quantity to remove`
- `Reason` (required)

Suggested reason options:

- `Damaged`
- `Lost`
- `Count correction`
- `Other`

Preview:

- `Current on hand`
- `Allocated to events`
- `Maximum removable now`
- `After remove`

Buttons:

- `Cancel`
- `Remove stock`

Validation:

- Removal cannot exceed catalog `Available`.

### Event Catalog Before Event Start

Each event product row should show:

- `Catalog available`
- `Allocated to this event`
- `Reserved`
- `Sold`
- `Available at event`

Actions:

- `Add to event`
- `Remove from event`

When adding to the event, the UI must show how much stock is available from the catalog before submit.

### Event Catalog After Event Start

Use the same stock actions, but with operation-focused wording:

- `Add stock to event`
- `Remove from event`

`Add stock to event` preview:

- `Catalog available`
- `Current event allocation`
- `After add`

`Remove from event` preview:

- `Current event allocation`
- `Reserved`
- `Sold`
- `Maximum removable now`
- `Returned to catalog after remove`

Validation:

- `Add stock to event` cannot exceed catalog `Available`.
- `Remove from event` cannot reduce allocation below `reserved + sold`.

### Edit Product Modal

Creation flow:

- Keep `Initial stock`.

Existing product flow:

- Replace the editable stock input with a stock summary:
  - `On hand`
  - `Allocated`
  - `Available`
- Provide a `Manage stock` action that opens the dedicated stock actions instead of editing totals inline.

Optional later action:

- `Reconcile stock`
  - Hidden from the normal path.
  - Used for explicit count corrections.
  - Requires a reason.

## UI Language

### Catalog

- `On hand`
- `Allocated`
- `Available`
- `Add stock`
- `Remove stock`

### Event

- `Allocated to this event`
- `Reserved`
- `Sold`
- `Available at event`
- `Add to event`
- `Remove from event`

Avoid using the same bare `Remove stock` wording for both catalog and event contexts without clarification.

## Future Audit Trail

Introduce a future `stock_movements` record so the system can explain changes over time.

Suggested fields:

- `product_id`
- `event_product_id` nullable
- `movement_type`
- `quantity`
- `reason`
- `actor_id`
- `created_at`

Suggested movement types:

- `catalog_add`
- `catalog_remove`
- `event_allocate`
- `event_return`
- `sale_reserve`
- `sale_complete`
- `sale_release`
- `reconcile`

The first implementation may focus on correct state transitions first, but the flow should remain compatible with future movement history.

## Out Of Scope For The First Pass

- Full inventory reporting dashboard
- Bulk stock adjustments
- CSV import/export for movement history
- Warehouse/location tracking
- Automatic supplier purchase workflows

## Success Criteria

The design is successful when:

1. A creator can add stock to the catalog without editing totals directly.
2. A creator can allocate stock from catalog to an event before or during the event.
3. The system blocks event allocation when catalog stock is insufficient.
4. Removing stock from an event returns it to catalog availability automatically.
5. Removing stock from the catalog never silently deletes stock that is already allocated to events.
6. The UI makes it obvious where stock lives and why it is or is not available.
