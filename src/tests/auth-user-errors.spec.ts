import { test, expect } from '@playwright/test';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';
import { getAuthUserSafe } from '../utils/auth';

const originalGetUser = supabase.auth.getUser;
const originalSignOut = supabase.auth.signOut;
test.afterEach(() => {
  supabase.auth.getUser = originalGetUser;
  supabase.auth.signOut = originalSignOut;
});

test('missing or rejected sessions are reported as signed out', async () => {
  let localSignOuts = 0;
  supabase.auth.signOut = async (options) => {
    expect(options?.scope).toBe('local');
    localSignOuts++;
    return { error: null };
  };
  for (const error of [new AuthSessionMissingError(), new AuthApiError('Invalid token', 401, 'bad_jwt')]) {
    supabase.auth.getUser = async () => ({ data: { user: null }, error });
    expect(await getAuthUserSafe()).toBeNull();
  }
  expect(localSignOuts).toBe(1);
});

test('temporary Auth failures propagate instead of pretending the session is missing', async () => {
  const error = new AuthApiError('Gateway timeout', 504, 'unexpected_failure');
  supabase.auth.getUser = async () => ({ data: { user: null }, error });
  await expect(getAuthUserSafe()).rejects.toBe(error);
});

test('Auth request timeout does not report a signed-out user', async () => {
  supabase.auth.getUser = () => new Promise(() => {});
  await expect(getAuthUserSafe()).rejects.toThrow('Request timed out');
});
