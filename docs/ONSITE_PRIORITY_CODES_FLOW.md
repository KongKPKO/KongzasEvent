# Onsite First-N Access Flow (Static QR + One-Time Codes)

## Goal
Allow creators to reserve queue access for the first `N` people physically at the booth (default `N=20`) while still keeping web-based tracking and queue analytics.

## Chosen Approach
Use **1 static QR per event** plus **one-time onsite access codes**.

- Static QR points to event check-in page.
- System pre-generates `N` random codes for that event (ex: 20 codes).
- Staff gives one code per person onsite.
- Customer can join queue only after code verification.
- When all codes are consumed, queue mode automatically switches to normal open-web flow.

## Why this approach
- Preserves onsite fairness for first `N` visitors.
- Keeps customer journey tracking in one web flow.
- Works with printed QR (no need to show rotating QR screen continuously).
- Lower ops and UX friction than geofencing.

## End-to-End Flow

### Creator / Staff
1. Create event.
2. Configure queue access mode: `onsite_first_n`.
3. Set quota (ex: `20`).
4. Click `Generate onsite codes`.
5. Print static QR poster and code slips (or keep code list in staff panel).
6. Distribute one code per onsite customer.
7. Monitor remaining quota in dashboard.
8. After quota reaches zero, system auto-switches to `open_web`.

### Customer
1. Scan static event QR.
2. Open queue page and input onsite code.
3. If valid and unused, receive queue ticket.
4. Continue normal queue/order flow.

## Security & Abuse Controls
- Code is bound to a single `event_id`.
- Code is single-use only.
- Expire unused codes automatically after event end.
- Rate-limit code validation by IP/device/session.
- Store only hash of code in DB (recommended), not plaintext.

## Data/Tracking
Track source and conversion:
- `checkin_page_view`
- `onsite_code_submitted`
- `onsite_code_verified`
- `queue_joined`
- `order_sent`
- `order_completed`

Recommended fields:
- `event_id`, `artist_id`, `session_id`, `source` (`onsite_code`, `open_web`), timestamps.

## Suggested DB Model (MVP)
- `events.queue_access_mode` (`open_web`, `onsite_first_n`, `closed`)
- `events.onsite_quota_total`
- `events.onsite_quota_used`
- `event_onsite_codes(id, event_id, code_hash, code_preview, status, used_by_queue_id, used_at, expires_at, created_at)`

## Operational Defaults
- Quota default: `20`
- Code format: 4-char alphanumeric (upgrade to 5-6 chars if abuse is detected)
- Auto-switch condition: `onsite_quota_used >= onsite_quota_total`

## Alternatives considered
- Rotating QR token: secure but requires live display device and can be harder for booth operations.
- Geofencing/location check: unreliable indoors, permission friction, spoof risk, higher ops overhead.

## Current Decision
Proceed with **Static QR + pre-generated one-time onsite codes** as primary solution.
