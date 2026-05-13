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

const fetchLegacyOwnerContext = async (): Promise<ActorContext | null> => {
  const { data: userData, error: userError } = await withTimeout(supabase.auth.getUser(), 8000);
  if (userError || !userData.user) return null;

  const userId = userData.user.id;
  const email = userData.user.email?.toLowerCase() || null;
  let artistId: string | null = null;

  if (email) {
    const { data: memberContext } = await withTimeout(
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

    if (memberContext?.artist_id && memberContext.role) {
      return {
        artist_id: memberContext.artist_id,
        role: memberContext.role as ActorContext['role'],
        is_owner: memberContext.role === 'owner',
        member_email: memberContext.member_email || email,
      };
    }
  }

  const { data: ownedArtist } = await withTimeout(
    supabase
      .from('artists')
      .select('id')
      .eq('id', userId)
      .maybeSingle(),
    8000
  );
  artistId = ownedArtist?.id || null;

  if (!artistId && email) {
    const { data: emailArtist } = await withTimeout(
      supabase
        .from('artists')
        .select('id')
        .ilike('email', email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      8000
    );
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

export const fetchActorContext = async (): Promise<ActorContext | null> => {
  try {
    const { data, error } = await withTimeout(supabase.rpc('get_actor_context'));
    if (error) {
      console.error('[Access] get_actor_context failed:', error);
      return await fetchLegacyOwnerContext();
    }

    if (!data) return await fetchLegacyOwnerContext();

    const first = Array.isArray(data) ? data[0] : data;
    if (!first?.artist_id || !first?.role) return await fetchLegacyOwnerContext();

    return {
      artist_id: first.artist_id,
      role: first.role,
      is_owner: !!first.is_owner,
      member_email: first.member_email || null,
    };
  } catch (error) {
    console.error('[Access] get_actor_context request failed:', error);
    return await fetchLegacyOwnerContext();
  }
};
