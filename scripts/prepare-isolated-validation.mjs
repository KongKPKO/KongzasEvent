#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, process.argv[2] || 'output/phase01-local');
if (!target.startsWith(`${resolve(root, 'output')}${sep}`) || existsSync(target)) {
  throw new Error('Choose a new, nonexistent directory inside repository output/. Existing workspaces are never overwritten.');
}
let config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
config = config.replace(/^project_id\s*=.*$/m, 'project_id = "NireqPhase01Validation"');
for (const [oldPort, newPort] of [[54320,59320],[54321,59321],[54322,59322],[54323,59323],[54324,59324],[54327,59327],[54329,59329],[8083,59328]]) {
  config = config.replace(new RegExp(`\\b${oldPort}\\b`, 'g'), String(newPort));
}
config = config.replace(/(\[db.seed\])[\s\S]*?(?=\n\[|$)/, '$1\nenabled = false\nsql_paths = []\n');
config = config.replace(/(\[auth.external.google\][\s\S]*?\n)enabled\s*=\s*true/, '$1enabled = false');
const dir = resolve(target, 'supabase');
mkdirSync(resolve(dir, '.temp'), { recursive: true });
writeFileSync(resolve(dir, 'config.toml'), config);
// CLI 2.98.2 otherwise selects 17.6.1.106, which crashes on denied EXECUTE.
writeFileSync(resolve(dir, '.temp/postgres-version'), '17.6.1.063\n');
cpSync(resolve(root, 'supabase/migrations'), resolve(dir, 'migrations'), { recursive: true });
for (const name of ['functions', 'tests']) symlinkSync(resolve(root, 'supabase', name), resolve(dir, name), 'dir');
writeFileSync(resolve(target, 'functions.env'), [
  'PUBLIC_SITE_URL=http://127.0.0.1:5173',
  'MAILPIT_API_URL=http://host.docker.internal:59324/api/v1/send',
  'APPLICATION_EMAIL_MODE=log',
  '',
].join('\n'));
console.log(`Prepared isolated workspace: ${target}`);
console.log('Project NireqPhase01Validation; API 59321, DB 59322, Mailpit 59324. Seed disabled; no remote keys or historical data copied.');
console.log('Check these ports are free, then start with the commands in docs/runbooks/phase01-local-validation.md.');
