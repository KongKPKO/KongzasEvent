import { supabase, supabaseAnonKey } from '../supabaseClient';

export const invokeNotificationFunction = (
  name: 'notify-creator-application' | 'notify-team-invitation',
  body: Record<string, unknown>
) =>
  supabase.functions.invoke(name, {
    body,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });
