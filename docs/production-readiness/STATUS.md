# v1 acceptance evidence

Local worktree: a7c2, 13 September 2026. Canonical scope: [spec](NireQ-Production-Readiness-Spec-v1.md). No production readiness claim; no commit, push or deployment performed.

## Initial gaps

| Gate | Evidence / gap | Status |
| --- | --- | --- |
| Functional | Existing Queue/POS/Campaign/preorder flows; full role/channel journeys not yet run | Open |
| Security | Manager team management currently owner-only; fulfillment PII permissions need tracing | Open |
| Integrity | Catalog stock RPC changes quantities without audit rows or retry IDs | Open |
| Offline | Existing test checks cached content; no durable sale outbox, primary-device enforcement or reconciliation found | Open, release blocker |
| Privacy | Replay previously initialized before consent; retention/dispute workflow not implemented | Open |
| Reliability | Upload/email/restart recovery not yet exercised across channels | Open |
| Capacity | No load result collected in this worktree | Not run |
| Backup | No database + Storage restore drill performed | Not run |
| Deployment | Local Supabase available; remote migration history and deployment not inspected or changed | Not run |
| UX/PWA | References inspected; physical-device install/update/offline gates not run | Open |

## Completed checks

- Initial consent change: `npm run verify` passed: lint, build, public i18n smoke (6), local API smoke. Local backend `127.0.0.1:54321`; no remote data.
- `replay-consent.spec.ts`, desktop Chromium: passed. Exercises initial rejection, persistence, subsequent acceptance, sanitizers, withdrawal reload. Uses an intercepted SDK module to inspect configuration; does **not** prove actual vendor ingestion or replay rendering.
- Consent implementation drops request/response records and console/error auto-capture, avoids account identification, masks text/inputs/images and strips page URLs. Official reference: https://docs.logrocket.com/reference/dom and installed SDK types. Installed SDK has no documented stop API; withdrawal explicitly reloads the document. New offline work must preserve pending records through this reload.
- Legal contact updated to `konglnwzas@gmail.com`; bilingual legal text being integrated. Retention promises intentionally await actual implementation and financial-evidence policy.

## References

`reference-images/exec-f35f4249-e229-4132-8af0-3db5d5264d26.png`: storefront. `exec-beddc455-7db0-4995-993e-a9c2f0a307f5.png`: POS. `exec-0d9220bb-e9cf-4598-87bf-6b3c7967ea73.png`: mobile. `exec-7990f3fa-214f-4caa-876e-ce83068e5914.png`: queue. `exec-af5b6a19-2a5d-4205-97ce-577d5b5afea4.png`: direction comparison, chosen B.

These are visual references only; product artwork must come from the authorized CQ9_Creamyferin originals, never from these generated images. Favorites, verification badges and depicted queue transitions do not create requirements.

## Implemented batches (still not full v1)

- Team: managers can invite/cancel invitations/remove seller and queue staff; owner-only role changes and event-access edits remain unchanged. Acceptance locks invitations and refuses revoked issuers and changed memberships. SQL team suite: 37 passed; real local browser manager invite/remove passed (email send intercepted, delivery not certified).
- Stock: receive/increase correction/decrease correction, reason on corrections, atomic audit, persistent client request IDs, server payload conflict check. Browser lost response/reload/retry increments once; metadata edits no longer overwrite a stock receipt made while the form was open. SQL stock + lifecycle: 39 passed. Legacy RPC/direct stock edits are audited as `catalog_edit`, but legacy clients do not acquire retry IDs; do not count legacy-client retries or event allocation retries as covered.
- Shipping responsibility: default false for sellers, assigned only by owner through existing membership authorization. Reset on role/status change. Campaign and preorder review RPCs mask customer contact/address for unassigned sellers; shipment mutations require assignment. Direct order contact-column grants removed; history, analytics and pickup use operational identifiers instead. Campaign authorization regression with assignment/self-escalation/direct-read checks: 3 passed.
- Combined local SQL suites: team, stock, preorder pickup, campaign: 167 passed. Existing security browser suite: 15 passed before shipping changes; shipping rerun had 14 passing plus one fixture-email typo, fixed and affected Campaign group rerun: 3 passed. No skipped test counted as passed.

## Financial evidence decision — approved in voice discussion, 13 September 2026

