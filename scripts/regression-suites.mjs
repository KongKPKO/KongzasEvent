// Usage bands are provisional product assumptions, not measured traffic percentages.
// Scope comes first; the supplied Impact × Usage matrix chooses the affected tier.
export const FULL_BROWSER_SPECS = [
  "src/tests/team-invitation-email.spec.ts",
  "src/tests/setup-readiness.spec.ts",
  "src/tests/production-readiness.spec.ts",
  "src/tests/release-cache.spec.ts",
  "src/tests/public-i18n-smoke.spec.ts",
  "src/tests/queue-availability.spec.ts",
  "src/tests/customer-queue-ui.spec.ts",
  "src/tests/online-shop-discovery.spec.ts",
  "src/tests/storefront.spec.ts",
  "src/tests/seller-type-customer.spec.ts",
  "src/tests/event-card-order-link.spec.ts",
  "src/tests/profile-member-save.spec.ts",
  "src/tests/multi-payment-display.spec.ts",
  "src/tests/event-multi-payment.spec.ts",
  "src/tests/campaign-multi-payment.spec.ts",
  "src/tests/catalog-stock-retry.spec.ts",
  "src/tests/production-inventory.spec.ts",
  "src/tests/image-upload.spec.ts",
  "src/tests/image-storage.spec.ts",
  "src/tests/offline-operations.spec.ts",
  "src/tests/promotion-save.spec.ts",
  "src/tests/promotion-mixed-rewards.spec.ts",
  "src/tests/promotion-workspace.spec.ts",
  "src/tests/customer-live-promotions.spec.ts",
  "src/tests/promotion-flexible-benefits.spec.ts",
  "src/tests/activity-rewards-display.spec.ts",
  "src/tests/activity-reward-pos.spec.ts",
  "src/tests/event-catalog-setup.spec.ts",
  "src/tests/catalog-sales-channels.spec.ts",
  "src/tests/security-rls-regression.spec.ts",
  "src/tests/e2e/full-service-loop.spec.ts",
  "src/tests/e2e/pilot-auth.spec.ts",
  "src/tests/e2e/pilot-preorder.spec.ts",
  "src/tests/auth-user-errors.spec.ts",
  "src/tests/platform-admin-mfa.spec.ts",
  "src/tests/phase2-workspace-identity.spec.ts",
  "src/tests/mobile-staff-account.spec.ts",
  "src/tests/platform-admin-console.spec.ts",
  "src/tests/account-management-suspension.spec.ts",
  "src/tests/feedback-support.spec.ts",
  "src/tests/team-permissions.spec.ts",
  "src/tests/notify-creator-application.spec.ts",
  "src/tests/admin-support.spec.ts",
  "src/tests/store-suspension.spec.ts",
  "src/tests/localization.spec.ts",
  "src/tests/language-menu.spec.ts",
  "src/tests/e2e/pilot-login-recovery.spec.ts",
  "src/tests/e2e/pilot-multi-shop.spec.ts",
  "src/tests/e2e/language-selection.spec.ts",
  "src/tests/regression/online-campaign.spec.ts",
  "src/tests/product-sales-report.spec.ts",
  "src/tests/product-sales-report-flow.spec.ts",
  "src/tests/pos-sales-history.spec.ts",
  "src/tests/pos-queue-drawer.spec.ts",
  "src/tests/bundle-pos-last-stock.spec.ts",
  "src/tests/auto-bundle-editor.spec.ts",
  "src/tests/product-presentation.spec.ts",
  "src/tests/product-families-flow.spec.ts",
  "src/tests/product-types-flow.spec.ts",
  "src/tests/product-csv-import.spec.ts",
  "src/tests/product-csv-import-flow.spec.ts",
  "src/tests/event-appearances.spec.ts"
];

export const ISOLATED_BROWSER_SPECS = [
  'src/tests/e2e/pilot-login-recovery.spec.ts',
  'src/tests/e2e/pilot-multi-shop.spec.ts',
  'src/tests/e2e/language-selection.spec.ts',
];

const browser = (...names) => names.map(name => `src/tests/${name}.spec.ts`);
const sql = (...names) => names.map(name => `supabase/tests/${name}_test.sql`);

