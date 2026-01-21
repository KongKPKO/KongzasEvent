import { createClient } from '@supabase/supabase-js';

// Retrieve credentials from environment variables
// Make sure to create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials missing! Please check your .env file.");
}

const isValidUrl = (url: string) => {
  try { return Boolean(new URL(url)); } catch (e) { return false; }
};

const finalUrl = isValidUrl(supabaseUrl || '') ? supabaseUrl! : 'https://placeholder.supabase.co';
const finalKey = supabaseKey || 'placeholder';

export const supabase = createClient(finalUrl, finalKey);