User approved the recommended 12 months after order completion for payment images, hold deletion for open disputes, let creators export their own evidence; general customer PII remains the agreed six months. No automatic slip deletion implemented or enabled.

Illustration only: 10,000 slips/month × 0.5 MB × 12 months ≈ 60 GB. Supabase Pro currently includes 100 GB file storage, then $0.0213/GB/month; plan, downloads/egress and backups are separate. Actual project usage/plan not inspected. https://supabase.com/pricing

The cited Revenue Department guidance concerns VAT registrants and qualifying records (minimum five years); it does not establish that NireQ must keep all merchant slip images for five years or that the proposed 12 months is legally sufficient. https://www.rd.go.th/28312.html

## Image delivery decision — 13 September 2026

User approved removing ImageKit from every runtime image path and using Supabase directly. Removed proxy generation and preconnect, consolidated Menu image resolution, and resolve historical Menu/Avatar proxy URLs to their Supabase origin without rewriting stored records. Added the missing avatar normalization in the customer menu. Targeted browser checks: 3 passed (legacy URL mapping, Campaign image path, broken image fallback). Existing documents and seed values may still mention ImageKit as historical data; no runtime request is needed for those supported legacy URLs.

The spec now requires WebP for all user-uploaded image types. Universal upload conversion/receiving-side validation is still outstanding; this image-delivery change does not claim it is implemented. No production data accessed, account subscription canceled, or deployment performed.

Image-delivery final verification: `npm run verify` passed (lint, build, public browser smoke 6, local API smoke); `git diff --check` passed and affected diff reviewed.

## Upload receiving boundary and problem reports

All current upload callers now convert to WebP and use `upload-image`, which validates dimensions, file structure and a complete decode before privileged Storage writes. Direct client uploads are blocked for Menu, Avatar and PaymentEvidence. Safari's missing native WebP encoder uses the bundled encoder; QR uses lossless encoding. Targeted Chromium and iPad WebKit checks passed; actual bank-slip readability and physical QR scans remain acceptance gates.

Customer order-problem submission, persistent retry, private management view, external-report recording and resolution are implemented. Email delivery has a durable queue and provider idempotency key; local Mailpit delivery was tested, not production delivery. The notification worker needs its documented environment configuration before scheduled retries work remotely.

## Retention implementation in progress

Local schema and worker implement six-month customer-data cleanup and twelve-month financial-image cleanup, with open-problem/payment-review holds. File deletion uses retryable leases and blocks new problem submissions while a file is being deleted. Thirteen local SQL checks passed for age boundaries, reports created after initial cleanup, permissions and exclusive file claims. This does not yet prove real Storage deletion/retry or a backup restore.

`npm run verify` passed after adding reports/retention (lint, build, six public browser checks and API smoke). Remote maintenance is inactive until explicitly configured and approved. Public orphan-image cleanup, financial holds beyond recorded open problems, and the full retention data inventory still need completion. Earlier statements that universal conversion was outstanding are superseded by this batch; no production readiness claim is made.

Latest continuation: the thirteen retention SQL checks pass. The complete security run passed its first twelve checks, then stopped because its old synthetic slip had no validated-upload record; updated that role-boundary fixture and the three affected Campaign checks passed. No upload validation was weakened. iPad Pro WebKit: universal conversion (now including problem images), native-encoder fallback and manager team workflow all passed (three tests).

Creators can download the stored evidence from both Campaign and preorder preview dialogs. The Campaign browser flow verifies an actual successful WebP download. The final `npm run verify` passed after this change. These checks do not replace real-device acceptance, production email verification, or completion of the remaining v1 gates.

## Offline sales and queue — local implementation

Prepared primary-device workspace now saves receipts and queue actions in IndexedDB before acknowledging them, survives reload, and synchronizes using stable operation IDs. It preserves conflicts for management review, supports central queue numbers missing from the prepared snapshot, pauses queue expiry during detected outages/recovery, and prevents stale online queue updates from overwriting another staff action. Owner replacement and release are enforced on the server. See [offline operations](OFFLINE.md) for boundaries and recovery guidance.

The normal POS preserves prepared payment attempts before sending them. Plain-object network failures now produce an unknown-result warning instead of clearing the retry ID. Browser regression proves a committed payment with a lost response is recovered once, then an identical new sale remains a distinct transaction.

