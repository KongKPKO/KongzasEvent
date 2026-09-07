# NireQ — focused architecture audit และข้อเสนอ Inventory

วันที่: 7 กันยายน 2026 · baseline: `5039f51`

## ข้อสรุป

**ยังไม่ควรรื้อ Inventory/SKU ใหม่ และยังไม่ควรถือว่า Promotion พร้อม PROD** ควรแก้ความปลอดภัยและการแก้โปรระหว่างใช้งานก่อน โครงสินค้ากลาง + การจัดสรรตามช่องทางมีอยู่แล้วและใช้ต่อได้

นี่เป็น focused audit จาก source/schema/tests และตรวจยืนยันเฉพาะจุดในฐานข้อมูล local ไม่ใช่ penetration test หรือการรับรองทุกเส้นทางทั้งระบบ ยังไม่ได้ตรวจ DEV/PROD runtime หรือทดสอบ UI ทุกหน้า

## Findings เรียงตามความสำคัญ

### P1 — การตรวจสิทธิ์ Promotion RPC ถูกข้ามได้

หลักฐาน: `supabase/migrations/20260905100000_authoritative_promotion_pricing.sql:874` ใช้ `current_user not in ('postgres','service_role')` ภายใน SECURITY DEFINER ขณะที่ function owner ใน local คือ postgres จึงไม่ใช่การตรวจผู้เรียกจริง

ยืนยันใน local: สร้าง fixture ภายใน transaction, `SET LOCAL ROLE authenticated`, `auth.uid()` เป็น NULL แล้วเรียก `promotion_assignment_conflicts` ของ fixture ได้ผล `{"conflicts":[],"has_conflict":false}` แทน forbidden จากนั้น ROLLBACK ข้อมูลทั้งหมด ไม่ได้แก้ข้อมูล remote

ผลกระทบ: ผู้เรียกที่ไม่มีสิทธิ์ร้านแต่รู้ assignment ID ผ่าน guard ได้ และอาจอ่านรายละเอียดโปรที่ชนกัน ส่วน calculator มี pattern เดียวกันที่บรรทัด 350 ทำให้ guard ตรวจการเผยแพร่/เวลาอาจถูกข้ามผ่าน public quote ต้องเพิ่ม regression โดยตรง ไม่ได้พิสูจน์ว่าจ่ายเงินหรือแก้สต็อกข้ามร้านได้

แนวแก้: ตรวจ identity/artist membership ของ caller อย่างชัดเจน แยก public quote visibility จาก manager access อย่าใช้ function-owner identity เป็น service bypass ทดสอบ anon, owner, manager, seller และผู้ใช้คนละร้าน

### P1 — แก้โปรแล้วเวลาสามารถเลื่อน 7 ชั่วโมง

หลักฐาน: `src/components/promotions/PromotionManager.tsx:130` ในฟังก์ชัน edit ใช้ `toISOString().slice(0,16)` ใส่ datetime-local และฟังก์ชัน toIso แปลงกลับโดยตีความเป็นเวลาท้องถิ่น

ตัวอย่าง: บันทึกไว้ 13:00 ไทย = 06:00Z → เปิดแก้แสดง 06:00 → บันทึกใหม่เป็น 23:00Z วันก่อน เท่ากับ 06:00 ไทย แค่แก้ชื่อก็เปลี่ยนเวลาที่โปรมีผลได้

แนวแก้: ใช้ตัวแปลง UTC → local field ที่ถูกต้องและ reuse ทั้ง start/end พร้อม round-trip test ใน Asia/Bangkok

### P1 — ขั้นตอนตรวจโปรชนกันเปลี่ยนข้อมูลจริงก่อนผู้ใช้ยืนยัน

หลักฐาน: ฟังก์ชัน save ใน `src/components/promotions/PromotionManager.tsx` เรียก `savePromotionDefinition(buildPayload(true))` ก่อนตรวจ conflicts แล้วค่อยเรียกอีกครั้งด้วย false ส่วน `supabase/migrations/20260906100000_promotion_management.sql` พัก assignments เดิมก่อนบันทึกชุดใหม่

ผลกระทบ: แก้โปรที่ใช้อยู่แล้วกดยกเลิก confirmation หรือ request ถัดไปล้มเหลว โปรเดิมถูกเปลี่ยน/พักแล้ว ไม่ใช่ยกเลิกการแก้ไข และมีช่วงที่ลูกค้า checkout โดยโปรหายได้

