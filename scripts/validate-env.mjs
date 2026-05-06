#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2] || process.env.APP_ENV || 'local';

const configs = {
  local: {
    files: ['.env.local'],
    allowedHosts: ['127.0.0.1', 'localhost'],
  },
  lan: {
    files: ['.env.lan', '.env.local'],
    blockedHosts: ['127.0.0.1', 'localhost'],
  },
  staging: {
    files: ['.env.staging'],
    requiredProjectRef: 'kdjqitvtxmcrnnpuxuyl',
    blockedProjectRef: 'fnutmjnzugpayccscvgr',
  },
  production: {
    files: ['.env.production'],
    requiredProjectRef: 'fnutmjnzugpayccscvgr',
    blockedProjectRef: 'kdjqitvtxmcrnnpuxuyl',
  },
};

const config = configs[mode];

if (!config) {
  console.error(`Unknown environment "${mode}". Use one of: ${Object.keys(configs).join(', ')}`);
  process.exit(1);
}

const parseEnv = (content) => {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
};

const env = {};
const loadedFiles = [];

for (const file of config.files) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  loadedFiles.push(file);
}

Object.assign(env, Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))
));

const url = env.VITE_SUPABASE_URL || '';
const key = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_KEY || '';

const fail = (message) => {
  console.error(`[env:${mode}] ${message}`);
  process.exit(1);
};

if (!url) fail('Missing VITE_SUPABASE_URL.');
if (!key) fail('Missing VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_KEY.');

let host = '';
try {
  host = new URL(url).hostname;
} catch {
  fail(`VITE_SUPABASE_URL is not a valid URL: ${url}`);
}

if (config.allowedHosts && !config.allowedHosts.includes(host)) {
  fail(`Expected Supabase host to be ${config.allowedHosts.join(' or ')}, got ${host}.`);
}

if (config.blockedHosts?.includes(host)) {
  fail(`Supabase URL uses ${host}. For ${mode}, use a reachable LAN/cloud URL instead.`);
}

if (config.requiredProjectRef && !url.includes(config.requiredProjectRef)) {
  fail(`Expected Supabase URL to point at ${config.requiredProjectRef}.`);
}

if (config.blockedProjectRef && url.includes(config.blockedProjectRef)) {
  fail(`Supabase URL points at blocked project ${config.blockedProjectRef}.`);
}

if (/service_role|sb_secret/i.test(key)) {
  fail('Frontend key looks like a service/secret key. Use a publishable/anon key only.');
}

console.log(`[env:${mode}] OK (${loadedFiles.length > 0 ? loadedFiles.join(', ') : 'process env'}) -> ${url}`);