Latest local evidence: 19 offline PostgreSQL checks passed; the full offline/payment-recovery flow passed in iPad WebKit emulation; the complete desktop flow passed both in development and in the production build with full browser network disconnection, service-worker reload and synchronization. `npm run verify` passed (lint, build, six public browser checks and API smoke); diff whitespace check passed. No remote migration, commit, push or deploy performed. Physical-device acceptance and the remaining checks documented in OFFLINE.md still prevent an offline-ready claim. Visual redesign remains deferred.

## Creator Festival UI — live sales and queue batch

Live sales and queue now use separate full-width views on desktop/tablet as well as mobile; switching views keeps the mounted sale state. The product browser sits left and the sale summary right. Mobile keeps a bottom cart summary and review sheet. Queue callers see larger ticket/action controls, and serving tickets remain visible to queue staff while only POS-authorized roles get an Open sale action. No new queue transition, pricing, or payment rule was introduced.

The shared workspace header now uses NireQ branding, a tablet menu that scrolls within the viewport, and localized navigation. Live labels, payment review, empty states and queue guidance gained explicit Thai/English text. Legacy localization previously restored a node's first label over subsequent React state; fixed preservation so Open/Close Booth and loading/ready labels stay current. The existing offline regression now checks these labels.

Verification after the final code: `npm run verify` passed; full offline/normal-payment-recovery regression passed in desktop Chromium and iPad Pro WebKit (2). Manual Playwright CLI checks used local-only demo data and authorized original artwork: English desktop/mobile and Thai tablet/mobile; customer arrival opens the selected sale; mobile quantity target at least 44×44; Tab/Shift+Tab remain inside the cart; no mobile horizontal document overflow. Local screenshots are under `output/playwright/festival-*`. Diff reviewed and whitespace check passed. No deployment.

This batch covers the live workspace and shared header. It does not claim the full reference rollout, complete application/email localization, WCAG certification, or physical-device acceptance. Customer storefront/checkout, wider management screens and remaining language audit are still open in the v1 UI gate.

## Creator Festival UI — item 1: creator storefront (2026-09-14)

Creator Home, event Merchandise and public Campaign browsing now share the creator identity and light pink storefront treatment. Home event/creator lists adapt to wider screens. Merchandise shows full artwork, variant groups, current available stock and a desktop cart/mobile summary; native product details support keyboard focus, Escape and changing variants against current product data. Product cards no longer nest quantity buttons inside another button. Adding to a cart does not visually reserve stock. Campaign browsing adds search/category filtering without clearing selected quantities, readable descriptions and image failure placeholders. Failed catalog/campaign loads offer retry. Existing checkout, queue eligibility, prices and allocation rules remain in place.

Verification: storefront regression passed in desktop Chromium, iPhone WebKit and iPad Mini WebKit (3), covering variants, sold-out/quantity limits, keyboard details, filter/reload cart persistence, Thai/English and catalog failure/retry. Targeted campaign regression passed (7): filtering/cart preservation, closed storefront, valid/broken image paths, per-order limits, shipping and pickup checkout. Final `npm run verify` passed (lint, build, six public browser checks and local API smoke). Diff reviewed and whitespace check passed. Manual in-app browser inspection used local demo artwork on desktop and a 390×844 viewport, including Thai product selection and expanded cart; viewport restored afterward.

This completes item 1's storefront UI batch, not all v1 UI. Checkout/payment redesign remains item 2; physical-device and full accessibility acceptance remain separate checks. No production deployment or remote data changes.

### Customer visual refinement

The user's reference is now an explicit product principle: prioritize visual appeal on customer pages and operational UX on staff pages. Storefront styling now uses brighter pink actions, navy typography, a compact striped paper banner with decorative tape, round creator portraits, lavender navigation and denser artwork cards with price/add controls together. Real images still supply the banner; decorative elements do not imply a new feature or product status. No staff workflow or commerce rule changed. Storefront regression passed on desktop Chromium and iPhone WebKit (2); mobile browser inspection covered the actual demo artwork at 390×844. Viewport restored after inspection.

## Creator Festival UI — item 2: checkout (2026-09-14)