แนวแก้: preview จาก draft แบบไม่เขียนข้อมูล แล้ว commit การแก้ไขและเปิดใช้ครั้งเดียวใน transaction พร้อม recheck conflicts/revision ฝั่ง server ถ้าข้อมูลเปลี่ยนระหว่าง preview ให้ร้านยืนยันใหม่ ออเดอร์ที่สร้างแล้วเก็บ snapshot เดิม

### P1 — ของแถมเลือกคละไม่ได้ และอาจรายงานว่าหมดทั้งที่รวมกันพอ

หลักฐาน: `supabase/migrations/20260905100000_authoritative_promotion_pricing.sql:146` คัดแต่ตัวเลือกที่แต่ละ SKU มีสต็อก >= สิทธิ์ทั้งหมด; บรรทัด 584 ส่ง v_earned เข้าเงื่อนไขนี้ ฝั่ง storefront/menu/POS ใช้ Array(earned_quantity).fill(...) เพื่อเลือกของชนิดเดียวให้ทุกสิทธิ์

ตัวอย่าง: ลูกค้าได้ 2 ชิ้น ของแถม A เหลือ 1 และ B เหลือ 1 ระบบคัดออกทั้งคู่ ทั้งที่เลือก A1+B1 ได้

แนวแก้: fixed gift ตรวจจำนวนทั้งหมดของ SKU เดียว ส่วน choice gift ให้เลือกจำนวนแต่ละ SKU รวมเท่าสิทธิ์และไม่เกินสต็อก ตรวจซ้ำและ hold แบบ atomic ร่วมกับของซื้อ รวมกรณีซื้อและแถม SKU เดียวกัน

### P2 — ตัวเลขสต็อกยังมีความหมายไม่ตรงกับสิ่งที่ร้านคาดหวัง

หลักฐาน: `supabase/migrations/20260903062618_include_campaigns_in_stock_summary.sql:49` ส่ง on_hand = stock_total แต่ available หัก stock_sold, stock_reserved และ allocation อีกที

ดังนั้นอย่าอธิบาย on_hand ว่า «ของที่ยังไม่ขายและอยู่กับตัว» โดยอัตโนมัติ ยอดที่ขายแล้วหรือจองอาจเป็นส่วนต่างของสมการ ปัญหานี้เป็น semantics ที่ยืนยันจาก query ไม่ใช่ข้อสรุปว่าระบบ oversell แล้ว

แนวแก้: ทำ glossary และตัวอย่าง sold/held ก่อนปรับ UI/API ตรวจว่าค่าการขายระดับ channel ถูกสะท้อนสต็อกกลางอย่างไร แล้วแสดง bucket ที่ไม่ซ้อนกัน ห้ามบวก campaign reserved ซ้ำใน allocated

## Inventory architecture ที่เสนอ — ใช้ของเดิมก่อน

| ส่วน | แนวทาง |
|---|---|
| Product | สินค้าที่ขาย/นับสต็อกได้หนึ่งรายการ ใช้ UUID เป็น identity |
| Variant group | กลุ่มสำหรับแสดง Normal/SP; variant แต่ละตัวมี product ID และ SKU ของตัวเอง ไม่ใช่ stock pool รวม |
| SKU | รหัสอ่านง่ายและแก้เองได้ unique ภายในร้าน ไม่ต้องเติมชื่อร้านเพื่อแก้ปัญหาฐานข้อมูล |
| Allocation | ใช้ event_products / online_campaign_products เดิม แยกสต็อกแต่ละช่องทาง |
| Order | เก็บราคา โปร และของแถมเป็น snapshot ณ checkout; UI ไม่คำนวณยอดสุดท้ายเอง |
| Hold | Online/Pre/Post จองของซื้อ+แถมพร้อมกัน 15 นาที; live day ไม่เพิ่ม timer นี้ |
| Refund | แยกคืนเงินกับรับของกลับเข้าสต็อก ไม่ restock เพียงเพราะคืนเงิน |
| Adjustment history | ตรวจ/reuse audit mechanism เดิมก่อนเพิ่ม บันทึกผู้ทำ เหตุผล จำนวน และ reference ใน transaction เดียวกับการเปลี่ยนยอด |

SKU generator มี advisory lock ระดับร้านและฐานข้อมูลมี unique index แล้ว ไม่ควรเขียน generator ใหม่เพื่อเปลี่ยนรูปแบบเพียงอย่างเดียว การเดาจากชื่อเป็น heuristic ไม่ใช่การรู้ว่าตัวละครคืออะไร: ชื่อภาษาไทย/ชื่อกำกวมต้องมี fallback และให้ร้านแก้ได้ ใช้ UUID อ้างอิงออเดอร์ ไม่ใช้การ parse SKU

