import { supabase } from '../supabaseClient';
import type { User } from '@supabase/supabase-js';

const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 12000): Promise<T> => {
  const wrapped = Promise.resolve(promise);
  return await Promise.race([
    wrapped,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), ms);
    }),
  ]);
};

export const getAuthUserSafe = async (): Promise<User | null> => {
  try {
    const { data, error } = await withTimeout(supabase.auth.getUser());
    if (error) {
      console.error('[Auth] getUser failed:', error);
      return null;
    }
    return data.user ?? null;
  } catch (error) {
    console.error('[Auth] getUser request failed:', error);
    return null;
  }
};
