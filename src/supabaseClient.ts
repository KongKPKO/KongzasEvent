import { createClient } from '@supabase/supabase-js';

// ฟังก์ชันดึงค่า Config แบบ Hybrid (รองรับทั้ง Vite และ Node.js/Playwright)
const getEnv = (key: string) => {
  // 1. ลองดึงจาก Vite (Browser)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  // 2. ถ้าไม่มี ให้ลองดึงจาก Node.js (Playwright/Server)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return '';
};

const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']);

const rewriteToCurrentHost = (rawUrl: string) => {
  if (!rawUrl || typeof window === 'undefined') return rawUrl;

  try {
    const url = new URL(rawUrl);
    const currentHost = window.location.hostname;
    const currentHostIsLocal = localHosts.has(currentHost);

    if (url.hostname === 'host.docker.internal') {
      url.hostname = currentHost;
      return url.toString().replace(/\/$/, '');
    }

    if (localHosts.has(url.hostname) && !currentHostIsLocal) {
      url.hostname = currentHost;
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    return rawUrl;
  }

  return rawUrl;
};

const resolveSupabaseUrl = (rawUrl: string) => {
  return rewriteToCurrentHost(rawUrl);
};

const DEFAULT_FETCH_TIMEOUT_MS = 15000;

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_FETCH_TIMEOUT_MS);

  const signal = (() => {
    if (!init?.signal) return timeoutController.signal;
    const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    if (typeof anySignal === 'function') {
      return anySignal([init.signal, timeoutController.signal]);
    }
    return init.signal;
  })();

  try {
    return await fetch(input, {
      ...init,
      signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const resilientFetch: typeof fetch = async (input, init) => {
  const requestInputUrl = () =>
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  try {
    return await fetchWithTimeout(input, init);
  } catch (err) {
    if (typeof window === 'undefined') throw err;

    const inputUrl = requestInputUrl();
    const rewritten = rewriteToCurrentHost(inputUrl);

    if (rewritten && rewritten !== inputUrl) {
      const nextInput = typeof input === 'string' || input instanceof URL ? rewritten : new Request(rewritten, input);
      return await fetchWithTimeout(nextInput, init);
    }

    const message = err instanceof Error ? err.message.toLowerCase() : '';
    const isTransientAbort = message.includes('aborted') || message.includes('failed to fetch');

    if (isTransientAbort) {
      return await fetchWithTimeout(input, init);
    }

    throw err;
  }
};

// ใช้ getEnv ดึงค่าแทนการเรียกตรงๆ
const supabaseUrl = resolveSupabaseUrl(getEnv('VITE_SUPABASE_URL'));
const supabaseKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_KEY');

if (!supabaseUrl || !supabaseKey) {
  throw new Error('⚠️ Missing Supabase URL or Key. Check your .env file or CI secrets.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: resilientFetch,
  },
});
