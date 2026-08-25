# Realtime Publication and Function Search Path Hardening

## Goal

Prepare the release candidate locally by publishing every table used by Postgres Changes subscriptions and removing all current mutable function `search_path` security-advisor warnings. Production and other remote environments remain unchanged.

## Scope

- Keep the existing append-only Realtime publication migration and its pgTAP test.
- Add one append-only migration for the six functions currently reported by the local security advisor.
- Add a focused pgTAP test for the pinned function configuration and preserved currency validation behavior.
- Do not modify or stage `src/tests/regression/preorder-pickup.spec.ts` or unrelated untracked files.

## Database Design

The Realtime migration conditionally adds `event_products`, `artist_promotions`, `orders`, and `order_payments` to the existing `supabase_realtime` publication. The condition makes the migration safe when a table is already published. Existing RLS settings and policies are not changed.

The security migration pins `search_path = ''` for these functions:

- `public.update_last_updated_at_column()`
- `public.update_last_updated_column()`
- `public.update_updated_at_column()`
- `public.check_active_currency_consistency()`
- `public.set_updated_at_timestamp()`
- `public.normalize_artist_role(text)`

Five functions need only an `ALTER FUNCTION ... SET search_path = ''` because their bodies use trigger records, literals, or built-in functions. `check_active_currency_consistency()` will be replaced with its current behavior preserved, except that `products` becomes the fully qualified `public.products`; it will also set an empty search path.

## Verification

- The Realtime test confirms all eight subscribed tables are in `supabase_realtime` and still have RLS enabled.
- The security test confirms all six exact signatures have `search_path` pinned to an empty string and verifies the currency-consistency trigger still rejects mixed active currencies.
- Run the focused pgTAP tests, the complete local DB suite, the local security advisor, the security regression suite, and `npm run verify`.

## Release Boundary

Only the approved migration, test, and supporting design/plan files will be committed. Remote migration history, remote advisors, and deployment will be performed later from an allowlisted network after separate approval.