Campaign checkout now uses a native modal with delivery/pickup selection, labeled customer fields, product thumbnails and a separate receipt showing discounts, shipping and total. Desktop uses two columns; mobile uses a full-height single column. Editing cart items or switching fulfillment preserves entered details while mounted. Pickup details show the address, dates and instructions. Failed price checks offer retry and block confirmation until a valid quote returns. The event/preorder confirmation uses the same visual components and shows customer/queue details before the existing submission flow. Existing money, stock and queue rules remain unchanged.

Verification: 10 targeted checkout/preorder/live-eligibility cases passed across desktop Chromium and iPhone WebKit emulation. A final 4-case run covered form preservation, native required-field validation, keyboard focus/Escape and price-failure retry on both projects. Final `npm run verify` passed (lint, build, six public browser checks and local API smoke). Manual in-app browser inspection covered the local demo checkout at desktop and 390×844, including scrolling through the receipt and confirmation action; viewport restored afterward. Diff reviewed and whitespace check passed.

Local preview: `/festival-8004a402/campaign/checkout-preview`, using separate local demo products and pickup details. This batch covers checkout/review; payment evidence and order-tracking visual redesign remain separate work. No production deployment or remote database changes; physical-device acceptance remains unverified.

## Creator Festival UI — payment and order tracking (2026-09-14)

Campaign and event/preorder order pages now share the platform header, prominent order total/status and a responsive receipt layout. Payment methods and slip submission sit beside item/delivery details on desktop and stack on mobile. Campaigns show account-holder names, a selected-slip preview, full pickup dates/instructions, explicit shipped/picked-up/rejected/cancelled headings, and a refresh action. Campaign lookup failures offer retry instead of appearing as missing orders. Clipboard failures give manual-copy guidance. The image picker text now matches the existing image-only upload service; no PDF support is implied.

Verification: fourteen targeted cases passed across desktop Chromium and iPhone WebKit, including online checkout, pickup, expired recovery, evidence upload/merchant preview, tracking clipboard and event preorders. The final affected rerun covered lookup failure/retry and shipment headings on both browsers. Manual in-app inspection covered desktop and Thai 390×844 payment/receipt layout with a local-only demo order; viewport restored. No payment transition, stock allocation, migration or remote deployment was changed. Real-device QR scanning remains outside this UI verification.

Final `npm run verify` passed after the fulfillment-status correction (lint, build, six public browser checks and local API smoke); diff review and whitespace check passed. Preview server remains local at port 5174 because the verification server temporarily occupied 5173.

## Creator Festival UI — customer queue (2026-09-14)

The customer queue now centers the customer's numbered ticket, with distinct status guidance, a perforated receipt treatment, a separate current-service panel and a direct link to merchandise. Desktop uses two columns and mobile stacks the ticket first. Continuous ticket/carousel animation was removed. ETA is shown only while waiting and is hidden when updates are delayed or disconnected. Existing receive/leave/rejoin rules and queue ordering remain unchanged. A failed ticket lookup no longer clears the locally stored ticket; refresh always releases its loading state.

Local verification: customer receive/browse/return/service/completion flow passed on desktop Chromium and iPhone WebKit; queue availability checks passed on both projects. `npm run verify` passed (lint, build, six public browser checks and API smoke). Manual in-app inspection covered receiving a demo ticket and Thai desktop/390×844 layout; viewport restored. Diff reviewed and whitespace check passed. Preview: port 5174, `/festival-8004a402/queue`. No production deployment or remote changes.

## Creator Festival UI — order management and evidence review (2026-09-14)

Campaign orders now have quick filters with counts for payment review, shipping and pickup, readable translated status labels and clearer order rows. Campaign and preorder/post-order evidence previews share a native dialog with an enlarged slip pane, zoom/fit control, expected amount, purchased-item list, download and review actions. Campaign confirm/reject now opens an explicit confirmation; its existing rejection-note prompt and server actions are retained. In-flight order actions are guarded against duplicate requests.

Campaign regression passed on desktop Chromium and iPhone WebKit through evidence upload, merchant preview, zoom/fit, download and confirmed payment persisted in local Supabase. Desktop screenshot composition was inspected with synthetic evidence; this does not test real slip legibility. The shared preorder preview compiles but its separate full confirm/reject journey was not rerun in this batch. Historical sales reporting and the remaining management localization are separate work. No RLS, stock rules, migration or production deployment changed.

Final `npm run verify` passed after preserving readable fulfillment labels alongside payment status; diff review and whitespace check passed.
