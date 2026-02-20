import { supabase } from '../supabaseClient';
import type { ActorContext } from '../types/access';

const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 12000): Promise<T> => {
  const wrapped = Promise.resolve(promise);
  return await Promise.race([
    wrapped,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), ms);
    }),
  ]);
};

export const fetchActorContext = async (): Promise<ActorContext | null> => {
  try {
    const { data, error } = await withTimeout(supabase.rpc('get_actor_context'));
    if (error) {
      console.error('[Access] get_actor_context failed:', error);
      return null;
    }

    if (!data) return null;

    const first = Array.isArray(data) ? data[0] : data;
    if (!first?.artist_id || !first?.role) return null;

    return {
      artist_id: first.artist_id,
      role: first.role,
      is_owner: !!first.is_owner,
      member_email: first.member_email || null,
    };
  } catch (error) {
    console.error('[Access] get_actor_context request failed:', error);
    return null;
  }
};
