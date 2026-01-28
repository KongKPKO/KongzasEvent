import http from 'k6/http';
import { check, sleep } from 'k6';

// รับค่าจาก Pipeline (GitHub Secrets) เท่านั้น
const SUPABASE_KEY = __ENV.SUPABASE_KEY;
const SUPABASE_URL = __ENV.SUPABASE_URL;
// เพิ่มความยืดหยุ่น: รับชื่อ Slug จาก Env ได้ (ถ้าไม่มีใช้ค่า Default 'test1')
const ARTIST_SLUG = __ENV.ARTIST_SLUG || 'test1';

export const options = {
  // ✅ Soak Test: จำลองคนใช้งานต่อเนื่อง
  stages: [
    { duration: '30s', target: 50 },   // ช่วงเช้า: คนทยอยมา
    { duration: '1m', target: 100 },   // ช่วงพีค: คนรุม 100 คน (ลดเวลาลงหน่อยจะได้ไม่เปลือง Action minutes)
    { duration: '30s', target: 50 },   // ช่วงบ่าย: คนเริ่มซา
    { duration: '10s', target: 0 },    // จบการทำงาน
  ],
  
  thresholds: {
    // Database ต้องตอบเร็วกว่า 500ms (ที่ P95)
    http_req_duration: ['p(95)<500'], 
    // ห้าม Error เกิน 1%
    http_req_failed: ['rate<0.01'],    
  },
};

export default function () {
  // ตรวจสอบว่ามีค่า Env หรือไม่ (กันลืมใส่ใน Pipeline)
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY environment variables');
    return;
  }

  // จำลองการดึงข้อมูล Artist (User Journey แรกสุดที่ลูกค้าทุกคนต้องทำ)
  const endpoint = `${SUPABASE_URL}/rest/v1/artists?select=*&slug=eq.${ARTIST_SLUG}`;

  const params = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  };

  const res = http.get(endpoint, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    // เช็คว่าได้ข้อมูลกลับมาจริง (Array ไม่ว่างเปล่า) ชัวร์กว่าเช็ค Text
    'data found': (r) => {
        try {
            const json = r.json();
            return Array.isArray(json) && json.length > 0;
        } catch (e) {
            return false;
        }
    },
  });

  // พักหายใจ 1 วินาที (Pacing)
  sleep(1);
}