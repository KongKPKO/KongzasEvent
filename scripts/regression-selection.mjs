import { execFileSync } from 'node:child_process';
import { DOMAINS, regressionPlan } from './regression-suites.mjs';

export function parseRegressionArgs(args) {
  const result = { mode: 'local', suite: 'full', scopes: [], base: 'HEAD', list: false, hygiene: false, guard: false };
  let hasMode = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['hygiene', 'guard', '--list'].includes(arg)) {
      result[arg === '--list' ? 'list' : arg] = true;
    } else if (['--suite', '--scope', '--base'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--scope') result.scopes.push(...value.split(','));
      else result[arg.slice(2)] = value;
    } else if (['local', 'lan', 'staging', 'production'].includes(arg) && !hasMode) {
      result.mode = arg;
      hasMode = true;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.base !== 'HEAD' && result.suite !== 'affected') throw new Error('--base applies only to the affected suite.');
  if ((result.hygiene || result.guard) && (result.list || result.scopes.length || result.suite !== 'full' || result.base !== 'HEAD')) throw new Error('Do not combine hygiene/guard with regression selection options.');
  if (result.mode !== 'local' && (result.suite !== 'full' || result.scopes.length || result.list || result.guard)) {
    throw new Error('Regression selection and fixture guards are local-only. Remote checks remain public smoke only.');
  }
  // Validate names even for --list, before any backend can be contacted.
  regressionPlan({ suite: result.suite, scopes: result.scopes });
  return result;
}

export function changedPaths(base = 'HEAD', cwd = process.cwd()) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const revision = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const paths = [
    git(['diff', '--name-only', '--no-renames', '-z', revision, '--']),
    git(['diff', '--cached', '--name-only', '--no-renames', '-z', revision, '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return [...new Set(paths.flatMap(value => value.split('\0').filter(Boolean)))].sort();
}

export function describePlan(plan) {
  const lines = [`Regression: ${plan.label}`, 'Usage basis: provisional product assumptions; not measured percentages.'];
  for (const [name, tier] of Object.entries(plan.levels)) lines.push(`  ${name}: ${tier} (Impact ${DOMAINS[name].impact}; provisional usage ${DOMAINS[name].usage})`);
  for (const reason of plan.reasons) lines.push(`  Why: ${reason}`);
  lines.push(`Build: ${plan.build ? 'yes' : 'no (static checks only)'}`);
  lines.push(`SQL: ${plan.sql === 'all' ? 'all existing release suites' : plan.sql.length + ' scoped files'}`);
  if (Array.isArray(plan.sql)) lines.push(...plan.sql.map(file => `  ${file}`));
  lines.push(`Concurrency: team=${plan.teamRace}, promotions=${plan.promotionRace}; API smoke=${plan.api}`);
  lines.push(`Browser selections: ${plan.browser.length} file/case entries (not an assertion count)`);
  lines.push(...plan.browser.map(selector => `  ${selector}`));
  return lines.join('\n');
}

export function browserFile(selector) {
  return selector.split(' › ')[0];
}

export function selectCollectedCases(selectors, report) {
  const collected = [];
  const visit = (suite, titles = []) => {
    for (const spec of suite.specs || []) collected.push({ file: spec.file.replaceAll('\\', '/'), titles: [...titles, spec.title] });
    for (const child of suite.suites || []) visit(child, [...titles, child.title]);
  };
  // The first suite title is the file name; it is not a describe() group.
  for (const suite of report.suites || []) visit(suite);
  if (report.errors?.length) throw new Error('Playwright collection failed; inspect the collection report.');
  for (const selector of selectors) {
    const [file, ...titles] = selector.split(' › ');
    const relative = file.replace(/^src\/tests\//, '');
    if (!collected.some(test => (test.file === relative || test.file.endsWith(`/${relative}`)) && titles.every((title, index) => test.titles[index] === title))) {
      throw new Error(`Regression selection no longer exists: ${selector}`);
    }
  }
  if (selectors.length && !collected.length) throw new Error('Regression selection unexpectedly collected zero tests.');
  return [...new Set(collected.flatMap(test => {
    const selector = selectors.find(value => {
      const [file, ...titles] = value.split(' › ');
      const relative = file.replace(/^src\/tests\//, '');
      return (test.file === relative || test.file.endsWith(`/${relative}`)) && titles.every((title, index) => test.titles[index] === title);
    });
    return selector ? [`${browserFile(selector).replace(/^src\/tests\//, '')} › ${test.titles.join(' › ')}`] : [];
  }))];
}
