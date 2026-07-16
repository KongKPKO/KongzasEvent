#!/usr/bin/env node

const PRODUCTION_PROJECT_REF = 'fnutmjnzugpayccscvgr';

export function validateReleaseEnv({ url, anonKey, allowProduction = false }) {
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_KEY) are required.');
  }

  let projectRef;
  try {
    projectRef = new URL(url).hostname.split('.')[0];
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid URL.');
  }

  if (/service_role|sb_secret/i.test(anonKey)) {
    throw new Error('Browser and CI tests require a publishable/anon key, never a privileged key.');
  }

  if (!allowProduction && projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('CI and automated load tests must not target the Production Supabase project.');
  }

  return projectRef;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mode = process.argv[2] || 'ci';
  try {
    const projectRef = validateReleaseEnv({
      url: process.env.VITE_SUPABASE_URL,
      anonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY,
      allowProduction: mode === 'production',
    });
    console.log(`[release-env:${mode}] OK -> ${projectRef}`);
  } catch (error) {
    console.error(`[release-env:${mode}] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
