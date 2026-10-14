# DEV release: joined language menu

Target: Firebase `event-queue-app`, site `nireqapp`, preview channel `dev`; existing Supabase DEV `kdjqitvtxmcrnnpuxuyl`. No backend or migration changes.

The language control is now a menu attached directly to its trigger, with flags, current-language text, a checked selection, and one continuous border. It supports pointer selection, arrows, Home/End, Escape, Tab, outside dismissal and saved language. The same shared control is used in public and workspace headers. Its width adapts to small screens.

Release validation also exposed an existing POS startup race: products could appear before the pending-order read finished. Products and order reads shared a loading flag, so a fast product click could be ignored or overwritten by the late order response. A separate order-loading flag now keeps add/quantity/charge actions disabled until the latest order read finishes. It does not change prices, stock, authorization, or payment transactions.

`npm run verify` passes: lint/build, 23 SQL suites with 504 assertions, five inventory concurrency rounds, 92 browser tests and eight local API smoke checks. A focused browser regression delays the real order read, checks that product buttons remain disabled, then releases it and verifies the cart and language changes without another promotion quote. Language-menu checks cover keyboard/focus behavior, joined geometry, persistence and 390px/320px viewports. Queue/POS, four-shop isolation and offline flows also pass.

All transaction tests use disposable local `NireqDevLocalization20261013`. Post-deploy public checks do not certify a real DEV sales transaction or real email delivery. Production is outside this target.
