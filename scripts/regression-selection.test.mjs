import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOMAINS, FULL_BROWSER_SPECS, ISOLATED_BROWSER_SPECS, matrixTier, regressionPlan } from './regression-suites.mjs';
import { parseRegressionArgs, changedPaths, selectCollectedCases } from './regression-selection.mjs';

test('all sixteen cells follow the supplied Impact × Usage matrix', () => {
  const expected = {
    P1: ['smoke', 'lightweight', 'lightweight', 'full'],
    P2: ['lightweight', 'lightweight', 'lightweight', 'full'],
    P3: ['full', 'full', 'full', 'optional'],
    P4: ['optional', 'optional', 'optional', 'optional'],
  };
  for (const [impact, tiers] of Object.entries(expected)) {
    ['very-high', 'high', 'medium', 'low'].forEach((usage, index) => assert.equal(matrixTier(impact, usage), tiers[index]));
  }
  assert.throws(() => matrixTier('P0', 'low'), /Unknown/);
  assert.throws(() => matrixTier('P1', 'unmeasured'), /Unknown/);
});

test('shared presentation changes select representative UI flows without unrelated database work', () => {
  const plan = regressionPlan({ paths: ['src/index.css', 'tokens.css'], isolated: true });
  assert.equal(plan.full, false);
  assert.deepEqual(plan.levels, { presentation: 'lightweight' });
  assert.deepEqual(plan.sql, []);
  assert.equal(plan.promotionRace || plan.teamRace || plan.api, false);
  assert.ok(plan.browser.includes('src/tests/storefront.spec.ts'));
  assert.ok(plan.browser.includes('src/tests/e2e/language-selection.spec.ts'));
});

test('pricing and inventory fan out to checkout and keep SQL transactions and stock races', () => {
  for (const path of ['src/lib/promotions.ts', 'src/components/creator/ManageProducts.tsx', 'src/lib/onlineCampaigns.ts']) {
    const plan = regressionPlan({ paths: [path] });
    assert.equal(plan.full, false);
    assert.ok(plan.sql.includes('supabase/tests/stock_summary_lifecycle_test.sql'));
    assert.ok(plan.sql.includes('supabase/tests/promotion_rpc_authorization_test.sql'));
    assert.ok(plan.sql.includes('supabase/tests/online_campaign_test.sql'));
    assert.equal(plan.promotionRace, true);
    assert.equal(plan.api, true);
  }
});

test('rare privileged operations use the complete affected domain including role races', () => {
  const team = regressionPlan({ paths: ['src/components/team/TeamManager.tsx'] });
  assert.equal(team.levels.workspace, 'full');
  assert.equal(team.teamRace, true);
  assert.ok(team.sql.includes('supabase/tests/account_management_suspension_test.sql'));
  assert.ok(team.browser.includes('src/tests/team-invitation-email.spec.ts'));
  assert.ok(team.browser.includes('src/tests/security-rls-regression.spec.ts'));
  const admin = regressionPlan({ paths: ['src/components/PlatformAdminGate.tsx'] });
  assert.equal(admin.levels.platform, 'full');
  assert.ok(admin.browser.includes('src/tests/platform-admin-mfa.spec.ts'));
});

test('schema, shared auth, test infrastructure and unknown runtime changes fail conservatively to Full', () => {
  for (const path of ['supabase/migrations/20261026000000_new.sql', 'src/utils/access.ts', 'src/App.tsx', 'scripts/regression-suites.mjs', 'supabase/functions/notify-team-invitation/index.ts', 'supabase/functions/upload-image/index.ts', 'supabase/functions/admin-resend-order-link/index.ts', 'playwright.config.ts', 'src/new-feature.ts']) {
    const plan = regressionPlan({ paths: [path], isolated: true });
    assert.equal(plan.full, true, path);
    assert.equal(plan.sql, 'all');
    assert.equal(plan.teamRace && plan.promotionRace && plan.api, true);
    assert.deepEqual(plan.browser, FULL_BROWSER_SPECS);
  }
});


test('image upload implementation and customer queue state keep their direct regressions', () => {
  const media = regressionPlan({ paths: ['src/utils/uploadImage.ts'] });
  assert.ok(media.browser.includes('src/tests/image-upload.spec.ts'));
  const queue = regressionPlan({ paths: ['src/hooks/useQueueOperations.ts'] });
  assert.ok(queue.browser.includes('src/tests/e2e/full-service-loop.spec.ts'));
  assert.equal(queue.levels.queue, 'lightweight');
  const appearance = regressionPlan({ paths: ['src/components/home/EventAppearancePreview.tsx'] });
  assert.ok(appearance.browser.includes('src/tests/event-appearances.spec.ts'));
  const product = regressionPlan({ paths: ['src/pages/creators/ManageProducts.tsx'] });
  assert.equal(product.levels.products, 'full');
  assert.ok(product.browser.includes('src/tests/product-families-flow.spec.ts'));
  assert.ok(product.browser.includes('src/tests/product-csv-import-flow.spec.ts'));
  const presentation = regressionPlan({ paths: ['src/components/menu/ProductPresentation.tsx'] });
  assert.ok(presentation.browser.includes('src/tests/product-presentation.spec.ts'));
});

