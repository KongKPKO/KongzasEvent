import { supabase } from '../supabaseClient';

// Existing records can contain the former image proxy URL. Resolve its origin
// without fetching through the proxy or rewriting stored customer data.
export const resolveStoredImageUrl = (value: string): string => {
  const legacyPrefix = 'https://ik.imagekit.io/kongzas/';
  if (!value.startsWith(legacyPrefix)) return value;
  const path = value.slice(legacyPrefix.length).split(/[?#]/)[0].replace(/^tr:[^/]+\//, '');
  const separator = path.indexOf('/');
  if (separator < 1) return '';
  const bucket = path.slice(0, separator);
  if (bucket !== 'Menu' && bucket !== 'Avatar') return '';
  return supabase.storage.from(bucket).getPublicUrl(path.slice(separator + 1)).data.publicUrl;
};

export const getMenuImageUrl = (value: string): string => {
  if (!value) return '';
  if (/^https?:\/\//.test(value)) return resolveStoredImageUrl(value);
  return supabase.storage.from('Menu').getPublicUrl(value.replace(/^\/+/, '')).data.publicUrl;
};
