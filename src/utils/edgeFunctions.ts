import { supabase, supabaseAnonKey } from '../supabaseClient';

export const invokeNotificationFunction = async (
  name: 'notify-creator-application' | 'notify-team-invitation',
  body: Record<string, unknown>
) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || supabaseAnonKey;

  return supabase.functions.invoke(name, {
    body,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });
};
