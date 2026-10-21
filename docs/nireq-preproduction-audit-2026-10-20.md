# NireQ — Pre-Production Readiness Audit

วันที่ 20 ตุลาคม 2026 (Asia/Bangkok) · Audit Only · checkout HEAD `27e85c0`

## 1. ผลตัดสินและขอบเขตหลักฐาน

**ยังไม่พร้อมรับรอง Pilot ตาม requirements นี้**: พบช่องว่าง authorization, MFA, multi-workspace และ Feedback; release gate ไม่ผ่านบนฐาน Local ปัจจุบัน และ frontend DEV ไม่ตรง checkout ที่ตรวจ ต้องปิดประเด็นเหล่านี้และยืนยัน release เดียวกันก่อนรับรอง

รายงานนี้เป็น deliverable ของรอบ Audit ไม่ใช่การอนุมัติ implementation หรือ deploy ไม่ได้แก้ application code, migration, permission หรือข้อมูล DEV/PROD ไม่ได้ commit/push/deploy มีเพียงรายงานและ generated test/build/browser artifacts; รัน SQL regressions บน Local ที่เอกสารระบุ Disposable เท่านั้น

หลักฐานแบ่งเป็นสามชั้น:

- **Source**: อ่าน routing, callers, migrations, Edge Functions, RLS/storage, tests, CI และ runbooks ใน checkout นี้ ไม่ถือว่ามีไฟล์แล้วแปลว่า deploy แล้ว
- **Local runtime**: lint/build ผ่าน; local release guard ยืนยัน `http://127.0.0.1:54321` และ credentials ตรง instance ตาม `docs/environment-checklist.md` ซึ่งระบุ Disposable; `npm run verify` ล้มที่ SQL จึงไม่ไปถึง browser release/race/API smoke stages
- **Remote read-only**: เปิดหน้า public DEV, วัด Lighthouse, ตรวจ public HTTP headers/assets DEV/PROD ไม่ login ด้วยบัญชีจริง ไม่เขียนข้อมูล ไม่ส่ง ticket/อีเมล และไม่ได้อ่าน remote database catalog หรือ provider settings

DEV landing/help ต่างจาก checkout และให้ asset `index-D8Idr9Op.js`; PROD ให้ `index-CkmEbPY8.js` ณ เวลาตรวจ ความต่างของ hash เพียงอย่างเดียวอาจเกิดจาก build environment แต่ความต่างของเนื้อหา/route ยืนยันว่าไม่ควรรวมผลเป็นเวอร์ชันเดียว ไม่ทราบ release SHA ของ DEV/PROD จึงให้ **Unable to Verify** สำหรับ deployed parity

มี local server อื่นครอง port 4173 อยู่ การตรวจ checkout ใช้ preview ที่เริ่มเองบน **4174** เท่านั้น ภาพชื่อ `local-home-*` ที่เก็บระหว่างสำรวจ 4173 ไม่ใช้เป็นหลักฐาน checkout; ใช้ `checkout-*` แทน

สถานะ: **Implemented** = มีและมีหลักฐานตรวจในขอบเขตที่ระบุ, **Partially Implemented** = มีแต่ยังไม่ครบ/มี defect, **Not Implemented** = ค้น frontend/backend/schema/tests ใน checkout แล้วไม่พบ implementation, **Needs Improvement** = มีแต่ควรปรับคุณภาพ, **Unable to Verify** = ยังขาด runtime/provider evidence สถานะ source ไม่ใช่การรับรอง production

Priority: P0 = ปิดก่อนเปิด Pilot เพราะอาจให้สิทธิ์เกิน/ส่งผลระบบที่ไม่น่าเชื่อถือ; P1 = จำเป็นตาม Pilot scope หรือเป็น release blocker; P2 = ปรับคุณภาพตาม baseline และผลกระทบ

## 2. Current System Audit / Gap Analysis

Evidence ด้านล่างเป็น path ภายใน repository พร้อมเลขบรรทัดเริ่มต้นเพื่อให้ตรวจซ้ำได้ ทุกแถวระบุ proposal เท่านั้น

