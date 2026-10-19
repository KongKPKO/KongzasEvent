# Offline operations — paused, recovery only

New offline preparation and recording are not available in the product for now. The live workspace has no offline entry point. `/offline` remains available only as a recovery route for a browser that already holds pending records, so a previously captured receipt is not hidden or discarded.

## Recovery behavior kept active

- Existing IndexedDB receipts and queue operations remain intact. The recovery page can export them, submit them with their original operation IDs, and show conflicts that still need review.
- The recovery page cannot prepare or replace a primary device and has no controls for recording a sale or queue transition.
- A previously prepared normal POS can still preserve an ambiguous payment attempt before sending payment RPCs. This is a money-safety recovery path for an existing prepared browser, not a way to start offline selling.
- Synchronization rechecks current event permissions and primary device ownership, uses the original operation ID, and retains a server audit row. A failed subtransaction rolls back stock/order changes while retaining the receipt as a conflict. Revoked access leaves unsent records locally, with an export option.
- Management can load conflicts and reconcile them against an existing completed sale with matching amount, payment method, currency and purchased items. Linking does not deduct stock again. Queue reconciliation requires the central queue to have the recorded status. No compensation or refund is inferred automatically.
- Previously prepared online workspaces retain recovery heartbeats so pausing new offline setup does not accidentally pause normal queue expiry.
- A registered device can be released after its outstanding records are cleared. The route remains in the cached shell so existing local records can still be opened during recovery.

## Data survival limits

Browser storage is not a backup. Persistent storage is requested; refusal is displayed. Export pending records before clearing browser data, uninstalling, or changing devices. A destroyed device with no exported/synchronized copy cannot be recovered. Exports contain operational business records and must be kept privately. Automated import of those exports is not implemented.

## Evidence so far

- PostgreSQL checks: primary exclusion, heartbeat outage/grace, replay of a sale without duplicate stock, rollback on price conflict, expiry pause, unauthorized submissions, and matching-sale reconciliation.
- Browser: no preparation or offline-recording controls are exposed; a pre-existing receipt survives reload and a lost synchronization response, and the same-ID retry deducts stock once. The online staff race and normal-POS response-lost recovery remain covered.
- Chromium production build with a real service worker: full browser network disconnection and reload passed. This is distinct from the development test, which disconnects the backend while keeping Vite reachable.
- iPad WebKit emulation passed the full receipt/reload/sync/unknown-queue, stale queue update and normal-POS payment-recovery path. Physical device backgrounding, storage eviction, installation/update and revoked-session scenarios remain acceptance work.

## Before offline operations can be offered again

Offline preparation and new disconnected operations require a separate product decision and release gate. Physical device acceptance, revoked-role and replacement-device checks, promotion/gift parity, and import handling for exported pending records remain incomplete. Do not describe the current product as offline-ready.
