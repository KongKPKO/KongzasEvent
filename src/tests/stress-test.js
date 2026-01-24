import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // จำลองคน 1,000 คน เข้ามาดูหลายๆ ร้านพร้อมกัน
  stages: [
    { duration: '30s', target: 200 },  // ช่วงแรกคนทยอยเข้า
    { duration: '1m', target: 1000 },  // ช่วง Peak พุ่งไป 1,000 คน
    { duration: '30s', target: 0 },    // คนทยอยกลับ
  ],
  thresholds: {
    // เนื่องจากโหลดเยอะขึ้น เราอาจยอมรับที่ 2 วินาที (95%)
    http_req_duration: ['p(95)<2000'],
    // ห้าม Error เกิน 1%
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // 🎲 รายชื่อร้านค้าที่เราเตรียมไว้ (แก้ตามที่มีจริง)
  const slugs = ['test1', 'test2', 'test3', 'test4', 'test5'];
  
  // สุ่มเลือกร้านค้า 1 ร้าน สำหรับ User คนนี้
  const randomSlug = slugs[Math.floor(Math.random() * slugs.length)];
  
  // สร้าง URL
  const url = `http://127.0.0.1:5173/${randomSlug}/queue`; 

  const res = http.get(url);

  check(res, {
    'status is 200': (r) => r.status === 200,
    // เช็คว่าโหลด React ติด (ถ้าอยากเช็คชื่อร้านด้วยต้องแก้เงื่อนไขเพิ่ม)
    'react loaded': (r) => r.body.includes('id="root"'),
  });

  // สุ่มเวลาดูหน้าจอ (Think Time) ระหว่าง 1-3 วินาที
  sleep(Math.random() * 2 + 1);
}