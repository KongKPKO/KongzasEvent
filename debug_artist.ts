
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkArtist() {
  console.log('Fetching artist test1...');
  const { data, error } = await supabase
    .from('artists')
    .select('id, slug, name, display_name, bio, is_active, x_url, ig_url, facebook_url, tiktok_url, email')
    .eq('slug', 'test1')
    .single();

  if (error) {
    console.error('Supabase Error:', error);
  } else {
    console.log('Artist Data:', data);
  }
}

checkArtist();
