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
  if (!anonKey) throw new Error('Missing anon key for admin fixture sign-in');

  const auth = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let signIn = await auth.auth.signInWithPassword({ email, password });

  if (!signIn.data.user) {
    const listed = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw listed.error;

    const existing = listed.data.users.find((user) => user.email === email);
    const ensured = existing
      ? await service.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
        })
      : await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
    if (ensured.error) throw ensured.error;

    signIn = await auth.auth.signInWithPassword({ email, password });
  }

  if (signIn.error) throw signIn.error;
  const userId = signIn.data.user?.id || '';
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