export const DOMAINS = {
  public: {
    impact: 'P2', usage: 'high', rationale: 'Discovery and public shop entry are common customer paths.',
    smoke: ['src/tests/public-i18n-smoke.spec.ts › Public Nireq smoke › home supports discovery locators and language switching'],
    lightweight: browser('production-readiness', 'public-i18n-smoke', 'online-shop-discovery'),
    full: browser('production-readiness', 'public-i18n-smoke', 'online-shop-discovery', 'seller-type-customer', 'event-card-order-link', 'release-cache'),
    sql: sql('publication_security', 'public_online_campaign_discovery', 'seller_types'),
  },
  auth: {
    impact: 'P1', usage: 'high', rationale: 'Seller sign-in is frequent; registration and recovery must still work.',
    smoke: browser('auth-user-errors'),
    lightweight: browser('e2e/pilot-auth', 'auth-user-errors'),
    full: browser('e2e/pilot-auth', 'auth-user-errors', 'e2e/pilot-login-recovery'),
    sql: sql('creator_signup_idempotency'),
  },
  queue: {
    impact: 'P1', usage: 'high', rationale: 'Queue state also spans event expiry and receipt restoration; keep those regressions in affected checks.',
    smoke: ['src/tests/e2e/full-service-loop.spec.ts › full queue and POS service loop › customer joins, staff calls and serves, then records payment'],
    lightweight: browser('e2e/full-service-loop', 'customer-queue-ui', 'queue-availability'),
    full: browser('e2e/full-service-loop', 'customer-queue-ui', 'queue-availability', 'pos-queue-drawer'),
    sql: sql('pos_queue_operations', 'realtime_publication'),
  },
  sales: {
    impact: 'P1', usage: 'very-high', rationale: 'Checkout, payment and pickup are the central transaction paths.',
    smoke: [
      'src/tests/regression/online-campaign.spec.ts › online campaign › customer checks out with flat shipping and gets a 15-minute hold',
      ...browser('e2e/pilot-preorder'),
    ],
    lightweight: browser('regression/online-campaign', 'e2e/pilot-preorder', 'multi-payment-display'),
    full: browser('regression/online-campaign', 'e2e/pilot-preorder', 'multi-payment-display', 'event-multi-payment', 'campaign-multi-payment', 'security-rls-regression'),
    sql: sql('online_campaign', 'preorder_pickup_mvp', 'payment_method_bank_accounts', 'order_retention'),
    api: true,
  },
  catalog: {
    impact: 'P1', usage: 'high', rationale: 'Catalog and allocation edits can oversell or corrupt shared stock.',
    smoke: browser('storefront'),
    lightweight: browser('storefront', 'production-inventory', 'catalog-sales-channels', 'event-catalog-setup'),
    full: browser('storefront', 'production-inventory', 'catalog-sales-channels', 'event-catalog-setup', 'catalog-stock-retry', 'bundle-pos-last-stock', 'auto-bundle-editor', 'product-families-flow', 'product-types-flow', 'product-csv-import', 'product-csv-import-flow'),
    sql: sql('stock_summary_lifecycle', 'stock_adjustment_flows', 'production_inventory', 'component_bundles', 'auto_bundle_matching', 'product_families', 'product_sales_channels', 'product_csv_import', 'event_catalog_initialization'),
  },
  products: {
    impact: 'P2', usage: 'low', rationale: 'Product authoring and imports are less frequent and need their direct end-to-end regressions.',
    smoke: [],
    lightweight: browser('product-families-flow', 'product-types-flow'),
    full: browser('product-families-flow', 'product-types-flow', 'product-csv-import', 'product-csv-import-flow', 'auto-bundle-editor', 'bundle-pos-last-stock'),
    sql: sql('product_families', 'product_csv_import', 'component_bundles', 'auto_bundle_matching'),
  },
  promotions: {
    impact: 'P1', usage: 'high', rationale: 'Pricing, gifts and rewards affect money and cross-channel stock.',
    smoke: ['src/tests/customer-live-promotions.spec.ts › live cart uses server pricing, invalidates stale quotes, and reviews a changed quote before creating an order'],
    lightweight: browser('customer-live-promotions', 'promotion-save', 'promotion-workspace', 'activity-reward-pos'),
    full: browser('customer-live-promotions', 'promotion-save', 'promotion-workspace', 'activity-reward-pos', 'promotion-mixed-rewards', 'promotion-flexible-benefits', 'activity-rewards-display'),
    sql: sql('promotion_sales_channel', 'promotion_atomic_save', 'promotion_mixed_rewards', 'promotion_rpc_authorization', 'promotion_condition_reward_v1', 'promotion_flexible_benefits_preview', 'promotion_activity_rights', 'event_promotion_selection'),
    promotionRace: true,
  },
  workspace: {
    impact: 'P1', usage: 'low', rationale: 'Less frequent membership and suspension changes have account-wide consequences.',
    smoke: [],
    lightweight: browser('team-permissions', 'phase2-workspace-identity', 'mobile-staff-account'),
    full: browser('team-invitation-email', 'security-rls-regression', 'team-permissions', 'phase2-workspace-identity', 'mobile-staff-account', 'account-management-suspension', 'store-suspension', 'e2e/pilot-multi-shop', 'profile-member-save', 'setup-readiness'),
    sql: sql('team_invitations', 'team_permission_boundaries', 'phase2_multi_workspace_identity', 'account_management_suspension', 'store_suspension', 'shop_profile_update'),
    teamRace: true,
  },
  platform: {
    impact: 'P1', usage: 'low', rationale: 'Platform administration and MFA are rare but privileged operations.',
    smoke: [],
    lightweight: browser('platform-admin-mfa', 'platform-admin-console'),
    full: browser('platform-admin-mfa', 'platform-admin-console', 'admin-support'),
    sql: sql('platform_admin_bootstrap', 'platform_admin_mfa', 'platform_admin_console', 'admin_support', 'rpc_execute_privileges', 'function_search_path_security'),
  },
  support: {
    impact: 'P2', usage: 'low', rationale: 'Feedback and notification failures need the complete domain regression.',
    smoke: [],
    lightweight: browser('feedback-support', 'notify-creator-application'),
    full: browser('feedback-support', 'notify-creator-application'),
    sql: sql('feedback_security', 'notification_delivery_security'),
  },
  recovery: {
    impact: 'P1', usage: 'low', rationale: 'Legacy offline recovery is infrequent but protects existing receipts.',
    smoke: [],
    lightweight: browser('offline-operations'),
    full: browser('offline-operations'),
    sql: sql('offline_operations'),
  },
  reports: {
    impact: 'P2', usage: 'medium', rationale: 'Sales history and totals are regularly reviewed by sellers.',
    smoke: [],
    lightweight: browser('product-sales-report-flow', 'pos-sales-history'),
    full: browser('product-sales-report-flow', 'pos-sales-history', 'product-sales-report'),
    sql: sql('product_sales_report', 'pos_sales_history'),
  },
  media: {
    impact: 'P2', usage: 'medium', rationale: 'Images and variant presentation affect product selection and private storage boundaries.',
    smoke: [],
    lightweight: browser('product-presentation', 'image-storage', 'image-upload'),
    full: browser('product-presentation', 'image-storage', 'image-upload'),
    sql: sql('product_variant_gallery'),
  },
  appearance: {
    impact: 'P3', usage: 'medium', rationale: 'Optional event appearance tools affect discovery details rather than transactions.',
    smoke: [],
    lightweight: browser('event-appearances'),
    full: browser('event-appearances'),
    sql: sql('event_appearances'),
  },
  presentation: {
    impact: 'P2', usage: 'high', rationale: 'Shared styling and language touch public, storefront and seller surfaces.',
    smoke: ['src/tests/public-i18n-smoke.spec.ts › Public Nireq smoke › home supports discovery locators and language switching'],
    lightweight: browser('production-readiness', 'storefront', 'language-menu', 'e2e/language-selection'),
    full: browser('production-readiness', 'storefront', 'language-menu', 'e2e/language-selection', 'localization'),
    sql: [],
  },
};

