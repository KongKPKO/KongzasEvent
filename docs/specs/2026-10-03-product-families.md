# Product families, presentation and event appearances

## Scope and decisions

- One parent product owns name, description, category, tags, base price, currency and presentation metadata. One dimension of variants (character/design/color); no option combinations.
- Existing `products` rows become child inventory records via `parent_product_id`. Their UUIDs, SKUs, order references, channel allocation, promotions and sold/reserved counters remain intact. A simple product has one child.
- `price_override = null` inherits the parent's base price; zero is a valid explicit override. Effective price remains materialized on children for existing checkout RPCs. Channel price overrides continue to take precedence.
- An atomic owner/manager RPC saves the parent and children. Existing finite-stock corrections use the stock adjustment functions and cannot consume sold/held/allocated stock. Removing a variant archives it; live channel assignments and holds must be released first. Stock mode changes are blocked when a child has channel records or commitments.
- Explicit legacy variant groups with matching shared description/category/tags/currency are normalized together. Similar names are never guessed. Incompatible groups remain separate, preserving their data. Orphan legacy products without an artist are retained for investigation.
- Parent metadata is protected by RLS and written through the RPC. Public reads require a published, verified shop and a visible child. Sellers and queue staff can read but cannot edit families.
- Parent and child `updated_at` tokens reject stale editor saves, including inventory changes that occur while the editor is open.

## Creator experience

One family row with variant count, price and stock summary. Products with multiple variants open a searchable preview dialog with a bounded scrolling list; the catalog never expands inline. Single-variant products show stock/actions directly, without a Default row or an options button. Editor provides shared fields, child name/SKU/image/status/order, inherited or overridden price and stock; bulk price/stock, reorder and removal. Existing event/campaign allocation controls still operate on child SKUs.

## Customer presentation

Data selects the card layout. Single goods use one image; photo sets show actual images up to four, then +N and total picture count. Details show every gallery image. Bundles list contents and quantities. Preorders show close date/ETA; the database rejects new order items after the configured close. Services display type/duration/slots with the existing ordering flow. Service metadata does not introduce a second independent stock pool or a new queue policy.

## Event appearance

Optional event/date appearance with character, series, image, day/time/note, booth/zone and explicit public visibility. No creator role or profile requirement to add or omit it.

## การนำเข้าสินค้าด้วย CSV

ไฟล์ CSV หนึ่งไฟล์สร้างสินค้าใหม่ได้หลายสินค้าหลัก แต่ละแถวคือ SKU หรือตัวเลือกสินค้าหนึ่งตัว และใช้ `product_key` รวมแถวที่อยู่ในสินค้าหลักเดียวกัน ค่า `product_key` มีผลเฉพาะภายในไฟล์ที่กำลังอัปโหลด ไม่ใช่ ID ในฐานข้อมูล และไม่จำเป็นต้องนำกลับมาใช้ในการอัปโหลดครั้งถัดไป

สำหรับสินค้าที่มีหลายตัวเลือก ให้ใส่ `product_key` เดียวกันและกรอกข้อมูลส่วนกลางให้ตรงกันทุกแถว เช่น ชื่อสินค้า ราคาเริ่มต้น ประเภท หมวดหมู่ สกุลเงิน และข้อมูลการนำเสนอ ระบบรองรับตัวเลือกเพียงมิติเดียว เช่น ตัวละคร ลาย หรือสี ไม่มีการสร้างชุดค่าผสมหลายมิติ

| คอลัมน์ | การใช้งาน |
| --- | --- |
| `product_key` | คีย์สำหรับรวมแถวภายในไฟล์ ต้องไม่ว่าง และต้องไม่ซ้ำข้ามสินค้าหลัก |
| `name` | ชื่อสินค้าหลัก ต้องเหมือนกันทุกแถวในกลุ่ม |
| `base_price` | ราคาหลัก เลขศูนย์ใช้ได้ |
| `product_kind` | `single`, `photo`, `bundle`, `preorder` หรือ `service` |
| `category`, `tags`, `description`, `currency` | ข้อมูลส่วนกลาง โดย `currency` ใช้รหัสเช่น `THB` และ `tags` คั่นด้วยจุลภาค เครื่องหมายท่อ หรือเซมิโคลอน |
| `cover_image` | พาธรูปปกสินค้าหลัก |
| `gallery_images` | JSON array ของพาธรูป เช่น `["/images/a.jpg","/images/b.jpg"]` |
| `bundle_items` | JSON array เช่น `[{"name":"Postcard","quantity":3}]` ใช้กับ `bundle` |
| `preorder_closes_at` | วันปิดรับแบบ ISO 8601 ที่ระบุ timezone ชัดเจน เช่น `2027-12-01T23:59:00+07:00` |
| `preorder_eta` | ข้อความกำหนดส่งที่ลูกค้าอ่านเข้าใจ เช่น `Ships in December 2027` |
| `service_kind` | ประเภทบริการ เช่น `cheki`, `photo`, `signing` หรือ `commission` |
| `service_duration_minutes`, `service_slots` | ระยะเวลาเป็นนาทีและจำนวนที่รองรับต่อรอบ ต้องเป็นจำนวนเต็มบวก |
| `variant_name` | ชื่อตัวเลือก เช่น `Aether` หรือ `Lumine`; สินค้าตัวเลือกเดียวใช้ `Default` ได้ |
| `sku` | รหัส SKU ของตัวเลือก หากเว้นว่างระบบจะสร้างให้ |
| `price_override` | ราคาของตัวเลือก เว้นว่างเพื่อใช้ `base_price`; ค่า `0` คือราคาศูนย์จริง ไม่ใช่ช่องว่าง |
| `stock`, `is_unlimited` | สต็อกเริ่มต้นเป็นจำนวนเต็มไม่ติดลบ หรือกำหนด `is_unlimited` เป็น `true` |
| `status` | `enable`, `disable` หรือ `soldout` |
| `variant_sort_order` | ลำดับตัวเลือก เป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป |
| `image_url` | พาธรูปเฉพาะตัวเลือก เว้นว่างเพื่อใช้รูปปก |

