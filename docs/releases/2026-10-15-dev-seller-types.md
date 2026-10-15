# DEV release: seller identity and public catalog fixes

Approved target: Supabase DEV `kdjqitvtxmcrnnpuxuyl`; Firebase `event-queue-app`, site `nireqapp`, preview channel `dev`. Production is outside this release.

Adds creator / cosplayer / shop selection during signup and in the existing shop profile. The selected type controls TH/EN wording on storefronts, discovery, queues and order pages. Existing shops default to creator. Classification neither changes permissions nor certifies licensing. New constrained seller_type columns and signup transfer preserve existing Auth/RLS; public campaign/preorder/receipt payloads append seller identity.

Includes the preceding banner slogan removal, photoset-aware discovery previews with distinct parent products and resolved stored image URLs, and removal of the legacy per-method payment deadline input. Saving settings clears that legacy deadline; the existing 15-minute timed-order hold and live-day behavior remain intact.

Pending migration: `20261015065036_add_seller_types.sql`. Changed functions: `notify-creator-application` and `notify-team-invitation` use neutral shop wording; business and notification authorization remain unchanged.

Validation: npm run verify passed on isolated local API60321: 25 SQL suites / 550 assertions, five inventory concurrency runs, 105 Chromium cases and eight local API smoke checks. Additional responsive public entry tests passed. Signup, email confirmation, seller classification transfer, profile change and persistence are exercised. Reviewed diff and hygiene are clean. This does not certify real DEV email delivery or a real DEV sale.