| ID / Requirement | Current Status | Evidence | Gap / Issue | Priority / Risk | Proposed Solution | Impact | Verification |
|---|---|---|---|---|---|---|---|
| A1 Login password / Google / Magic Link | Partially Implemented | `src/pages/ManageLogin.tsx:154`, `:188`, `:209`; `src/tests/creator-google-auth.spec.ts` | มีทั้ง 3 วิธี; ยังไม่ได้ยืนยัน provider/callback/delivery บน release DEV เดียวกัน | P1 / High | รักษา flow เดิม ตรวจ provider และ callback ด้วยบัญชี synthetic DEV | Auth, recovery, invitation | login แต่ละวิธี, expired/reused link, external redirect rejection |
| A2 Session/protected routes | Partially Implemented | `src/App.tsx:109`, `:160`, `:218`; `src/supabaseClient.ts:157` | ใช้ SDK persistence/refresh และ auth listener; มี identity/request guards; ยังไม่ทดสอบหมดอายุระหว่าง POS/Queue จริง | P1 / High | เพิ่ม expiry/reconnect acceptance test โดยไม่ replay mutation อัตโนมัติ | ทุก private route, POS/cart | expire/refresh failure กลาง checkout, stale response, refresh/back navigation |
| A3 Logout ทุก role และ error | Partially Implemented | `src/components/AdminHeader.tsx:87`; `src/App.tsx:257`; `src/pages/AdminApplications.tsx:213`; `src/pages/AdminSupport.tsx:84` | มี signOut แต่ไม่ตรวจ returned error ก่อน redirect; AdminSupport header ไม่มี logout โดยตรง; ยังไม่มี reusable account menu ตาม requirement | P1 / Medium | รวม logout handler ที่ตรวจ error, clear user state และวางใน account menu ทุก role | Auth, navigation, operational state | network/signOut failure ต้องไม่แสดง success, all-role logout และ protected route denial |
| A4 Account switching/cache/realtime | Partially Implemented | `src/App.tsx:114`; `src/components/dashboard/QueuePanel.tsx:107`; `PosPanel.tsx:287`; `src/lib/observability.ts:135` | App clear actor/invites เมื่อ identity เปลี่ยน; channel มี cleanup; ยังไม่มี end-to-end proof A→B ทั้ง cart/context/subscription; observability pendingIdentity ไม่ถูกล้างก่อน SDK โหลดเสร็จ | P1 / High | ตรวจ/ล้าง user-scoped state และ pending telemetry identity กลาง handler; regression identity switch | POS, Queue, telemetry | A logout→B login, pending fetch/dynamic import, confirm no A permission/data/subscription |
| A5 Logout session scope | Needs Improvement | `AdminHeader.tsx:88`; installed `node_modules/@supabase/auth-js/src/GoTrueClient.ts` signOut default global | signOut ไม่กำหนด scope จึง revoke refresh sessions บนอุปกรณ์อื่นด้วย; requirement ยังไม่ระบุว่าต้องการ logout device นี้หรือทุก device | P2 / Medium | กำหนด product choice ให้ชัดก่อนเปลี่ยน; ไม่ถือว่า default นี้ผิดโดยอัตโนมัติ | พนักงานหลายเครื่อง | two-device logout ตาม scope ที่อนุมัติ |
| R1 Multi-role model / Owner ไม่หาย | Partially Implemented | `supabase/migrations/20260513163430_fix_actor_context_member_lookup.sql:25`; `20260513152615_staff_invite_magic_link_access.sql:297`; `supabase/tests/team_invitations_test.sql` | membership แยก artist และ upsert ไม่สร้าง Auth User ใน accept; owner context ถูก prioritize แต่ runtime regression ยังไม่ผ่านทั้งหมด | P1 / High | ใช้ model เดิม เพิ่ม tests owner ของ A + staff ของ B, revoke B ไม่กระทบ A | Role/membership | same-email multi-creator, no duplicate auth/member, scoped revoke |
| R2 Workspace switcher | Partially Implemented | `20260513163430_fix_actor_context_member_lookup.sql:34`; `src/App.tsx:99`; `docs/runbooks/four-shop-live-pilot.md:15` | DB มีหลาย membership แต่ RPC `limit 1` และ app มี actor เดียว ไม่มี selector; Owner ไปช่วยอีกร้านยังใช้งานไม่ครบ | P1 / High | list authorized workspaces + explicit active context โดย reuse model; validate selected context server-side | Routes, event selector, query/channel scope | Owner A→Seller B→Owner A, role labels, invalid/revoked context |
| R3 Context fallback consistency | Partially Implemented | `src/utils/access.ts:23`; `20260513163430_fix_actor_context_member_lookup.sql:44` | fallback เรียง updated_at แต่ canonical RPC เรียง role ก่อน จึงเลือกคนละร้านได้เมื่อ RPC ล้ม | P1 / High | ทำ selection contract ให้ตรงและ fail with retry เมื่อยืนยัน context ไม่ได้ | ทุก workspace query | RPC failure ต้องไม่สลับร้านเงียบ ๆ |
| R4 แก้ event assignment แบบ atomic | Partially Implemented | `src/pages/creators/ManageTeam.tsx:198`; `20260504041622_creator_role_model_v2.sql:222` | DELETE และ INSERT คนละ request; หลัง DELETE/หาก INSERT fail จะไม่มี assignment ซึ่ง `has_event_role` ตีความว่า unrestricted; UI ไม่ refresh เมื่อ fail | **P0 / High** | owner-only atomic RPC ตรวจทุก event แล้ว replace ใน transaction เดียว; เก็บ semantics all-events เดิมอย่าง explicit ไม่เปลี่ยน business rule เงียบ ๆ | Seller/Queue Staff event authorization | insert failure rollback, concurrent assignment edits, check restricted event denied ตลอด transaction |
| R5 Accept/cancel/decline invitation | Partially Implemented | `20260513152615_staff_invite_magic_link_access.sql:276`, `:329`, `:182`; `20260509220000_team_invitations.sql:323` | ตรวจ pending แบบไม่ lock แล้วให้ membership ก่อน update status; accept อาจชนะ cancellation/decline ที่ concurrent และให้สิทธิ์จาก snapshot เก่า | **P0 / High** | lock invitation row ในทุก transition และตรวจ pending/expiry/identity ใน transaction; conditional transition | Team permissions | two-connection accept vs cancel/decline, repeated accept, assert terminal state สอดคล้อง membership |
| R6 Login link vs invitation link | Partially Implemented | `20260513152615_staff_invite_magic_link_access.sql:270`; `src/pages/InvitationsPage.tsx:74`; `ManageLogin.tsx:120` | accept ตรวจ JWT email และ invite expiry แล้ว ไม่ใช่เปิดลิงก์ก็ได้สิทธิ์; wrong-account recovery ไม่มี email/switch action ชัดเจน | P1 / Medium | แสดง signed-in identity และ switch/logout ใน invitations page | Auth/invites | wrong email denied + recover, expired/cancelled/reused invite |
| R7 Role changeกับevent scope | Partially Implemented | `src/pages/creators/ManageTeam.tsx:373`; `20260504041622_creator_role_model_v2.sql:117`,`:222`; `20260513152615_staff_invite_magic_link_access.sql:69` | เปลี่ยนmanagerเป็นseller/queue_staffอัปเดตroleอย่างเดียว; managerไม่มีassignmentจึงกลายเป็นall-events ต่างจากinviteที่บังคับเลือกevent; ต้องยืนยันว่าตั้งใจให้all-eventsหรือไม่ | P1 / High | role+assignment updateatomic และแสดงscopeชัดเจน; ไม่เดาbusinessrule | Team/permissions | downgradeพร้อมeventselection, failure rollback, invalid event/crossshop denial |
| F1 Feedback 3 categories/form/ticket reference | Not Implemented (checkout) | ค้น `src`, `supabase/migrations`, `supabase/functions`, `supabase/tests`; `src/components/ui/Feedback.tsx` เป็น toast/dialog | ไม่มี ticket domain/page/API; `/admin/support` เป็น order/store troubleshooting ไม่ใช่ feedback inbox; DEV `/help` มี FAQ/email แต่ไม่ใช่ ticket flow | P1 / Medium | สร้าง thin support intake ตาม 3 ประเภท, validation + loading/success/error + reference | Public/help/account menu | guest/auth submit, retry/idempotency, reference, user sees own status |
| F2 Ticket status/admin notes/history/search | Not Implemented | `src/pages/AdminSupport.tsx:88`; `src/App.tsx:282` | ไม่มี `/admin/feedback`, ticket statuses, internal notes, status audit | P1 / High | ticket + append-only history + private internal notes, audited transition RPC, filter/pagination | Platform admin | owner-only ticket visibility; non-admin denial; internal note never visible to reporter |
| F3 Private screenshots/spam/sanitized context | Not Implemented | declared buckets ใน `20260215135600_ensure_storage_buckets.sql`, `20260606170725_preorder_payment_evidence.sql` | ไม่มี feedback private bucket, type/size rules, rate-limit intake, metadata allowlist | P1 / High | server validation + per-actor/guest rate limit; private object access, quotas/cleanup, sanitized URL/device/version/context | Storage/API/privacy | invalid/oversize files, forged path, guest spam, signed access, tokens/PII redaction |
| P1 Platform admin แยก Creator Owner | Implemented (predicate/model + local support tests) | `20260502045300_platform_admin_application_approval.sql:1`, `:25`; `supabase/tests/admin_support_test.sql`; `src/App.tsx:282` | มี platform_admins/is_platform_admin และ guarded support RPC; deployed membership/config ยังไม่ตรวจ | P1 / High | ใช้ของเดิมและ harden identity/MFA แทนสร้าง role ใหม่ | Cross-tenant support | owner/staff denied, platform admin allowed only with MFA |
| P2 MFA privileged access | Not Implemented (enforcement) | `20260502045300_platform_admin_application_approval.sql:34`; `supabase/config.toml:283` | เปิด TOTP capability แต่ไม่มี AAL2 check/enrollment/challenge; password-only admin ใช้ privileged RPC ได้ | **P0 / High** | enroll/challenge UI + server AAL2 guard ครอบคลุม RPC/Edge/direct policies, recovery flow | Admin login/support/moderation | AAL1 denied, AAL2 allowed, expired challenge, recovery/no lockout |
| P3 Bootstrap admin UID/lifecycle | Partially Implemented | `20260502045300_platform_admin_application_approval.sql:3`, `:9`, `:43` | email seed ฝัง source, UID nullable, delete user→set null ทำให้บัญชีใหม่ email เดิมรับสิทธิ์ได้ | P1 / High | one-time verified UID binding + revoke/lifecycle audit; append-only corrective migration | platform_admins | recreated email account denied, non-admin cannot self-enroll, revoke effective |
| P4 Creator moderation invariant | Partially Implemented | `20260502045300_platform_admin_application_approval.sql:63`, `:92` | direct UPDATE policy/grant bypass approve/reject RPC สร้าง status/reviewer ที่ไม่สัมพันธ์ workspace ได้ | P1 / High | ถอน direct mutation; guarded audited RPC เป็นช่องทางเปลี่ยนสถานะ | Creator applications/onboarding | direct update denied, RPC atomic, non-admin denied |
| P5 Creator email notification authorization | Partially Implemented | `supabase/functions/notify-creator-application/index.ts:14`, `:30`, `:43`; `docs/runbooks/production-release.md:108` | function รับ event จาก caller แล้ว service-role read/send โดยไม่มี JWT/actor/state check ใน handler; runbook deploy `--no-verify-jwt`; สามารถแจ้ง approved/rejected ที่ไม่ตรง DB ได้ ไม่ได้แปลว่าเปลี่ยน role จริง | **P0 / High** | derive event จาก DB และบังคับ actor/service authorization; privileged results require admin/AAL2; rate limit/idempotency | Mail/admin trust/provider cost | anonymous/non-admin/wrong-state denied; approved email only after real transition; no external send during tests |
| P6 Existing order/store troubleshooting/audit/resend | Implemented เฉพาะ local SQL support; UI parity Unable to Verify | `20260907234523_platform_admin_support.sql:14`; `20260908140754_admin_order_email_resend.sql`; `src/pages/AdminSupport.tsx:83`; SQL test ผ่าน | มี masked read, reason/audit, order history และ resend; ไม่ใช่ full console และ historical deploy claim ไม่ใช่หลักฐานปัจจุบัน | P1 / Medium | reuse components/RPC; verify deployed function/config on approved DEV | Support | read masking, reason/audit, resend concurrency/provider failure |
| P7 Store suspension | Implemented (local SQL) | `20260908161501_store_suspension.sql:19`; `supabase/tests/store_suspension_test.sql`; `src/components/AdminStoreSuspension.tsx` | central lock/triggers/audit มีและ SQL ผ่าน; ไม่เท่ากับ suspend Auth User | P1 / High | รักษา implementation; แยก account-level suspension requirement | Store/order/queue | pending orders remain readable, blocked new business, un/suspend reason/history |
| P8 Full console / users / moderation / audit browser | Partially Implemented | `src/App.tsx:282`; `src/pages/AdminApplications.tsx`; `src/pages/AdminSupport.tsx` | ไม่มี `/admin` overview/sidebar, total metrics, user/member inspection+account suspend, dedicated content moderation, queue operations browser, general audit viewer/pagination ตาม scope | P1 / Medium–High | สร้าง admin shell ร่วมกับหน้าเดิม; read-only modules ก่อน; explicit audited mutations เฉพาะที่อนุมัติ | Admin routes/data exposure | non-admin/AAL1 denial, real counts, empty/error, mobile tables, reason confirmation |
| Q1 Code splitting/bundle | Needs Improvement | `src/App.tsx` lazy imports; `vite.config.ts:61`; build output | มี lazy/chunks; main JS ~463.7 kB (gzip123.4), catalog223.2 kB, lazy HEIC1352.2 kB; PWA precache~3026 KiB; ยังไม่วัด initial transfer ของ checkout แยกทุก role | P2 / Medium | วัด waterfall/coverage ก่อนลด initial bundle และ precache/image cost; คง realtime/freshness | startup/PWA/uploads | same-page before/after, cold+warm, offline/realtime correctness |
| Q2 DEV performance | Needs Improvement | `output/playwright/readiness-2026-10-20/lighthouse-dev.report.json` | mobile simulated baseline Performance67, LCP4.8s; image delivery/cache opportunities; ไม่ใช่ผล checkout/PROD | P2 / Medium | optimize route/version ที่ยืนยันแล้ว; prioritize measured LCP/image issues | Public landing/catalog | same SHA/device/network/cache ≥3 runs, median และ repeat functional smoke |
| U1 Tokens/responsive/forms | Partially Implemented | `src/index.css:9`; `src/components/ui`; `PRODUCT.md`; screenshots `checkout-*`, `dev-*` | มี tokens/ui primitives/state; ตรวจภาพ Landing Desktop/Mobile และ login mobile แล้ว; private POS/Queue/product/campaign/team/admin ยังไม่ครบ real-role visual pass | P2 / Medium | polish เฉพาะ defect; reuse existing tokens; capture before/after ต่อหน้าที่เปลี่ยน | UI consistency | 390/1280 widths, keyboard, no overflow, modal/empty/error/disabled |
| U2 Discovery errors/name filtering | Partially Implemented | `src/pages/customer/DiscoveryHome.tsx:60`, `:141`, `:207` | fetch failure กลายเป็น empty list ไม่มี error/retry; regex test/demo/... อาจซ่อน creator จริง เช่นชื่อมี “test”; search ไม่มี accessible name (พบ textbox ไม่มีชื่อใน checkout snapshot); Mobile390มี page scrollWidth488 และ cardล้นขวา | P1 / Medium | แยก error จาก empty, explicit visibility data แทน name heuristic, add accessible label | Public discoverability | network failure show retry, valid names remain visible, axe/keyboard |
| U3 Mobile Landing overflow | Partially Implemented | `src/pages/customer/DiscoveryHome.tsx:327`; `checkout-home-mobile.png`; browser measured viewport390 / scrollWidth488 | featured cardล้นขวา ทำให้เลื่อนแนวนอน; confirmedกับcheckout4174 | P1 / Medium | ตรวจ grid/flex min-width และ card responsive sizing โดยคง layoutเดิม | Public mobile | 320/390/768, long names, no horizontal page overflow |
| S1 Public SEO metadata/indexability | Partially Implemented | `index.html:9`; `public/sitemap.xml`; `public/robots.txt`; `src/App.tsx`; `firebase.json` | title/canonical/OG เป็น global home; ไม่พบ route metadata/structured data/public creator/event/campaign sitemap; private routes ไม่มี explicit source noindex | P2 / Medium | route-aware public metadata/sitemap และ private noindex; ประเมิน crawler/social needs ก่อนเลือก prerender | SEO/public sharing | inspect raw HTML + rendered meta, exact canonical/OG; private noindex ไม่แทน auth |
| S2 DEV noindex | Implemented เฉพาะ observed deployment | DEV HTTP root/admin/robots/sitemap ส่ง `X-Robots-Tag: noindex`; PROD ไม่มี header นี้ที่ตรวจ | DEV SEO61 ส่วนหนึ่งเป็นผลที่ตั้งใจ; source firebase.json ยังไม่อธิบาย per-env header นี้ | P1 / Low | รักษา DEV noindex และทำ environment release assertion | Indexing | DEV always noindex; public PROD crawlable; private PROD noindex |
| S3 Accessibility enforcement | Needs Improvement | `src/tests/accessibility.spec.ts:58`, `:87`; Lighthouse DEV100; local public UX 2 tests passed | serious/critical/contrast checks บางส่วน log อย่างเดียวและไม่อยู่ local release suite; Lighthouse100 หน้าเดียวไม่รับรองทุก flow | P1 / Medium | fail on agreed violations; focused role/mobile/dialog tests; screen-reader/manual checks | CI/UI | axe assertions, labels/focus/trap, touch targets, semantic names |
| O1 Release environment/secret guards | Implemented ใน source/local guard | `scripts/validate-env.mjs:17`; `scripts/release-check.mjs:169`; `.gitignore`; hygiene passed | exact project refs/local loopback checks มี; remote provider isolation/config ยังไม่ตรวจ | P1 / High | คง guard; verify approved target + release SHA ก่อน cloud work | Release/security | mismatched refs/keys rejected, browser no privileged key |
| O2 CI/deploy gate/clean migrations | Partially Implemented | `.github/workflows/ci-pipeline.yml:63`; `scripts/release-check.mjs:248`; `package.json:30`; `src/tests/helpers/adminFixture.ts:17` | CI ไม่เรียก full verify และ fixture service key ไม่ครบใน workflow; deploy ไม่บังคับผล verify; local verify ทดสอบฐานเดิม ไม่ replay จากศูนย์ | P1 / High | ephemeral local DB migration replay + verify บน SHA, required CI; don't add remote service key as workaround | CI/release | clean run from zero, expected env/fixtures, no skipped critical stage |
| O3 Local schema/privilege drift | Unable to Verify release readiness; current gate FAIL | `output/playwright/readiness-2026-10-20/verify.log`; tests/migrations 20261003 | ขาด objects3, privilege assertions2 fail และ manager invitation denial1 fail; local มี extra RPC นอก checkout allowlist จึงห้ามสรุปว่า current source/PROD vulnerable จาก test count นี้ | **P0 / High release blocker** | แยก fresh disposable environment replay repo migrationsแล้วตรวจซ้ำ; ไม่ reset instance ที่แชร์โดยอัตโนมัติ | Validation confidence | clean replay + all SQL pass แล้ว race/browser/API stages |
| O4 Reliability/realtime/duplicate prevention | Partially Implemented | `src/supabaseClient.ts:85`; `src/components/ErrorBoundary.tsx`; `QueuePanel.tsx:107`; `src/tests/resilience.spec.ts`; `security-rls-regression.spec.ts:776` | มี timeout/no transient mutation retry, in-flight guards/channel cleanup; ยังไม่ยืนยัน reconnect/stale actions/session loss แบบหลายเครื่องบน release เดียวกัน | P1 / High | focused fault simulation และ explicit unknown-outcome recovery ตาม flow เดิม | Orders/stock/queue | abort after commit, no duplicates, reconnect refetch, accurate permissions/status |
| O5 Monitoring/health/alerts | Partially Implemented / provider Unable to Verify | `src/lib/observability.ts:58`; `src/components/ErrorBoundary.tsx:16`; `docs/runbooks/production-release.md:135` | optional LogRocket/redaction/release field มี; ไม่พบ enforced alert/SLO config และไม่ได้ตรวจ provider alert routing/health | P1 / High | validate active telemetry/PII protection, synthetic fault/alert test และ release attribution; ใช้บริการเดิม | Operations/privacy | masked tokens/body/URL hash, alert delivered to assigned owner, no stale identity |
| O6 Backup/restore/rollback | Partially Implemented / runtime Unable to Verify | `Document/RUNBOOK_BACKUP_ROLLBACK.md:29`; `docs/runbooks/production-release.md:153`; `docs/environment-checklist.md` | มี procedures แต่ไม่มี current restore drill evidence ครบ DB+Storage; environment checklist ยังใช้ hosting `createeq` ขัด config `nireqapp` | P1 / High | reconcile target docs; isolated restore drill with RPO/RTO/object retrieval; confirm provider backup policy | Incident recovery | restore rows + real Storage fetch + auth/order/queue smoke; frontend rollback exercise |
| T1 Business concurrency/regression | Partially Implemented | `supabase/tests/online_campaign_test.sql`; `stock_summary_lifecycle_test.sql`; `scripts/test-promotion-release.mjs:61`; `security-rls-regression.spec.ts:776`; `load-test.k6.ts:91` | SQL coreหลายชุดผ่านใน Local แต่ full gateหยุด; live POS test races same order/key ไม่ใช่สอง order แย่งชิ้นสุดท้าย; k6 เป็น reads; queue contention/preorder races/after-edit price snapshot ยังไม่มีตรง scenario | P1 / High | add bounded actual transaction races + post-order snapshot regression; retain existing suites | Money/stock/fairness | final-unit one winner, no orphan/double-release, unique queue numbers, edit promo doesn't reprice existing order |

