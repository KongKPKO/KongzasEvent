import { createClient } from '@supabase/supabase-js';

// ฟังก์ชันดึงค่า Config แบบ Hybrid (รองรับทั้ง Vite และ Node.js/Playwright)
const getEnv = (key: string) => {
  // 1. ลองดึงจาก Vite (Browser)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[key];
  }
  // 2. ถ้าไม่มี ให้ลองดึงจาก Node.js (Playwright/Server)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return '';
};

// ใช้ getEnv ดึงค่าแทนการเรียกตรงๆ
const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseKey = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('VITE_SUPABASE_KEY');

if (!supabaseUrl || !supabaseKey) {
  throw new Error('⚠️ Missing Supabase URL or Key. Check your .env file or CI secrets.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);