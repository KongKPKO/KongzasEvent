import http from 'k6/http';
import { check, sleep } from 'k6';

// ⚠️ ใส่ Key จาก .env (VITE_SUPABASE_KEY)
const SUPABASE_KEY = __ENV.SUPABASE_KEY || 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImI4MTI2OWYxLTIxZDgtNGYyZS1iNzE5LWMyMjQwYTg0MGQ5MCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjIwODQ2Mzc2ODN9.USpdkBGt_bp9ywixWVdIwdiW4rk7xuNljYkjwBki4rx5_4sM4fbots6paIFQDiuU40eEC2slYEvUqLi4LFyPwg'; 
const SUPABASE_URL = __ENV.SUPABASE_URL || 'http://127.0.0.1:54321'; // Port 54321 คือ API Gateway

export const options = {
  // รันแค่ 1 รอบก่อน เพื่อดู Error (พอแก้ผ่านแล้วค่อยลบ บรรทัดนี้ทิ้ง)
    iterations: 1, 

//   // โหมด Stress Test จริง (ค่อยเปิดใช้ตอนเทสผ่านแล้ว)
//   stages: [
//     { duration: '10s', target: 100 },
//     { duration: '30s', target: 500 },
//     { duration: '1m', target: 1000 },
//     { duration: '10s', target: 0 },
//   ],
//   thresholds: {
//     http_req_duration: ['p(95)<2000'],
//     http_req_failed: ['rate<0.01'],
//   },

// };

export default function () {
  // 1. ประกาศตัวแปร endpoint ก่อนเรียกใช้เสมอ
  const endpoint = `${SUPABASE_URL}/rest/v1/artists?select=*&slug=eq.test1`;

  const params = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  };

  // 2. ยิง Request
  const res = http.get(endpoint, params);

  // 3. 🔍 Debug: ถ้าพัง ให้พ่น Error ออกมาดู
  if (res.status !== 200) {
    console.error(`❌ Status: ${res.status}`);
    console.error(`❌ Error Body: ${res.body}`);
  } else {
    console.log(`✅ Success! Body sample: ${res.body.substring(0, 50)}...`);
  }

  // 4. Check ผลลัพธ์
  check(res, {
    'status is 200': (r) => r.status === 200,
    'data received': (r) => r.body && r.body.includes('test1'), 
  });

  sleep(1);
}