## 3. สิ่งที่มีอยู่แล้วและไม่ควรสร้างซ้ำ

- Auth password, Google OAuth, OTP/Magic Link, recovery dialog และ session listener; ใช้ Supabase SDK เดิม
- Creator-scoped memberships, role helpers และ event assignment model; ไม่ต้องยกเครื่อง roles แต่ต้องแก้ atomicity/context selection
- Platform admin role แยกจาก owner, applications approval UI/RPC และ `/admin/support` สำหรับอ่านร้าน/ออเดอร์แบบ mask ข้อมูลพร้อม reason/audit
- Order history, controlled resend และ store suspension ที่ใช้ transaction lock/central triggers; ห้ามตีความว่าเป็น ticket inbox หรือ Auth User suspension
- Stock reservation/payment snapshot/promotion/campaign/preorder rules ตาม `PRODUCT.md`; ไม่เพิ่ม payment timer ให้ live POS หรือเปลี่ยน reservation เพื่อทำให้ test ผ่าน
- Existing tokens, buttons/cards/feedback primitives, lazy routes, PWA, ErrorBoundary, network timeout และ channel cleanup
- SQL regressions สำหรับ stock lifecycle/adjustment, promotion atomicity/mixed rewards/authorization, publication, notifications, campaign/preorder และ support/suspension; เพิ่มช่องที่ขาดแทนเขียนใหม่ทั้งหมด

