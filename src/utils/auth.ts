import { supabase } from '../supabaseClient';
import { isAuthSessionMissingError, type User } from '@supabase/supabase-js';

const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 12000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const getAuthUserSafe = async (): Promise<User | null> => {
  const { data, error } = await withTimeout(supabase.auth.getUser());
  if (error) {
    if (isAuthSessionMissingError(error)) return null;
    if (error.status === 401 || error.status === 403) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      return null;
    }
    // A failed request does not prove that the session is missing. Let callers
    // show a retryable load error instead of redirecting a signed-in user.
    throw error;
  }
  return data.user ?? null;
};
