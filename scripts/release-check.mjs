#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const isHygieneOnly = args.includes('hygiene');
const isGuardOnly = args.includes('guard');
const mode = args.find(a => !['hygiene', 'guard'].includes(a)) || 'local';
const workdir = process.env.SUPABASE_WORKDIR;

const checkHygiene = () => {
  console.log('\n> Checking repository hygiene and secrets for public release...');
  const lsFiles = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
  if (lsFiles.status !== 0) {
    console.error('Failed to run git ls-files. Is this a git repository?');
    return; // Don't fail if not in git, but warn
  }

  const trackedFiles = lsFiles.stdout.split('\n').filter(Boolean);
  
  // 1. Path Check
  const pathBlacklist = [
    { pattern: /^\.env$/, label: 'Root .env file' },
    { pattern: /\.env\.local$/, label: 'Local environment file' },
    { pattern: /\.env\.production$/, label: 'Production environment file' },
    { pattern: /service_role/i, label: 'Possible service role key file' },
    { pattern: /^dist\//, label: 'Build artifacts (dist/)' },
    { pattern: /^screenshots\//, label: 'Local screenshots' },
    { pattern: /^debug-.*\.png$/, label: 'Debug screenshots' },
    { pattern: /\.DS_Store$/, label: 'macOS system file' },
  ];

  const riskyPaths = trackedFiles.filter(file => 
    pathBlacklist.some(item => item.pattern.test(file))
  );

  // 2. Content Scan
  const secretPatterns = [
    { pattern: /service_role/i, label: 'service_role token' },
    { pattern: /SUPABASE_SERVICE/i, label: 'SUPABASE_SERVICE key' },
    { pattern: /sb_secret_/i, label: 'Supabase internal secret (sb_secret_)' },
    { pattern: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI key (sk-)' },
    { pattern: /ghp_[a-zA-Z0-9]{20,}/, label: 'GitHub token (ghp_)' },
    { pattern: /private_key/i, label: 'private_key' },
  ];

  const skipContentCheck = (file) => {
    const skipDirs = ['node_modules/', 'dist/', 'build/', '.git/'];
    if (skipDirs.some(dir => file.startsWith(dir))) return true;
    
    // Binary extensions
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.heic', '.mov', '.mp4'];
    if (binaryExts.some(ext => file.endsWith(ext))) return true;
    
    return false;
  };

  const riskyContent = [];
  trackedFiles.filter(file => !skipContentCheck(file)).forEach(file => {
    try {
      if (!existsSync(file)) return;
      const content = readFileSync(file, 'utf8');
      
      // Basic binary check (null byte)
      if (content.includes('\u0000')) return;

      const lines = content.split('\n');
      lines.forEach((line, index) => {
        const lowerLine = line.toLowerCase();
        secretPatterns.forEach(({ pattern, label }) => {
          if (pattern.test(line)) {
            // Avoid false positives for placeholders, variable declarations, and logic
            const isFalsePositive = 
              lowerLine.includes('<your-') || 
              lowerLine.includes('your-service-role-key') ||
              (file.endsWith('.example') && lowerLine.includes('key=')) ||
              // Code references to env vars
              lowerLine.includes('process.env.') ||
              lowerLine.trimStart().startsWith('delete remoteenv.') ||
              /\w*[Ee]nv\.SERVICE_ROLE_KEY/.test(line) ||
              (label === 'service_role token' && /^const db\s*=\s*createClient\(env\.API_URL,\s*env\.SERVICE_ROLE_KEY,\s*\{auth:\{persistSession:false\}\}\);$/.test(line)) ||
              lowerLine.includes('deno.env.get') ||
              lowerLine.includes('deno.env.set') ||
              lowerLine.includes('deno.env.toobject') ||
              // Regex patterns
              lowerLine.includes('pattern:') ||
              lowerLine.includes('.test(') ||
              lowerLine.includes('const secretpatterns') ||
              // SQL Role/Permission statements
              lowerLine.includes('to "service_role"') ||
              lowerLine.includes('to service_role') ||
              /current_user\s+(?:not\s+)?in\s*\([^)]*['"]service_role['"]/.test(lowerLine) ||
              /has_function_privilege\(\s*['"]service_role['"]\s*,/.test(lowerLine) ||
              lowerLine.includes('on table') ||
              lowerLine.includes('on function') ||
              lowerLine.includes('on sequence') ||
              lowerLine.includes('on all tables') ||
              lowerLine.includes('grant ') ||
              lowerLine.includes('revoke ') ||
              lowerLine.includes('alter default privileges') ||
              // Shell variable logic
              lowerLine.includes('="${service_role_key') ||
              lowerLine.includes('service_role_key="$(') ||
              lowerLine.includes('"${service_role_key}"') ||
              lowerLine.includes('service_role_key=') ||
              lowerLine.includes('missing anon_key or service_role_key') ||
              lowerLine.includes('authorization: bearer ${service_role_key}') ||
              lowerLine.includes('apikey: ${service_role_key}') ||
              // Variable names without actual values
              line.match(/^[ \t]*(?:const|let|var|readonly) [A-Za-z0-9_]+[ \t]*=[ \t]*['"]{0,2}[A-Z_]+['"]{0,2};?$/);
            
            if (!isFalsePositive) {
              riskyContent.push({ file, line: index + 1, label, snippet: line.trim() });
            }
          }
        });
      });
    } catch (e) {
      // Silently skip files that fail to read (likely binary)
    }
  });

  let hasErrors = false;

  if (riskyPaths.length > 0) {
    console.error('\n❌ RISKY FILES DETECTED IN GIT TRACKING:');
    riskyPaths.forEach(file => {
      const match = pathBlacklist.find(item => item.pattern.test(file));
      console.error(`   - ${file} (${match.label})`);
    });
    hasErrors = true;
  }

  if (riskyContent.length > 0) {
    console.error('\n❌ RISKY CONTENT DETECTED IN TRACKED FILES:');
    riskyContent.forEach(({ file, line, label, snippet }) => {
      console.error(`   - ${file}:${line} (${label})`);
      console.error(`     Snippet: ${snippet}`);
    });
    hasErrors = true;
  }

  if (hasErrors) {
    console.error('\nRemediation steps:');
    console.error('1. Remove risky files from git tracking (if applicable):');
    console.error('   git rm --cached <filename>');
    console.error('2. For risky content, remove the secret and use environment variables.');
    console.error('3. If it is a false positive, update scripts/release-check.mjs to exclude it.');
    console.error('4. Ensure sensitive files are in .gitignore.');
    process.exit(1);
  }

  console.log('✅ Repository hygiene and secrets check passed.');
};

const run = (command, args, options = {}) => {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const readLocalSupabaseEnv = () => {
  const status = spawnSync('supabase', [
    'status', '-o', 'env',
    ...(workdir ? ['--workdir', workdir] : []),
  ], { encoding: 'utf8' });
  if (status.status !== 0) {
    console.error(status.stderr || 'Local Supabase is unavailable.');
    process.exit(status.status || 1);
  }

  const env = Object.fromEntries(status.stdout.split('\n').filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
  }));
  let apiUrl;
  try {
    apiUrl = new URL(env.API_URL || '');
  } catch {
    console.error('Local Supabase did not report a valid API URL.');
    process.exit(1);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname) || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    console.error('Release tests require a running local Supabase with anon and service-role credentials.');
    process.exit(1);
  }

  for (const [name, expected] of Object.entries({
    VITE_SUPABASE_URL: env.API_URL,
    SUPABASE_URL: env.API_URL,
    VITE_SUPABASE_ANON_KEY: env.ANON_KEY,
    VITE_SUPABASE_KEY: env.ANON_KEY,
    SUPABASE_ANON_KEY: env.ANON_KEY,
    TEST_SUPABASE_SERVICE_KEY: env.SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
  })) {
    if (process.env[name] && process.env[name] !== expected) {
      console.error(`${name} does not match the discovered local Supabase instance.`);
      process.exit(1);
    }
  }

  for (const [name, value] of Object.entries({
    PLAYWRIGHT_ENV: process.env.PLAYWRIGHT_ENV,
    PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL,
  })) {
    if (value && (name === 'PLAYWRIGHT_ENV' ? value !== 'local' : !['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname))) {
      console.error(`${name} must target the local release environment.`);
      process.exit(1);
    }
  }

  const health = spawnSync('curl', ['--fail', '--silent', '--show-error', `${env.API_URL}/auth/v1/health`]);
  if (health.status !== 0) {
    console.error('Local Supabase Auth is unavailable.');
    process.exit(health.status || 1);
  }

  console.log(`[release:local] fixture backend ready at ${env.API_URL}`);
  return {
    ...process.env,
    VITE_SUPABASE_URL: env.API_URL,
    SUPABASE_URL: env.API_URL,
    VITE_SUPABASE_ANON_KEY: env.ANON_KEY,
    VITE_SUPABASE_KEY: env.ANON_KEY,
    SUPABASE_ANON_KEY: env.ANON_KEY,
    TEST_SUPABASE_SERVICE_KEY: env.SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY,
    PLAYWRIGHT_ENV: 'local',
    PLAYWRIGHT_REUSE_SERVER: '0',
  };
};

// Always check hygiene first
checkHygiene();

if (isHygieneOnly) {
  process.exit(0);
}

if (mode === 'local') {
  const localEnv = readLocalSupabaseEnv();
  if (isGuardOnly) process.exit(0);

  run('node', ['scripts/validate-env.mjs', mode], { env: localEnv });
  run('npm', ['run', 'build'], { env: localEnv });
  run('supabase', [
    'test', 'db', '--local',
    ...(workdir ? ['--workdir', workdir] : []),
  ], { env: localEnv });
  run('node', ['scripts/test-promotion-release.mjs'], { env: localEnv });
  run('npx', ['playwright', 'test',
    'src/tests/setup-readiness.spec.ts',
    'src/tests/production-readiness.spec.ts',
    'src/tests/public-i18n-smoke.spec.ts',
    'src/tests/queue-availability.spec.ts',
    'src/tests/online-shop-discovery.spec.ts',
    'src/tests/storefront.spec.ts',
    'src/tests/catalog-stock-retry.spec.ts',
    'src/tests/image-upload.spec.ts',
    'src/tests/image-storage.spec.ts',
    'src/tests/offline-operations.spec.ts',
    'src/tests/promotion-save.spec.ts',
    'src/tests/promotion-mixed-rewards.spec.ts',
    'src/tests/security-rls-regression.spec.ts',
    'src/tests/e2e/full-service-loop.spec.ts',
    'src/tests/e2e/pilot-auth.spec.ts',
    'src/tests/e2e/pilot-preorder.spec.ts',
    'src/tests/regression/online-campaign.spec.ts',
    'src/tests/product-presentation.spec.ts',
    'src/tests/product-families-flow.spec.ts',
    'src/tests/product-types-flow.spec.ts',
    'src/tests/product-csv-import.spec.ts',
    'src/tests/product-csv-import-flow.spec.ts',
    'src/tests/event-appearances.spec.ts',
    '--project=desktop-chromium',
  ], { env: localEnv });
  run('npm', ['run', 'test:api:smoke'], { env: localEnv });
} else {
  if (isGuardOnly) {
    console.error('The fixture guard is only available for local release tests.');
    process.exit(1);
  }
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
  if (!baseUrl || ['127.0.0.1', 'localhost', '::1'].includes(new URL(baseUrl).hostname)) {
    console.error(`${mode} release checks require PLAYWRIGHT_BASE_URL for the deployed non-local site.`);
    process.exit(1);
  }
  const remoteEnv = { ...process.env, PLAYWRIGHT_ENV: mode };
  delete remoteEnv.SUPABASE_WORKDIR;
  delete remoteEnv.TEST_SUPABASE_SERVICE_KEY;
  delete remoteEnv.SUPABASE_SERVICE_ROLE_KEY;
  run('node', ['scripts/validate-env.mjs', mode], { env: remoteEnv });
  run('npm', ['run', mode === 'staging' ? 'build:staging' : mode === 'production' ? 'build:prod' : 'build'], { env: remoteEnv });
  run('npx', ['playwright', 'test',
    'src/tests/production-readiness.spec.ts',
    'src/tests/public-i18n-smoke.spec.ts',
    '--project=desktop-chromium',
    '--grep', 'Production readiness public UX|Public Nireq smoke|Public release assets',
  ], { env: remoteEnv });
}

console.log(`\nRelease check passed for ${mode}.`);