## 4. Regression Test Results ที่รันจริง

| Check | Target | ผล |
|---|---|---|
| `npm run lint` | checkout | PASS (จาก initial standalone run และ verify lint stage) |
| `npm run build` | checkout | PASS TypeScript + Vite + PWA; standaloneและ verify build stage ผ่าน |
| `node scripts/release-check.mjs local guard` | local `127.0.0.1:54321` | PASS hygiene/env target/credential consistency/health |
| `npm run verify` | same local | **FAIL** ที่ `supabase test db --local`; TAP Files=20, Tests=384, 3 failed assertions ใน2ไฟล์ และ3ไฟล์ setup error; ไม่ใช่ 384 tests ผ่าน |
| Existing `production-readiness.spec.ts` | checkout build preview4174, Chromium | **2 passed**: public legal links และ password recovery focus trap/Escape/focus restore |
| Same public UX suite | DEV live, Chromium | **1 passed / 1 failed**: recovery passed; legal test คาดอีเมลเดิมแต่ liveใช้คนละอีเมล; จัดเป็น version/test expectation mismatch ยังไม่ตัดสินว่า legal flowเสีย |
| Browser screenshots | DEV home1280/390, help390, menu390; checkout home1280/390, login390 | เก็บ baseline; ไม่ใช่ full multi-role UAT หรือ visual regression pass |
| Lighthouse | DEV root, simulated mobile, 1 cold run | ดู section5; เป็น baselineเฉพาะ DEV |