test('changed specs always run in full, even when their domain normally selects a Smoke case', () => {
  const file = 'src/tests/e2e/full-service-loop.spec.ts';
  const plan = regressionPlan({ paths: [file] });
  assert.ok(plan.browser.includes(file));
  assert.ok(!plan.browser.some(selector => selector.startsWith(`${file} › `)));
  const unknown = regressionPlan({ paths: ['src/tests/new-regression.spec.ts'] });
  assert.equal(unknown.full, true);
  assert.ok(unknown.browser.includes('src/tests/new-regression.spec.ts'));
});

test('docs-only verification needs no backend; clean verification uses Smoke; committed changes can use a base', () => {
  const docs = regressionPlan({ paths: ['docs/testing.md'] });
  assert.equal(docs.build, false);
  assert.deepEqual(docs.browser, []);
  const clean = regressionPlan();
  assert.ok(clean.browser.length > 0);
  assert.equal(clean.full, false);
  assert.deepEqual(clean.sql, []);
  assert.equal(clean.api || clean.teamRace || clean.promotionRace, false);
  assert.match(clean.reasons[0], /--base/);
});

test('scoped Full stays scoped, and isolated-only fixtures retain their existing guard', () => {
  const plan = regressionPlan({ suite: 'full', scopes: ['reports'] });
  assert.deepEqual(Object.keys(plan.levels), ['reports']);
  assert.equal(plan.full, false);
  assert.match(plan.label, /Scoped full.*reports/);
  assert.ok(plan.sql.includes('supabase/tests/product_sales_report_test.sql'));
  assert.ok(!plan.sql.includes('supabase/tests/platform_admin_mfa_test.sql'));
  const standard = regressionPlan({ suite: 'full' });
  for (const file of ISOLATED_BROWSER_SPECS) assert.ok(!standard.browser.includes(file));
});

test('the release roster remains classified and every selected SQL/browser file exists', () => {
  const owned = new Set(Object.values(DOMAINS).flatMap(domain => domain.full));
  for (const file of FULL_BROWSER_SPECS) {
    assert.ok(existsSync(file), file);
    assert.ok(owned.has(file), `Unclassified release spec: ${file}`);
  }
  for (const domain of Object.values(DOMAINS)) for (const file of domain.sql) assert.ok(existsSync(file), file);
});

test('invalid names, arguments and remote fixture selection cannot silently reduce coverage', () => {
  for (const args of [ ['local', '--suite', 'tiny'], ['local', '--suite', 'smoke', '--scope', 'platform'], ['local', '--suite', 'full', '--scope', 'typo'], ['local', '--suite'], ['--unknown'], ['hygiene', '--list'], ['local', '--suite', 'full', '--base', 'HEAD~1'], ['staging', '--suite', 'smoke'], ['production', '--scope', 'sales'] ]) {
    assert.throws(() => parseRegressionArgs(args));
  }
  assert.throws(() => regressionPlan({ suite: 'affected', scopes: ['sales'] }), /Git impact/);
  assert.equal(parseRegressionArgs(['local', 'guard']).guard, true);
  assert.equal(parseRegressionArgs(['staging']).suite, 'full');
  assert.deepEqual(parseRegressionArgs(['local', '--suite', 'lightweight', '--scope', 'reports,public']).scopes, ['reports', 'public']);
});

test('Git impact includes staged/unstaged/untracked files, renames and a committed base, excluding ignored output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'paimon-impact-test-'));
  const git = args => execFileSync('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']); git(['config', 'user.email', 'local-fixture@example.test']); git(['config', 'user.name', 'Local fixture']);
    mkdirSync(join(directory, 'src'));
    writeFileSync(join(directory, '.gitignore'), 'output/\n');
    writeFileSync(join(directory, 'src/old name.ts'), 'original\n');
    git(['add', '.']); git(['commit', '-qm', 'fixture base']);
    const base = git(['rev-parse', 'HEAD']);
    git(['mv', 'src/old name.ts', 'src/new name.ts']); git(['commit', '-qm', 'rename']);
    writeFileSync(join(directory, 'src/new name.ts'), 'staged\n'); git(['add', '.']);
    writeFileSync(join(directory, 'src/new name.ts'), 'original\n');
    writeFileSync(join(directory, 'untracked.md'), 'fixture');
    mkdirSync(join(directory, 'output')); writeFileSync(join(directory, 'output/ignored.txt'), 'ignored');
    assert.deepEqual(changedPaths(base, directory), ['src/new name.ts', 'src/old name.ts', 'untracked.md']);
    assert.ok(changedPaths('HEAD', directory).includes('src/new name.ts'), 'staged edit survives a worktree restore');
    assert.throws(() => changedPaths('--not-a-ref', directory));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('collection validates every case, including nested suites; one stale selector fails even if other tests exist', () => {
  const report = { suites: [{ title: 'example.spec.ts', specs: [], suites: [{ title: 'outer', specs: [], suites: [{ title: 'inner', specs: [{ file: 'example.spec.ts', title: 'works' }] }] }] }] };
  assert.deepEqual(selectCollectedCases(['src/tests/example.spec.ts › outer › inner › works'], report), ['example.spec.ts › outer › inner › works']);
  assert.deepEqual(selectCollectedCases(['src/tests/example.spec.ts'], report), ['example.spec.ts › outer › inner › works']);
  assert.throws(() => selectCollectedCases(['src/tests/example.spec.ts › outer › inner › works', 'src/tests/example.spec.ts › missing'], report), /no longer exists/);
  assert.throws(() => selectCollectedCases(['src/tests/example.spec.ts'], { suites: [] }), /no longer exists/);
  assert.throws(() => selectCollectedCases(['src/tests/example.spec.ts'], { errors: [{}] }), /collection failed/);
});
