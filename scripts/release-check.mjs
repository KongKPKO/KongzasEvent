#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const isHygieneOnly = args.includes('hygiene');
const mode = args.find(a => a !== 'hygiene') || 'local';

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

// Always check hygiene first
checkHygiene();

if (isHygieneOnly) {
  process.exit(0);
}

run('node', ['scripts/validate-env.mjs', mode]);
run('npm', ['run', 'build']);
run('npx', ['playwright', 'test', 'src/tests/public-i18n-smoke.spec.ts', '--project=desktop-chromium']);

if (mode === 'local' || mode === 'lan') {
  run('npm', ['run', 'test:api:smoke']);
}

console.log(`\nRelease check passed for ${mode}.`);
