import { supabase } from '../supabaseClient';
import type { ActorContext } from '../types/access';
import { getAuthUserSafe } from './auth';

const withTimeout = async <T,>(promise: PromiseLike<T>, ms = 12000): Promise<T> => {
  const wrapped = Promise.resolve(promise);
  return await Promise.race([
    wrapped,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), ms);
    }),
  ]);
};

const fetchLegacyOwnerContext = async (): Promise<ActorContext | null> => {
  const user = await getAuthUserSafe();
  if (!user) return null;

  const userId = user.id;
  const email = user.email?.toLowerCase() || null;
  let artistId: string | null = null;

  if (email) {
    const { data: memberContext, error: memberError } = await withTimeout(
      supabase
        .from('artist_members')
        .select('artist_id, role, member_email')
        .eq('status', 'active')
        .ilike('member_email', email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      8000
    );
    if (memberError) throw memberError;

    if (memberContext?.artist_id && memberContext.role) {
      return {
        artist_id: memberContext.artist_id,
        role: memberContext.role as ActorContext['role'],
        is_owner: memberContext.role === 'owner',
        member_email: memberContext.member_email || email,
      };
    }
  }

  const { data: ownedArtist, error: ownedArtistError } = await withTimeout(
    supabase
      .from('artists')
      .select('id')
      .eq('id', userId)
      .maybeSingle(),
    8000
  );
  if (ownedArtistError) throw ownedArtistError;
  artistId = ownedArtist?.id || null;

  if (!artistId && email) {
    const { data: emailArtist, error: emailArtistError } = await withTimeout(
      supabase
        .from('artists')
        .select('id')
        .ilike('email', email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      8000
    );
    if (emailArtistError) throw emailArtistError;
    artistId = emailArtist?.id || null;
  }

  if (!artistId) return null;

  return {
    artist_id: artistId,
    role: 'owner',
    is_owner: true,
    member_email: email,
  };
};

type CreatorSignupCompletionStatus = 'created' | 'exists' | 'not_pending' | 'email_unconfirmed' | 'error';

export const completePendingVerifiedCreatorSignup = async (): Promise<CreatorSignupCompletionStatus> => {
  try {
    const { data, error } = await withTimeout(supabase.rpc('complete_verified_creator_signup'), 8000);
    if (error) {
      console.error('[Access] complete_verified_creator_signup failed:', error);
      return 'error';
    }

    const status = typeof data === 'object' && data && 'status' in data
      ? String((data as { status?: unknown }).status)
      : 'not_pending';

    if (status === 'created' || status === 'exists' || status === 'not_pending' || status === 'email_unconfirmed') {
      return status;
    }

    return 'error';
  } catch (error) {
    console.error('[Access] complete_verified_creator_signup request failed:', error);
    return 'error';
  }
};

export const fetchActorContext = async (): Promise<ActorContext | null> => {
  let first: ActorContext | undefined;
  try {
    const { data, error } = await withTimeout(supabase.rpc('get_actor_context'));
    if (error) {
      console.error('[Access] get_actor_context failed:', error);
    } else {
      first = Array.isArray(data) ? data[0] : data;
    }
  } catch (error) {
    console.error('[Access] get_actor_context request failed:', error);
  }

  // Keep the fallback outside the RPC catch: its failure must reach the UI
  // once instead of triggering a second account check.
  if (!first?.artist_id || !first?.role) return await fetchLegacyOwnerContext();
  return {
    artist_id: first.artist_id,
    role: first.role,
    is_owner: !!first.is_owner,
    member_email: first.member_email || null,
  };
};
