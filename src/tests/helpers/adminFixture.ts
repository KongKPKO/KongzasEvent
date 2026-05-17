import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseTestEnv } from './localSupabaseEnv';

type OwnerArtistFixtureInput = {
  email: string;
  password: string;
  slug: string;
  displayName: string;
};

export const ensureOwnerArtistFixture = async ({
  email,
  password,
  slug,
  displayName,
}: OwnerArtistFixtureInput) => {
  const { url, anonKey, serviceKey } = resolveSupabaseTestEnv();
  if (!serviceKey) throw new Error('Missing service role key for admin fixture seeding');

  const auth = createClient(url, anonKey);
  const service = createClient(url, serviceKey);

  const signUp = await auth.auth.signUp({ email, password });
  let userId = signUp.data.user?.id || '';

  if (!userId) {
    const signIn = await auth.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    userId = signIn.data.user?.id || '';
  }

  if (!userId) throw new Error(`Could not ensure admin fixture user ${email}`);

  const { error } = await service.from('artists').upsert({
    id: userId,
    email,
    slug,
    display_name: displayName,
    is_queue_open: true,
    is_public: true,
    is_verified: true,
    published_at: new Date().toISOString(),
  });
  if (error) throw error;

  return { userId, service };
};