Local SQL details:

- **15 SQL files completed successfully**: admin_support, creator_signup_idempotency, function_search_path_security, notification_delivery_security, online_campaign, preorder_pickup_mvp, promotion_atomic_save, promotion_mixed_rewards, promotion_rpc_authorization, promotion_sales_channel, publication_security, realtime_publication, stock_adjustment_flows, stock_summary_lifecycle, store_suspension
- **3 setup errors**: `event_appearances_test.sql` ไม่มี `public.event_appearances`; `product_csv_import_test.sql` ไม่มี `public.import_product_families(uuid,jsonb)`; `product_families_test.sql` ไม่มี `public.save_product_family(...)`
- **rpc_execute_privileges_test.sql**: expected intentional anon RPC23 แต่พบ22; expected extra security-definer anon RPC0 แต่พบ3; read-only inspectionพบ `queue_updates_delayed`, `reserve_image_upload`, `submit_order_problem` ซึ่งไม่ใช่ source contract ของ checkoutนี้ จึงเป็นหลักฐาน contamination/drift ไม่ใช่พิสูจน์ exploit
- Local migration historyสูงสุด `20260912044345` ขณะที่sourceมี20261003สามชุด; read-only inspectionยืนยันdefinition inviteในDBอนุญาตmanagerซึ่งต่างจากsource latest จึงระบุdriftได้ ไม่ใช่test expectation conflict
- **team_invitations_test.sql** test9: manager invitation ควรถูก denyแต่ไม่เกิด exception; latest repo migration `20260513152615_staff_invite_magic_link_access.sql:55` owner-only ไม่ตรง observed DB behavior
- หลัง SQL failure **race script, release browser suite และ API smoke ยังไม่ถูกรันโดย verify** ไม่รายงานว่า passed/skipped-on-success
- เตือน local Google client configuration ไม่ได้ตั้ง ไม่สามารถใช้ Local passรับรอง Google providerจริง

