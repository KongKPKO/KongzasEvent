// Load Test for 10 Queue
// import http from 'k6/http';
// import { check, sleep } from 'k6';

// export const options = {
//   vus: 10, // เริ่มเบาๆ ที่ 10 คน
//   duration: '10s',
// };

// export default function () {
//   // ✅ ใช้ IP และ Port ที่เราเทส Curl ผ่านเมื่อกี้
//   const url = 'http://127.0.0.1:5173/test1/queue'; 
  
//   const res = http.get(url);

//   check(res, {
//     'status is 200': (r) => r.status === 200, // เช็คว่าเข้าเว็บได้
//     'react loaded': (r) => r.body.includes('id="root"'), // ✅ เช็คว่าเจอ div ของ React
//   });

//   sleep(1);
// }

// Load test for 100 Queue
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // จำลองเหตุการณ์จริง: ค่อยๆ มีคนเดินมาเข้าคิวเพิ่มขึ้นเรื่อยๆ
  stages: [
    { duration: '30s', target: 20 },  // ช่วง 30 วิแรก: คนทยอยมาจนถึง 20 คน
    { duration: '1m', target: 50 },   // ช่วง 1 นาทีต่อมา: คนรุมเข้ามาเป็น 50 คน (Peak)
    { duration: '30s', target: 0 },   // ช่วง 30 วิสุดท้าย: คนเริ่มทยอยออก (Cool down)
  ],
  // ถ้า API ช้าเกิน 2 วินาที ให้ถือว่าสอบตก (Fail)
  thresholds: {
    http_req_duration: ['p(95)<2000'], 
  },
};

export default function () {
  // ✅ ใช้ URL ที่ผ่านชัวร์เมื่อกี้
  const url = 'http://127.0.0.1:5173/test1/queue'; 
  
  const res = http.get(url);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'react loaded': (r) => r.body.includes('id="root"'),
  });

  // สุ่มเวลาพักนิดหน่อย (0.5 - 1.5 วินาที) ให้เหมือนคนจริงๆ ไม่ใช่หุ่นยนต์รัวปุ่ม
  sleep(Math.random() * 1 + 0.5); 
}