export function matrixTier(impact, usage) {
  const matrix = {
    P1: ['smoke', 'lightweight', 'lightweight', 'full'],
    P2: ['lightweight', 'lightweight', 'lightweight', 'full'],
    P3: ['full', 'full', 'full', 'optional'],
    P4: ['optional', 'optional', 'optional', 'optional'],
  };
  const index = ['very-high', 'high', 'medium', 'low'].indexOf(usage);
  if (!matrix[impact] || index < 0) throw new Error(`Unknown risk classification: ${impact}/${usage}`);
  return matrix[impact][index];
}

// Shared trust boundaries and schema changes can fan out beyond a single feature.
const fullImpact = /^(?:supabase\/(?:migrations|functions|config\.toml)|scripts\/|\.github\/|(?:package(?:-lock)?\.json|playwright\.config\.|vite\.config\.|tsconfig|AGENTS\.md)|src\/(?:App\.tsx|main\.tsx|supabaseClient\.ts|utils\/(?:access|auth|workspaceSession)|tests\/helpers\/|types\/))/;
const rules = [
  [/^(?:index\.html|tokens\.css|tailwind\.config\.js|public\/)|\.css$|^src\/(?:i18n\.tsx|locales\/|components\/(?:BrandMark|CustomerBrandHeader|Language))/, ['presentation']],
  [/^src\/.*(?:Appearance|appearance)/, ['appearance', 'public']],
  [/^src\/.*(?:ProductPresentation|ProductMedia)/, ['media', 'catalog']],
  [/^src\/.*(?:ManageProducts|ProductForm|ProductFamily|ProductType|productTypes|productCsv|productCSV|csvImport|CsvImport|CSVImport|BundleEditor)/, ['products', 'catalog']],
  [/^src\/pages\/customer\/(?:DiscoveryHome|CreatorHome|QueueView)|^src\/components\/home\//, ['public', 'queue']],
  [/^src\/(?:pages\/(?:CreatorRegister|AdminLogin|StaffLogin|StaffSignup)|components\/(?:AccountMenu|PublicShell))/, ['auth', 'public']],
  [/^src\/.*(?:PlatformAdmin|platform-admin)/, ['platform']],
  [/^src\/.*(?:Offline|offline)/, ['recovery']],
  [/^src\/.*(?:Feedback|OrderProblem|HelpPage|LegalPage)/, ['support', 'public']],
  [/^src\/.*(?:Team|team|Invitation|Workspace|workspace|ManageArtist|GuidedSetup|SetupReadiness)/, ['workspace']],
  [/^src\/.*(?:Promotion|promotion|ActivityReward|activityReward)/, ['promotions', 'sales', 'catalog']],
  [/^src\/.*(?:SalesReport|SalesHistory|SalesBreakdown|salesReport|salesHistory)/, ['reports']],
  [/^src\/.*(?:Inventory|inventory|Stock|stock|Product|product|Catalog|catalog|Bundle|bundle)/, ['catalog', 'sales', 'promotions']],
  [/^src\/.*(?:Image|image|Upload|upload|Media|media|Avatar|avatar)/, ['media']],
  [/^src\/.*(?:Queue|queue|Calling|calling)/, ['queue', 'sales']],
  [/^src\/.*(?:Checkout|Cart|cart|Order|order|Payment|payment|Preorder|Postorder|OnlineCampaign|onlineCampaign|Pos|POS|pos)/, ['sales', 'promotions', 'catalog', 'queue']],
  [/^src\/(?:pages\/ManageCombined|components\/(?:AdminHeader|CustomerHeader|MainLayout|Navbar|menu\/|dashboard\/))/, ['queue', 'sales', 'catalog', 'public']],
];

function compact(selectors) {
  const values = [...new Set(selectors)];
  return values.filter(value => !values.some(other => other !== value && value.startsWith(`${other} › `)));
}

const dependencies = {
  products: ['catalog'],
  catalog: ['sales', 'promotions'],
  promotions: ['sales', 'catalog'],
};

export function impactScope(paths) {
  const domains = new Set();
  const reasons = [];
  const directBrowser = [];
  let full = false;
  for (const path of paths) {
    if (fullImpact.test(path)) { full = true; reasons.push(`${path}: shared boundary, schema or test infrastructure`); continue; }
    if (/^src\/tests\/.+\.spec\.ts$/.test(path)) {
      directBrowser.push(path);
      const owners = Object.entries(DOMAINS).filter(([, domain]) => [...domain.full, ...domain.lightweight, ...domain.smoke].some(selector => selector.split(' › ')[0] === path));
      if (!owners.length) { full = true; reasons.push(`${path}: unclassified test`); }
      owners.forEach(([name]) => domains.add(name));
      continue;
    }
    if (/^supabase\/tests\//.test(path)) {
      const owners = Object.entries(DOMAINS).filter(([, domain]) => domain.sql.includes(path));
      if (!owners.length) { full = true; reasons.push(`${path}: unclassified database test`); }
      owners.forEach(([name]) => domains.add(name));
      continue;
    }
    if (/^(?:docs\/|README)|\.md$/.test(path)) continue;
    const matched = rules.find(([pattern]) => pattern.test(path));
    if (matched) { matched[1].forEach(name => domains.add(name)); reasons.push(`${path}: ${matched[1].join(', ')}`); }
    else { full = true; reasons.push(`${path}: unknown impact; use Full`); }
  }
  // Set iteration includes newly added dependencies and terminates across pricing/stock cycles.
  for (const name of domains) for (const dependency of dependencies[name] || []) domains.add(dependency);
  return { domains: [...domains], full, reasons, directBrowser };
}

export function regressionPlan({ suite = 'affected', scopes = [], paths = [], isolated = false } = {}) {
  if (!['affected', 'smoke', 'lightweight', 'full'].includes(suite)) throw new Error(`Unknown suite: ${suite}`);
  for (const scope of scopes) if (!DOMAINS[scope]) throw new Error(`Unknown scope: ${scope}`);
  if (suite === 'affected' && scopes.length) throw new Error('Use --scope with an explicit smoke, lightweight or full suite; affected uses Git impact analysis.');
  for (const scope of scopes) if (!DOMAINS[scope][suite].length) throw new Error(`No ${suite} cases for ${scope}; choose its Lightweight or Full set.`);
  const impact = impactScope(paths);
  const all = (suite === 'full' && !scopes.length) || (suite === 'affected' && impact.full);
  const clean = suite === 'affected' && paths.length === 0;
  const names = (all ? Object.keys(DOMAINS) : suite === 'affected' && !clean ? impact.domains : scopes.length ? scopes : Object.keys(DOMAINS))
    .filter(name => all || !(suite === 'smoke' || clean) || DOMAINS[name].smoke.length);
  const levels = Object.fromEntries(names.map(name => [name, all ? 'full' : suite === 'affected' ? clean ? 'smoke' : matrixTier(DOMAINS[name].impact, DOMAINS[name].usage) : suite]));
  const selected = [];
  const sqlFiles = new Set();
  let teamRace = all, promotionRace = all, api = all;
  for (const [name, tier] of Object.entries(levels)) {
    if (tier === 'optional') continue;
    const domain = DOMAINS[name];
    selected.push(...domain[tier]);
    // Explicit Smoke is a fast journey check; affected business logic keeps its server invariants.
    if (tier !== 'smoke' || (suite === 'affected' && !clean)) domain.sql.forEach(file => sqlFiles.add(file));
    teamRace ||= Boolean(domain.teamRace && tier !== 'smoke');
    promotionRace ||= Boolean(domain.promotionRace && tier !== 'smoke');
    api ||= Boolean(domain.api && (tier !== 'smoke' || suite === 'affected' && !clean));
  }
  const allowed = selector => isolated || !ISOLATED_BROWSER_SPECS.includes(selector.split(' › ')[0]);
  const browserSelectors = compact([
    ...(all ? FULL_BROWSER_SPECS : selected),
    ...(suite === 'affected' ? impact.directBrowser : []),
  ].filter(allowed));
  return {
    requested: suite, full: all, paths, levels,
    label: all ? 'Full release' : `${clean ? 'Smoke baseline' : `Scoped ${suite}`} [${names.join(', ') || 'static only'}]`,
    reasons: clean ? ['Clean worktree: Smoke baseline. Use --base <commit> to include committed changes.'] : impact.reasons,
    browser: browserSelectors, sql: all ? 'all' : [...sqlFiles].sort(),
    teamRace, promotionRace, api,
    build: all || browserSelectors.length > 0 || sqlFiles.size > 0,
  };
}