ไม่ได้แก้ failure เพราะผู้ใช้กำหนดรอบแรก Audit Only; ต้องสร้าง isolated clean validation target ใน phaseแรกก่อนระบุสาเหตุ deployment/migration mismatchอย่างสมบูรณ์

## 5. Performance Before / After

| Metric | Baselineเก่าที่ผู้ใช้ให้ | DEV observed 20 ต.ค. 2026 | After |
|---|---:|---:|---|
| Performance | 76 | 67 | ยังไม่มี implementation |
| Accessibility | 100 | 100 | ยังไม่มี |
| Best Practices | 100 | 100 | ยังไม่มี |
| SEO | 92 | 61 | ยังไม่มี |
| FCP | 4.0s | 4.0s | ยังไม่มี |
| LCP | 4.1s | 4.8s | ยังไม่มี |
| TBT | 0ms | 80ms | ยังไม่มี |
| CLS | 0 | 0 | ยังไม่มี |

Lighthouse13.5.0 default simulated mobile บน `/` เวลา `2026-10-20T13:12:55Z` (~20:12 Bangkok). เก่า/ใหม่ไม่ได้ควบคุม version, content, hardware และ networkเดียวกัน จึง **ไม่สรุปว่าโค้ดช้าลง** จากตัวเลขสองคอลัมน์นี้ DEV `noindex` เป็นข้อกำหนดถูกต้องและลดคะแนน SEO โดยตั้งใจ ห้ามถอดเพื่อเอาคะแนน

Lighthouse ระบุ image delivery savingsประมาณ482KiB, cache lifetimes536KiB, unused CSS34KiB และ JS28KiB เป็น candidatesต้องตรวจ requestจริง ไม่ใช่ปริมาณที่จะลดได้แน่นอน มี accessible-name/visible-label mismatch และ link-text issueที่ควรตรวจแม้ category100 ไม่ใช้คะแนนหน้าเดียวแทน manual accessibility

วัด checkout build บน preview4174แยกด้วย Lighthouse default mobileหนึ่งรอบ: **Performance83 / Accessibility98 / Best Practices100 / SEO100**, FCP2.4s, LCP3.8s, TBT100ms, CLS0. ใช้Localfixturesและloopback จึงไม่เปรียบเทียบตรงกับcloudDEVหรือเรียกว่าAfter. พบ heading-order fail (featured h3ก่อน section h2) และ label/visible-name issue; SEO100หน้าrootไม่พิสูจน์dynamic metadataทุกroute ดู `lighthouse-checkout.report.html/json`

Build checkout (local env) main JS463.66kB/gzip123.37kB; React/vendor162.47/gzip53.43; Supabase162.38/gzip41.49; lazy catalog223.18/gzip53.80; lazy HEIC1352.15/gzip344.72; CSS90.32/gzip15.71; PWA precache59 entries~3026KiB. Chunk sizeไม่ใช่ initial network cost และ precacheไม่เท่ากับ render-blocking transfer

หลังอนุมัติ optimization ให้วัด matched releaseอย่างน้อย3รอบรายงาน median cold/warm, public home/menu/campaign และ operational flow; ตรวจ realtime/stock/payment/account-switch correctnessทุกครั้ง ไม่มี After scoreในรอบนี้

## 6. Security Verification และข้อจำกัด

**มีหลักฐานผ่านจริงใน Local**: SQL authorizationสำหรับ support masking/audit, promotion RPC, publication, search_path, notification delivery, store suspension; hygiene scanไม่พบ tracked secretตาม patternปัจจุบัน ข้อนี้ไม่เท่ากับรับรองไม่มี secretทุก history/untracked/provider

**ยืนยัน static defect**: R4 split assignment replacement, R5 unlocked invitation transition, P2 no AAL2 enforcement, P3 email/nullable UID bootstrap, P4 direct application-update bypass และ P5 notification handlerไม่มี auth/state validation. ไม่ยิง exploitใส่ remote ไม่ส่งอีเมลทดสอบจริง

