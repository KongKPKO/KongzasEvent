#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] || 'local';

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

run('node', ['scripts/validate-env.mjs', mode]);
run('npm', ['run', 'build']);
run('npx', ['playwright', 'test', 'src/tests/public-i18n-smoke.spec.ts', '--project=desktop-chromium']);

if (mode === 'local' || mode === 'lan') {
  run('npm', ['run', 'test:api:smoke']);
}

console.log(`\nRelease check passed for ${mode}.`);
