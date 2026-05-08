# Local Server Runbook (After Mac Restart)

ใช้คู่มือนี้เมื่อรีสตาร์ตเครื่องแล้วต้องเปิดระบบ local เพื่อทดสอบใหม่

## 1) เตรียมระบบ

1. เปิด Docker Desktop ก่อน
2. เปิด Terminal

## 2) เริ่ม Supabase Local + Apply Migrations

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
npm ci
supabase start
supabase db push --local
```

## 3) ตั้งค่า Frontend ให้ชี้ Local Supabase

สร้าง/อัปเดตไฟล์ `.env.local` ด้วยค่า local:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
ANON_KEY=$(supabase status -o env | awk -F= '/^ANON_KEY=/{gsub(/"/,"",$2); print $2}')
cat > .env.local <<EOF
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
VITE_SUPABASE_KEY=${ANON_KEY}
EOF
```

## 4) เริ่ม Web App (Vite)

เปิด Terminal อีกหน้าต่างแล้วรัน:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
npm run dev -- --host 0.0.0.0 --port 5173
```

## 5) ลิงก์ที่ต้องใช้

- Web app: [http://127.0.0.1:5173/manage-login](http://127.0.0.1:5173/manage-login)
- Supabase Studio (local): [http://127.0.0.1:54323](http://127.0.0.1:54323)
- Mailpit (local): [http://127.0.0.1:54324](http://127.0.0.1:54324)

## 6) เทสบนมือถือในวงแลนเดียวกัน

หา IP เครื่อง Mac:

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

แล้วเปิด:

```text
http://<YOUR_MAC_IP>:5173
```

## 7) โหมด Docker Test App (ทางเลือก)

Terminal #1:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase start
```

Terminal #2:

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
npm run docker:test:up
```

เข้าใช้งานที่:

- [http://127.0.0.1:5173](http://127.0.0.1:5173)

## 8) เช็คสถานะระบบเร็วๆ

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase status
npm run test:api:smoke
```

## 9) ปิดระบบ

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
npm run docker:test:down
supabase stop
```

## 10) Troubleshooting สั้นๆ

### หน้าเว็บขาว / Login failed to fetch

1. เช็คว่า `supabase start` รันอยู่
2. เช็คว่า `.env.local` ชี้ `http://127.0.0.1:54321`
3. รีสตาร์ต dev server (`npm run dev` ใหม่)
4. Hard refresh browser

### `supabase status -o env` แล้วขึ้น no such container

```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase stop
supabase start
supabase status
```

### เพิ่มสมาชิกแล้วค้าง / role เปลี่ยนไม่ได้

1. รัน migrations ใหม่
```bash
cd /Users/kongzas/Desktop/Kong/EventQueueSocial/KongzasEvent
supabase db push --local
```
2. Refresh หน้า Team