**โมเดลที่ต้องทำให้ชัดก่อนเพิ่ม field:** stock ownership กับ fulfillment เป็นคนละเรื่อง ของที่ชำระแล้วแต่ยังอยู่ในกล่องร้านไม่ใช่ของพร้อมขาย แต่ยังอาจอยู่กับร้านทางกายภาพ ไม่ควรบังคับให้ตัวเลขเดียวตอบสองคำถาม

หน้า Catalog ควรตอบ «พร้อมจัดสรรได้อีกเท่าไร และที่เหลืออยู่ที่ไหน» ส่วนหน้า Campaign ตอบ «พร้อมขาย/รอชำระ/ขายแล้วในแคมเปญนี้เท่าไร» ใช้รายละเอียดขยายจากตัวเลข ไม่ยัดทุก bucket เป็นคอลัมน์หลัก

## ลำดับ implementation ที่แนะนำ

1. **Security patch:** ปิด caller guard bypass และ regression ข้ามร้าน/public visibility ก่อน ปิดด้วย SQL/security tests
2. **Promotion correctness:** atomic preview/save, เวลา, mixed gifts และกรณีสต็อกแย่งกัน ปิดด้วย UI + SQL integration tests
3. **Inventory semantics:** ทำ fixtures รับเข้า 30 → จัดสรร 20 → hold 2 → จ่าย 1 → expire 1 → คืนเงิน/คืนของ ตรวจตัวเลขทุกหน้าจากแหล่งเดียว
4. **Documentation:** อัปเดต PRODUCT.md ให้ครอบคลุม Campaign และ Promotion ปัจจุบัน; AGENTS.md อ้าง canonical business rules แทนคัดทั้ง spec ลงไป
5. **เฉพาะเมื่อจำเป็น:** เพิ่ม movement history ที่ขาด ไม่ทำ event sourcing, generic Sales Channel framework หรือ Inventory V2 ทั้งชุดโดยไม่มี use case ที่ของเดิมรองรับไม่ได้

## Acceptance tests ที่ควรเพิ่ม

- สมาชิกคนละร้านเรียก conflicts ไม่ได้; anon quote campaign ที่ไม่เผยแพร่ไม่ได้
- เปิดแก้แล้วบันทึก start/end เดิม เวลาไม่เปลี่ยนทั้ง TH/EN
- ยกเลิก preview/เครือข่ายขาด โปรเดิมยังทำงาน; commit ใหม่มีผลกับ checkout ใหม่เท่านั้น
- ได้ของแถม 2 สิทธิ์เลือก A1+B1; หมดจริงทุกตัวแสดงข้อความ+ยอดใหม่ให้ยืนยัน
- ซื้อและแถม SKU เดียวกันรวมสต็อกถูกต้อง; concurrent checkout ไม่เกิน stock
- ออเดอร์ hold เดิมคงราคา/โปรแม้ร้านแก้ไข และ expire คืนทั้งของซื้อ/แถมครั้งเดียว
- ปิดช่องทางขายไม่ทำให้ออเดอร์เดิมหาย; ตรวจ outstanding holds ก่อนทำให้ allocation พร้อมใช้ซ้ำ

## ขอบเขตการตรวจและข้อจำกัด

- อ่าน source ที่เกี่ยวกับ promo manager, pricing/RPC, reward selection, SKU, stock summary/adjustment และ tests ที่เกี่ยวข้อง
- ยืนยัน function owner และ caller bypass ในฐานข้อมูล local ด้วย transaction rollback
- ยังไม่ได้รัน full security suite, npm run verify หรือ E2E ทั้งระบบใน audit นี้ จึงไม่อ้างว่าผ่าน
- ยังไม่ได้ประเมิน performance ด้วย production-size data, ตรวจทุก RLS policy, queue/service tags ทุกบทบาท หรือ email delivery จริง เป็นงานตรวจรอบถัดไป ไม่ใช่สิ่งที่รับรองแล้ว
- ไม่มีการแก้ application code, deploy หรือ remote migration รายงานนี้เป็น artifact เดียวที่เพิ่ม; รักษาไฟล์ที่ผู้ใช้แก้ค้างไว้

**Verdict:** แก้ P1 ก่อนขยาย feature; ใช้ Inventory เดิมต่อพร้อมแก้ semantics และ regression ไม่จำเป็นต้องเริ่มโครงการ rewrite ตอนนี้
