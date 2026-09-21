# Offline operations — local implementation

Entry: open the live workspace, choose the event, then **Prepare offline operations**. Preparation requires an online Owner/Manager/Seller session. Queue staff cannot prepare or submit offline changes. A previously prepared workspace can reopen at `/offline` without waiting for network authentication; this grants no new server access.

## Implemented behavior

- One registered primary device per event. The local workspace holds one browser lock, preventing simultaneous entry from two tabs. Preparation is valid for local recording for 24 hours. Log out disables local recording and leaves pending records intact.
- IndexedDB commits the complete receipt or queue operation before acknowledging it. Sequence numbers are allocated transactionally. Cash/transfer receipt, items, displayed unit prices, currency, queue/day and capture time are preserved. The prepared normal POS also records its attempt before sending payment RPCs.
- The disconnected workspace records the amount staff actually collected. It does **not** run the full automatic promotion/gift-choice engine offline. Staff must verify the amount; server price/promotion/stock differences become conflicts rather than invented successful payments. Normal POS attempts retain their already chosen promotion inputs.
- Synchronization rechecks current event permissions and primary device ownership, uses the original operation ID, and retains a server audit row. A failed subtransaction rolls back stock/order changes while retaining the receipt as a conflict. Revoked access leaves unsent records locally, with an export option.
- Management can load conflicts and reconcile them against an existing completed sale with matching amount, payment method, currency and purchased items. Linking does not deduct stock again. Queue reconciliation requires the central queue to have the recorded status. No compensation or refund is inferred automatically.
- Missing queues are recorded using the customer's central queue number and the prepared event day, never a new locally issued number. Invalid/stale transitions become conflicts. Normal queue changes also compare the observed status/time before writing.
- Heartbeat every 20 seconds; an absent heartbeat for 90 seconds pauses queue expiry. Open conflicts or locally pending records keep recovery active. Reconnection or device replacement gives at least five minutes of grace. Online order payment holds remain unchanged.
- The owner can explicitly replace a primary device. They must stop the old workstation first; offline revocation cannot be instantaneous. Late operations from the replaced device are quarantined. Normal release requires no outstanding records. A five-minute grace remains after release.
- Public queue pages warn when central updates are delayed. A prepared-workspace link is available from the app, including its cached home page.

## Data survival limits

Browser storage is not a backup. Persistent storage is requested; refusal is displayed. Export pending records before clearing browser data, uninstalling, or changing devices. A destroyed device with no exported/synchronized copy cannot be recovered. Exports contain operational business records and must be kept privately. Automated import of those exports is not implemented.

## Evidence so far

- PostgreSQL checks: primary exclusion, heartbeat outage/grace, replay of a sale without duplicate stock, rollback on price conflict, expiry pause, unauthorized submissions, and matching-sale reconciliation.
- Browser: backend disconnection, receipt commit, reload, lost synchronization response, same-ID retry with one stock deduction, central queue received after preparation, an online staff race without overwrite, and a normal-POS response lost after payment committed. Recovery uses the same payment ID; a subsequent identical sale gets a fresh ID and deducts stock once more.
- Chromium production build with a real service worker: full browser network disconnection and reload passed. This is distinct from the development test, which disconnects the backend while keeping Vite reachable.
- iPad WebKit emulation passed the full receipt/reload/sync/unknown-queue, stale queue update and normal-POS payment-recovery path. Physical device backgrounding, storage eviction, installation/update and revoked-session scenarios remain acceptance work.

## Remaining before calling the offline gate complete

Physical device acceptance; explicit revoked-role and replacement-device end-to-end checks; complete offline promotion/gift UX if parity with the online POS is required; import/recovery handling for exported pending records. This implementation is local only and has not been deployed. The visual redesign remains deferred as requested.
