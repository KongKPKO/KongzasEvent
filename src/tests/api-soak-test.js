import http from 'k6/http';
import { check, sleep } from 'k6';

// ⚠️ ใส่ Anon Key (ey...) ที่ได้จาก npx supabase status -o json
const SUPABASE_KEY = __ENV.SUPABASE_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg'; 
const SUPABASE_URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321';

export const options = {
  // ✅ Soak Test: จำลองคนใช้งานต่อเนื่อง (ไม่เยอะมาก แต่นานหน่อย)
  stages: [
    { duration: '30s', target: 50 },   // ช่วงเช้า: คนทยอยมา 50 คน
    { duration: '2m', target: 100 },   // ช่วงเที่ยง: คนพีคๆ ประมาณ 100 คน
    { duration: '30s', target: 50 },   // ช่วงบ่าย: คนเริ่มซา
    { duration: '10s', target: 0 },    // ร้านปิด
  ],
  
  thresholds: {
    // Database ควรตอบสนองเร็วเสมอ (เพราะคนไม่ได้เยอะเวอร์)
    http_req_duration: ['p(95)<500'], 
    // ห้าม Error เลยแม้แต่ครั้งเดียว (เพราะโหลดแค่นี้ DB ห้ามล่ม)
    http_req_failed: ['rate<0.01'],    
  },
};

export default function () {
  // จำลองการดึงข้อมูล
  const endpoint = `${SUPABASE_URL}/rest/v1/artists?select=*&slug=eq.test1`;

  // ถ้าใช้ Anon Key (ey...) ให้ใช้ header นี้
  const params = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  };

  /* // ⚠️ ถ้าใช้ Key แบบ sb_publishable (Reference Key) ให้ใช้ header นี้แทน
  const params = {
    headers: {
      'apikey': SUPABASE_KEY,
      // 'Authorization': ... (ลบ Authorization ทิ้ง)
      'Content-Type': 'application/json',
    },
  }; 
  */

  const res = http.get(endpoint, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'data received': (r) => r.body && r.body.includes('test1'), 
  });

  // พักหายใจ 1 วินาที (จำลองคนจริงๆ)
  sleep(1);
}