[ไฟล์ตัวอย่าง CSV](/samples/catalog-import-sample.csv) มีตัวอย่างสินค้าหลายตัวเลือกที่สืบทอดราคาและมีราคา override, ราคา override เป็นศูนย์, photo set 5 รูป, bundle, preorder และ service รวมทั้งสต็อกแบบจำกัดและไม่จำกัด พาธ `/samples/replace-me/...` เป็น placeholder เท่านั้น ต้องอัปโหลดรูปและเปลี่ยนเป็นพาธจริงก่อนนำเข้า ไฟล์บันทึกเป็น UTF-8 พร้อม BOM เพื่อให้ภาษาไทยเปิดใน Excel ได้ถูกต้อง

การนำเข้าเป็นแบบสร้างใหม่เท่านั้น หากพบสินค้าหลักเดิมที่มีชื่อ หมวดหมู่ และสกุลเงินตรงกัน ระบบจะข้ามทั้งกลุ่ม ไม่เพิ่มตัวเลือก ไม่เขียนทับข้อมูลเดิม และไม่เปลี่ยนสต็อกเดิม ระบบยังอ่านหัวคอลัมน์เดิม `name`, `price`, `variant_group` และ `product_line` เพื่อรองรับไฟล์เก่า แต่ควรใช้รูปแบบใหม่สำหรับงานใหม่

ระบบตรวจทั้งไฟล์ก่อนบันทึก หากแถวไม่ถูกต้อง มี `product_key` ซ้ำกับข้อมูลส่วนกลางที่ขัดกัน หรือ JSON ผิดรูปแบบ จะยกเลิกทั้งไฟล์โดยไม่สร้างข้อมูลบางส่วน การสร้างสินค้าหลัก ตัวเลือก และสต็อกเริ่มต้นทำในธุรกรรมเดียวกันบนเซิร์ฟเวอร์

## Release checklist

- [x] Parent migration and authorization/inventory regressions
- [x] Grouped creator editing and bulk actions
- [x] Data-derived menu/campaign cards and gallery
- [x] Optional event appearance editing/public display
- [x] Lint/build/release checks and browser exercise

Remote migrations and deployment are outside this local implementation and require target authorization.

## Initial feature validation

Before integration with the latest DEV branch, `npm run verify` passed on 2026-10-03: lint, TypeScript/Vite build, 439 SQL assertions in 20 files, stock/promotion transaction checks, 60 desktop browser tests and local API smoke checks. New creator/customer flows also passed Android mobile browser checks.

- SQL regressions cover inherited/overridden prices (including zero), atomic rollback, held stock, removal, owner/manager permissions, public visibility, import grouping, stale parent/child snapshots and preorder closure. Event appearance regressions cover ownership, visibility and event dates.
- A disposable legacy fixture exercised the migration's exact backfill block: compatible explicit groups merge, incompatible descriptions remain separate, and UUIDs/SKUs/prices/sold/reserved stock stay intact.
- Browser regressions exercise creator create/edit/reorder/bulk stock, single-variant direct actions, a searchable 30-variant popup with internal scrolling, empty search, Escape/focus restoration and stock-dialog handoff, five-image gallery, public Cosplan show/hide, exact two/three/four-image cards, bundles, preorder dates and service inventory. Desktop and Android mobile runs use local fixtures only.
- New regressions are included in `npm run verify` through the existing local release gate.
- Local validation uses an isolated Supabase project with the repository's pinned PostgreSQL image `17.6.1.063`; seed is disabled and notification delivery uses local Mailpit.

## Follow-up scope

- Legacy rows without an artist remain unchanged for investigation. Ambiguous names are intentionally not auto-grouped.
- Service duration and slots describe the offering; the existing queue/order flow and channel inventory remain authoritative. This release does not add timed appointment booking.
- Apply the new migration files to an explicitly authorized target before deploying the new UI.

CSV validation also passed desktop and Android mobile flows: Thai editor/type-specific sections, sample download/import, repeated upload without stock changes, invalid-file rollback, legacy aliases and two concurrent import requests producing one family. The SQL import regressions cover authorization, create-only payloads, atomic rollback and the server row limit.

## Latest DEV integration validation

Integrated from `1c09ffe` on `origin/codex/dev-release-20260922`. `npm run verify` passed with 504 SQL assertions across 23 suites, five inventory race checks, 71 desktop browser tests, lint/build and local API smoke checks. Validation preserves the latest DEV stock receipt/history, validated image upload, checkout/shipping, discovery and offline operation flows. Queue transition regression also covers using the database-generated revision for the next optimistic update.

The approved remote target is Supabase DEV `kdjqitvtxmcrnnpuxuyl` and Firebase `event-queue-app` / `nireqapp` / preview channel `dev`. Only the three new append-only migrations are pending; no remote seed is applied.

Four Android mobile browser flows also passed on the integrated candidate: family management/Cosplan, CSV import, product presentation types and customer storefront.
