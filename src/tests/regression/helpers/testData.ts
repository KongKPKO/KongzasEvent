
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION ---
export const TEST_CONFIG = {
  ADMIN_EMAIL: process.env.TEST_EMAIL || 'local-test-user@example.com',
  ADMIN_PASSWORD: process.env.TEST_PASSWORD || 'LocalOnlyTestPassword123!',
  ARTIST_SLUG: process.env.TEST_SLUG || 'testy',
  SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_KEY: process.env.TEST_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || ''
};

export const supabase = createClient(TEST_CONFIG.SUPABASE_URL, TEST_CONFIG.SUPABASE_KEY);

export async function seedTestData(userId: string) {
  const timestamp = Date.now();
  const eventName = `Regression Fest ${timestamp}`;
  const productName = `RegItem-${timestamp}`;
  
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); 
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1. Cleanup old data
  try {
      await supabase.from('tickets').delete().eq('artist_id', userId);
      await supabase.from('queues').delete().eq('artist_id', userId);
      await supabase.from('events').delete().eq('artist_id', userId);
      await supabase.from('products').delete().eq('artist_id', userId).ilike('name', 'RegItem%');
  } catch (e) {
      console.log('⚠️ Cleanup warning:', e);
  }

  // 2. Open Queue
  await supabase.from('artists').update({ is_queue_open: true }).eq('id', userId);

  // 3. Create Event
  await supabase.from('events').insert({
      artist_id: userId,
      event_name: eventName,
      start_date: oneHourAgo.toISOString(),
      end_date: tomorrow.toISOString(),
      status: 'Confirmed',
      is_booth_open: true
  });

  // 4. Create Product
  await supabase.from('products').insert({
      artist_id: userId,
      name: productName,
      price: 150,
      status: 'enable',
      category: 'Regression',
      image_url: 'https://placehold.co/100x100',
      currency: 'THB'
  });


  return { eventName, productName };
}