**ยังไม่ verified**: applied migrations/actual RLS/Storage policiesของ DEV/PROD, deployed Edge Functions/JWT gateway settings, production MFA enrollment, backup schedules/restore, operational alerts, provider access/audit, rate limits, current user permissions, complete cross-creator denialบน releaseเดียวกัน ต้องตรวจด้วย read-only provider accessหรือ controlled DEV fixtureที่อนุมัติเป้าหมายก่อน mutation

Observability มี header/query/body sanitization แต่ URL fragmentยังไม่ล้างใน `src/lib/observability.ts:37` และ pendingIdentity ไม่ล้างเมื่อ logoutก่อน SDKโหลด (`:111`,`:135`); ต้องทดสอบ synthetic tokenใน query+fragment และ account switchก่อนเปิด replayจริง ไม่ใช้ค่า tokenจริงใน artifacts

## 7. Prioritized Implementation Plan (รออนุมัติ)

| Phase / PR | Deliverable | Dependencies / Exit criteria |
|---|---|---|
| 0 — Reproducible release baseline | สร้าง **new disposable Local workspace** replay migrationsจากศูนย์, verifyบน checkout SHA, สรุป Local drift; map DEV/PROD SHA/configและ reconcile targetdocs | ไม่ reset Localที่มีผู้อื่นใช้; ไม่ remote migrate/deploy; ต้องผ่าน schema/privilege/invite regressionsก่อนใช้ผลรับรอง |
| 1 — Permission boundaries P0 | atomic assignment RPC, locked invite transitions, notification auth+state validation, platform-admin MFA server enforcement+challenge UI | focused SQL/concurrency/Edge auth/MFA tests; all roles/cross-creator negative tests; verifyผ่าน |
| 2 — Identity/session P1 | workspace listing+selectionบน modelเดิม, canonical/fallback ให้ตรงกัน, complete logout/account switch/wrong-account recovery | phase1; explicit context validated, A→B cart/cache/channel reset, stale-request tests, Desktop/Mobile flow |
| 3 — Admin console P1 | reusable `/admin` shell, existing applications/support integration, UID-bound admin, remove direct-update bypass; overview/users/creators/content/operations/audit modulesตาม scope | phase1 MFA; countsจริง; account suspendแยกจาก store; ต้องตกลง semantics session revocationและ visibilityของ hidden contentก่อน mutation feature |
| 4 — Feedback P1 | auth+guest intake3ประเภท, own tickets, private attachments/spam controls, admin inbox/status/internal notes/history | phase1/3; RLS+storage/rate-limit/XSS/idempotency tests; no sensitive auto-metadata |
| 5 — Release safety/reliability | CI ephemeral DB+verify gate, true concurrent live/POS/preorder/queue tests, snapshot-after-promo-edit, network/session/reconnect simulation, telemetry redaction/alert/restore drill | ผ่านทุก phaseที่อยู่ใน release; gatesบนexact SHA, synthetic fixturesเท่านั้น |
| 6 — Measured polish P2 + Pilot sign-off | targeted error/label/mobile fixes, metadata/indexing, measured performance before/after, role-based UATและPilot report | no business-flow redesign; all P0/P1ที่ตกลงต้องปิดหรือมี explicit scope exception; no production deployใน approvalนี้ |

แยก PRตามขอบเขต; ทุก code PR narrow check→`npm run verify`→fresh diff reviewหนึ่งรอบ; เมื่อแก้ findingจึง rerun affected checks ไม่มี commit/pushจนได้รับอนุมัติ ยกเว้น workflow deployที่ผู้ใช้อนุมัติอย่างชัดเจนภายหลัง

## 8. Database Migration Plan

ใช้ **append-only corrective migrations** เท่านั้น ไม่แก้ migrationเก่า

1. Atomic owner-only assignment replacement RPC + row lock/revision protection; validate member, creator, events และ allowed role; revoke unsafe direct writesเท่าที่จำเป็นหลังตรวจ sibling callers
2. Replace invitation transitionsให้ lock rowและ enforce terminal-state invariant; รักษา owner role/membership uniquenessตามscopeเดิม; review existing active invitesก่อนข้อมูลเปลี่ยน
3. Bind platform adminกับ verified UID, require privileged AAL2, revoke bypass UPDATE; audit admin lifecycleและmoderation; วาง bootstrap/recovery runbookโดยไม่เปิด self-enroll
4. Feedback tables: ticket(UUID/internal ID + public reference), reporter UID nullableสำหรับguest, category/status/subject/description/context allowlist, private attachment metadata; historyและinternal notesแยกจาก reporter-readable fields
5. RLS least privilege: reporter read own; guest submitผ่านserverมีrate limitและไม่ให้ list/read ticketคนอื่น; admin reads/transitions require MFA; private storage ownership/type/size/path checks; immutable audit
6. Overview/users/content APIs: bounded pagination/search, allowlisted fields, permission serverทุกครั้ง; account suspensionกับcontent visibilityต้องบังคับจุดที่criticalจริง ไม่ใช่ซ่อนปุ่ม

ก่อน apply: fresh Local migration replayและSQL tests; review grants/search_path/storage/backward compatibility; rehearse DEV migration/rollback strategyและbackup. **Remote migrationต้องมี explicit approval target/actionแยก** ไม่รวมใน Auditหรือimplementation approvalทั่วไป

## 9. UI/UX Design Plan

