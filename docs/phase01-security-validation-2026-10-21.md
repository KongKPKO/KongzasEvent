# Phase 0–1 — Security boundaries and isolated validation

วันที่ 21 ตุลาคม 2026 (Asia/Bangkok) · ทดสอบ working tree บน base HEAD `27e85c0` พร้อมการเปลี่ยนแปลงรอบนี้ (ยังไม่ commit) · ต่อจาก [Pre-production audit](nireq-preproduction-audit-2026-10-20.md)

## ขอบเขตที่ทำ

เปลี่ยนเฉพาะ Phase 0–1 ที่ผู้ใช้อนุมัติ ไม่เพิ่ม Feedback/Admin Console module หรือ business feature ของ Phase ถัดไป ไม่ commit/push/deploy และไม่ apply remote migration

### Phase 0: ฐานทดสอบที่สร้างซ้ำได้

- เพิ่ม `scripts/prepare-isolated-validation.mjs` และ [runbook](runbooks/phase01-local-validation.md) สำหรับสร้าง workspace ใหม่ใน `output/` โดยปฏิเสธ directory ที่มีอยู่แล้ว
- ใช้ project `NireqPhase01Validation`, API `127.0.0.1:59321`, DB59322 และ Mailpit59324 แยกจาก Local เดิม ไม่หยุด/reset/แก้ฐานเดิม
- Replay **103 migrations** จากศูนย์ ตรวจ SHA-256 ของไฟล์ที่ replay ตรงกับ source ทุกไฟล์ ไม่มี historical seed หรือข้อมูลบัญชีจริง; ใช้ synthetic fixtures ของ tests เท่านั้น
- ปิด Google OAuth และ session replay เฉพาะรอบทดสอบ Local ไม่ใช้ remote SMTP/provider key
- พบ CLI 2.98.2 เลือก Postgres `17.6.1.106` ซึ่ง crash เมื่อทดสอบ denied EXECUTE ตรงกับ [Supabase issue2112](https://github.com/supabase/postgres/issues/2112); ยืนยันด้วย minimal reproduction ในฐานใหม่นี้ แล้วสร้างฐานใหม่ด้วย image `17.6.1.063` ที่ repository ใช้อยู่ การทดสอบ negative permission จึงทำงานตามปกติโดยไม่เพิ่มสิทธิ์หรือเปลี่ยน assertions
- แก้ environment checklist ให้ Hosting target เป็น `nireqapp` ตรง `.firebaserc`/scripts

อ่าน Firebase channel metadata, ตรวจ source environment validator และดึงเฉพาะ Supabase hostname จาก JavaScript assets ที่ deploy จริงทั้ง DEV/PROD แล้ว โดยไม่เก็บหรือแสดง API keys:

| Target | Supabase host ที่ config validator ยืนยัน | Hosting version | Release time (Bangkok) |
|---|---|---|---|
| DEV | `kdjqitvtxmcrnnpuxuyl.supabase.co` | `347fd9bc41f892c5` | 20 ต.ค. 2026 06:11:12 |
| PROD | `fnutmjnzugpayccscvgr.supabase.co` | `f1de79c91f14b863` | 20 ต.ค. 2026 06:16:30 |

Release labels มีเพียง deployment tool ไม่มี Git SHA จึง **ยังยืนยัน deployed SHA / applied remote migrations / Edge version parity ไม่ได้** ตารางนี้ยืนยัน frontend environment mapping และ Hosting version ที่อ่านได้ ไม่ใช่การรับรอง remote database schema/permissions หรือการ deploy โค้ดชุดนี้ ดู [sanitized release map](../output/playwright/phase01/hosting-release-map.json) และ [public environment map](../output/playwright/phase01/deployed-public-environment-map.json)

### Phase 1: ปิด permission boundaries P0

| จุดเดิม | สิ่งที่เปลี่ยน | หลักฐานทดสอบ |
|---|---|---|
| แก้ assignment ด้วย DELETE/INSERT คนละ request | `replace_event_member_assignments` เป็น owner-only transaction, lock member, validate role/events และ rollback ทั้งชุดเมื่อ insert ล้มเหลว; ถอน direct client write grant แล้วเปลี่ยน ManageTeam caller | SQL invalid/cross-shop/duplicate/null/forced-insert-failure; สอง connection แก้พร้อมกัน; browser success/error/reload |
| Accept/Cancel/Decline อ่าน pending แบบไม่ lock | ทั้งสาม transition lock invitation row และ update เฉพาะ pending; ตรวจ identity/expiry หลังรอ lock; transition ที่แพ้ไม่สร้าง membership | SQL terminal-state/replay; สาม connection แข่ง Accept/Cancel/Decline สามรอบ ยืนยันมีผู้ชนะหนึ่งและสถานะตรงกับ membership |
| Notification สมัคร Creator เชื่อ event จาก caller | ตรวจ verified user + `is_platform_admin()` หรือ trusted backend credentialก่อนอ่านใบสมัคร; derive event จากสถานะ DB และ reject mismatch; จำกัด method/UUID และส่ง provider idempotency key | Local Edge tests: anonymous/non-admin/AAL1 denied, AAL2 allowed, forged decision409, service event derived from DB |
| Admin ใช้ password-only session เข้าถึงข้อมูลข้ามร้าน | `is_platform_admin()` ต้องเป็น AAL2; เพิ่ม self-discovery boolean `is_platform_admin_account()` สำหรับเข้า enrollment ซึ่งไม่ให้สิทธิ์ข้อมูล; gate ครอบทั้งสอง Admin routes พร้อม setup/challenge/error/retry | SQL AAL1/missing-claim/non-admin/bound-UID; browser QR enrollment, invalid code, later-login challenge, direct RPC/Edge denial, failed check/retry |

Semantics เดิมที่รักษาไว้: assignment ว่างแบบ explicit owner action หมายถึง all events; ไม่เปลี่ยนให้ deny all โดยเงียบ ๆ ส่วน null/missing event list ไม่ใช้เป็น implicit clear; membership/role model, money, stock และ queue business rules ยังใช้ของเดิม

Notification caller ใน frontend ปัจจุบันคือหน้า AdminApplications หลัง decision; signup self-serve ไม่ได้เรียก function นี้จาก frontend การแจ้ง submitted/auto_approved ผ่าน function นี้จึงสงวนให้ Admin ที่ผ่าน MFA หรือ backend ที่มี credential ที่เชื่อถือได้ ไม่เปิดให้เพียงรู้ application UUID แล้วส่งได้

## Validation

- TypeScript / lint และ narrow SQL/browser checks ผ่านระหว่างพัฒนา
- SQL: **22 ไฟล์ / 480 assertions ผ่าน** บนฐานใหม่ที่ replay จาก tracked migrations
- Team concurrency: invitation transitions และ assignment replacement **ผ่าน** พร้อมตรวจ membership/final assignment
- Narrow browser: MFA + notification + support + suspension ผ่านหลังปรับ regression ให้เข้าหน้า MFA ใหม่; Team UI test ผ่าน
- Preparation script self-check: safe path, refuses overwrite/outside-output, seed excluded, runtime pin, source test links ผ่าน
- `SUPABASE_WORKDIR="$PWD/output/phase01-local" VITE_LOGROCKET_DISABLED=true npm run verify`: **PASS** ครบ lint/build → SQL22ไฟล์/480assertions → team concurrency → campaign race5รอบ → browser89tests → API smoke ทุกข้อ
- API smoke ผ่าน Auth health, REST, canonical/malformed notification UUID checks, Storage bucket list และ upload
- ตรวจ diff รวมด้วย fresh context และ `git diff --check` ผ่าน ไม่มีการแก้เพิ่มหลัง full gate ที่ทำให้ต้องรันทดสอบซ้ำ
- ผลรวมนี้ใช้ Local Chromium; MFA challenge เพิ่ม Mobile390px และตรวจภาพจริง ไม่ใช่การรับรองทุก browser/device หรือ cloud provider

ผลและภาพประกอบ:

- [Full verification log](../output/playwright/phase01/verify.log)
- [Team concurrency log](../output/playwright/phase01/team-concurrency.log)
- [MFA challenge mobile — ไม่มี setup secret](../output/playwright/phase01/admin-mfa-challenge-mobile.png)
- [Admin หลังผ่าน MFA](../output/playwright/phase01/admin-mfa-verified-desktop-chromium.png)

Test ที่แตะ MFA ปิด automatic trace/video/screenshot เพราะ response enrollment มี setup secret; ภาพที่เก็บเองเป็น challenge แบบไม่มี secret และหน้า Admin หลังยืนยันแล้ว มีทั้ง Desktop และ Mobile

## ไฟล์ migration และ rollout ภายหลัง

- `supabase/migrations/20261020132548_phase1_team_permission_boundaries.sql`
- `supabase/migrations/20261020132618_phase1_platform_admin_mfa.sql`

เป็น migration ใหม่ ไม่แก้ migration history เดิม เมื่อได้รับอนุมัติ deploy สำหรับเป้าหมายที่ชัดเจนภายหลัง ต้อง apply migration และ deploy Edge/frontend ที่เข้าคู่กัน Old frontend ที่ยังเขียน assignment โดยตรงจะถูกปฏิเสธอย่างปลอดภัยหลัง revoke grant จึงควรวาง rollout และบังคับ reload client ให้เหมาะสม New frontend ต้องมี RPC ใหม่ก่อนใช้งาน ส่วน Admin ที่ยังไม่ตั้งค่า MFA จะต้อง enroll ก่อนเข้าถึง privileged data/actions

Recovery เมื่อสูญเสีย Authenticator ใช้ trusted Auth administration หลังตรวจตัวบุคคลและยืนยัน environment/user ตาม runbook ไม่มี browser bypass หรือ client-side service key

หลังตรวจเสร็จ หยุดเฉพาะ `NireqPhase01Validation` และ Edge process ที่เริ่มในงานนี้แล้ว โดยเก็บ disposable volumes และ evidence ไว้ เปิดซ้ำตาม runbook ได้ ฐาน Local อื่นไม่ได้ถูกหยุดหรือเปลี่ยนข้อมูล

## ข้อจำกัดที่ยังอยู่ตาม Phase ถัดไป

- UID-bound bootstrap/lifecycle และ direct application-update bypass ของ Admin AAL2 ยังเป็น Phase 3; MFA ไม่ใช่การรับรองว่า Admin Console ทั้งหมดพร้อม Pilot
- Multi-workspace/logout/session polish, role-downgrade scope decision, Feedback intake และ full Admin modules ยังไม่อยู่ในรอบนี้
- ยังไม่ได้ตรวจ MFA/provider/redirect settings, real email delivery, migration/Edge parity หรือ backup/alerts บน DEV/PROD
- การอ่าน Hosting metadata ยังไม่สามารถผูก version กับ Git SHA; ต้องเพิ่ม provenance สำหรับ release ที่จะ deployจริงภายหลัง
- ไม่อ้างว่า real Google OAuth, cross-browser ทั้งหมด หรือ Pilot UAT บน cloud ผ่านจาก Local suite นี้
