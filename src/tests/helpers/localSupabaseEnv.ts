import { execFileSync } from 'node:child_process';

const readLocalSupabaseEnv = () => {
  try {
    const statusEnv = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return Object.fromEntries(
      statusEnv
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
        })
    ) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
};

export const resolveSupabaseTestEnv = () => {
  const localSupabaseEnv = readLocalSupabaseEnv();
  const url = localSupabaseEnv.API_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
  const anonKey = localSupabaseEnv.ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';
  const serviceKey = localSupabaseEnv.SERVICE_ROLE_KEY || process.env.TEST_SUPABASE_SERVICE_KEY || '';

  return {
    url,
    anonKey,
    serviceKey,
    key: serviceKey || anonKey,
  };
};
