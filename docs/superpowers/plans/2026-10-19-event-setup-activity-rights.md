# Event setup and activity participation rewards

Approved outcomes:
- New events can start empty, reuse an owned event product list, or select multiple catalog items with search/category filtering. Reuse never copies inventory commitments. Existing allocations remain untouched; tracked additions start at zero. Support bulk allocation with an explicit preview and capacity checks.
- A spend-condition promotion may grant a named activity reward with quantity and manual instructions. Count floor(qualifying merchandise net of discounts / threshold) per order; no cross-order carry, shipping or free-gift eligibility. No customer names, product creation, physical stock or automated drawing.
- Persist immutable reward name/instructions/count in existing order pricing snapshots; preview until confirmed payment, display a durable staff notice after successful payment, and show snapshot in merchant history and customer status. Cancelled/refunded orders have no active rights; external manual fulfillment remains the merchant responsibility.

Execution:
- [x] Implement event membership setup/bulk selection and safe allocation using existing authorization and inventory rules.
- [x] Extend V1 validated config and authoritative server quote without changing existing discount/gift behavior.
- [x] Connect editor, preview, POS success, history, and customer order displays.
- [x] Add focused transactional and browser regressions, run npm run verify and review final diff.

Validation target: disposable local Supabase NireqDevLocalization20261013 (API 60321, DB 60322), never remote scratch data. Preserve original local stacks and restore them after testing. Remote migrations/deployment require explicit target approval; this implementation does not authorize Production.

Validation completed: clean disposable-local migration replay; npm run verify passed 976 SQL assertions, stock/gift races, 140 browser cases and 8 API smoke checks. The user subsequently authorized DEV migration/deployment for both features together with promotion picker prices and preview feedback. Production remains outside this release scope.

Promotion follow-up: show catalog prices in product pickers, keep preview validation/API errors beside its action, show calculation progress and accessible results, and test successful calculation plus failure/retry. DEV release requires a fresh full verification, commit/push, both migrations, staging Hosting deployment and public smoke checks.