- ใช้ tokensเดิมจาก `src/index.css` และUI primitives; ไม่ redesign Landing/POS/Queueหรือสร้างnavigationซ้ำ
- Account menu Desktop/Mobile: identity + workspace/role, profile/settingsถ้ามี, “ช่วยเหลือและแจ้งปัญหา”, divider, logoutท้ายสุดพร้อม icon; loading/errorและprevent double click
- Workspace selectorแสดง Creator/Eventที่มีสิทธิ์และrole; เปลี่ยนcontextพร้อม clear/reload user-scoped state; denied/revoked contextกลับไปเลือกได้
- Admin shell sidebar desktop/collapsible mobile: Overview, Users, Creators, Events & Campaigns, Operations, Feedback, Audit Logs; reuse ApplicationsและSupportเดิม; server-backed tables/pagination/detail/reason confirmations
- Feedback mobile-first:3ประเภท, required subject/details, optional module/screenshot/guest contact; safe auto-context; ticket reference/successและown-history; public footer entry; contextual helpเฉพาะ POS/Queueที่จำเป็น ไม่ใช้floating buttonทุกหน้า
- ทุกหน้าใหม่: loading/empty/error/success/permission denied; actionable labels, keyboard/focus/dialog semantics, no horizontal page overflow
- Captureก่อน/หลังทั้ง1280และ390อย่างน้อย; เพิ่ม tablet/iOSสำหรับcritical forms; ตรวจ POS/Queue/product/campaign/team/adminด้วยroleจริงในisolated fixture ไม่ใช้ mock dashboard production

## 10. Test Strategy / Real-world Simulation

1. Clean schema+grantsจากmigration zero; database transaction testsสำคัญกว่าผล controlled/mock RPC UI
2. Role matrix: anonymous/customer, owner, manager, seller, queue_staff, platform_admin AAL1/AAL2; same shop/cross shop, restricted/unrestricted event, revoked membership
3. Invitation: same-email owner A+staff B, wrong-email, expiry/replay, simultaneous accept/cancel/decline; assignment update failureไม่ขยายสิทธิ์
4. Auth: password/Google/Magic Link, refresh/expiry, logouterror, local/global scopeที่เลือก, browserback, A→Bพร้อมpending requests/realtime/replayinit
5. Commerce: create product/family/variant/import, allocate/close/holdrelease, POS checkout, queue call/serve, campaign shipping/pickup, order history; price snapshotไม่เปลี่ยนหลังpromotionedit
6. Concurrency: creator1+seller1+queue_staff1+หลายลูกค้า, same event simultaneous queuejoin, distinct ordersแย่งfinalstock, repeat completion/idempotency, network abortหลังcommit; no oversell/orphan/doublepayment
7. Feedback: anonymous rate limit, authown-ticket, forgedcreator/path, filetype/size/XSS, private attachment URL, internalnote isolation, status audit, duplicate submit
8. Admin: non-admin/AAL1 denialทุกRPC/Edge/policy, verifiedUIDbootstrap/revoke, moderationatomicity, suspendedaccount semantics, storeblockไม่ทำลาย existingorders, reason/audit immutable
9. Accessibility/visual: enforce axe+manual focus/keyboard/touch targets; desktop/mobile/tablet; screenshotbefore/afterบนexactbuild
10. Operations: provider delivery/retryในDEV synthetic, health/alert redaction, isolated DB+Storage restoreและrollback; capture releaseSHA/results/owner

## 11. Pilot Readiness Checklist

| Gate | วันนี้ |
|---|---|
| Exact code + schema + Edge versionsที่ทดสอบตรง DEV release | **Blocked / Unable to Verify** |
| P0 permission/MFA/notification issuesปิดและnegative testsผ่าน | **Blocked** |
| Full `npm run verify` บนclean disposable environment | **Blocked: current Local FAIL** |
| Owner A staff Bหลายworkspace + logout/session/account switch | **Incomplete** |
| Feedback support requirementsและadminmodulesที่อนุมัติ | **Incomplete** |
| Money/stock/queue regression + realconcurrency/faultsimulation | **Partial** |
| UI/SEO/accessibility fullrole/mobile checks | **Partial** |
| Measured matched before/afterperformance | **Baseline only** |
| Monitoringalert + verifiedbackup/restore/rollback | **Unable to Verify** |
| PilotUAT withsyntheticdataและassignedoperationsowner | **Not run in this audit** |

การอนุมัติที่เสนอ: เริ่ม **Phase0–1** ก่อน (clean validationและP0 security fixes) จากนั้นreviewผลและconfirmรายละเอียดproductที่มีผลต่อpermissions/guestspam/accountsuspensionก่อนPhase2–4 โดยไม่เพิ่มBusinessFeaturesอื่น ไม่deployProduction

## 12. Evidence artifacts

- Full local verification log: [verify.log](../output/playwright/readiness-2026-10-20/verify.log)
- Checkout Lighthouse: [HTML](../output/playwright/readiness-2026-10-20/lighthouse-checkout.report.html), [JSON](../output/playwright/readiness-2026-10-20/lighthouse-checkout.report.json)
- DEV Lighthouse: [HTML](../output/playwright/readiness-2026-10-20/lighthouse-dev.report.html), [JSON](../output/playwright/readiness-2026-10-20/lighthouse-dev.report.json)
- Checkout screenshots: [home desktop](../output/playwright/readiness-2026-10-20/checkout-home-desktop.png), [home mobile](../output/playwright/readiness-2026-10-20/checkout-home-mobile.png), [login mobile](../output/playwright/readiness-2026-10-20/checkout-login-mobile.png)
- DEV screenshots: [home desktop](../output/playwright/readiness-2026-10-20/dev-home-desktop.png), [home mobile](../output/playwright/readiness-2026-10-20/dev-home-mobile.png), [help mobile](../output/playwright/readiness-2026-10-20/dev-help-mobile.png), [menu mobile](../output/playwright/readiness-2026-10-20/dev-menu-mobile.png)

Generated artifactsอยู่ในignored outputจึงไม่ถูกcommitโดยอัตโนมัติ รายงานไม่รวมtokens/keys/customerprivateข้อมูล; ไม่มีAfter screenshotเพราะยังไม่มีUIimplementation
