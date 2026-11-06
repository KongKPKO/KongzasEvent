import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';
import './seller-landing.css';

export default function SellerLanding() {
  const { language } = useI18n();
  const th = language === 'th';
  const stages = [
    {
      label: th ? '01 · ก่อนงาน' : '01 · BEFORE THE EVENT',
      title: th ? 'เปิดรับพรีออเดอร์ แล้ววางแผนผลิต' : 'Take pre-orders and plan production',
      text: th ? 'เลือกเปิดรับสั่งผลิตได้ตามจำนวนที่กำหนด ดูออเดอร์และยอดสินค้าที่ต้องเตรียม แล้วบันทึกรับสินค้าเข้าสต็อกเมื่อผลิตเสร็จ' : 'Accept made-to-order purchases with an optional limit, review orders and quantities to prepare, then receive finished goods into stock.',
      image: '/landing/preorders.png',
      alt: th ? 'ตัวอย่างหน้าจัดการออเดอร์ก่อนงานของร้านจำลอง' : 'Example pre-order dashboard for a demo shop',
    },
    {
      label: th ? '02 · วันงาน' : '02 · EVENT DAY',
      title: th ? 'ขายหน้าบูธและติดตามการรับสินค้า' : 'Sell at the booth and track pickups',
      text: th ? 'เปิด POS ขายสินค้าและกดจัดการคิวได้ในหน้าเดียว ค้นพรีออเดอร์ด้วยรหัสหรือชื่อลูกค้าเพื่อตรวจสินค้าก่อนยืนยันส่งมอบ' : 'Sell and manage queues from your POS. Find pre-orders by customer name or code and check items before confirming pickup.',
      image: '/landing/pickup.png',
      alt: th ? 'ตัวอย่างหน้าติดตามการรับสินค้าของร้านจำลอง' : 'Example pickup management screen for a demo shop',
    },
    {
      label: th ? '03 · หลังงาน' : '03 · AFTER THE EVENT',
      title: th ? 'เปิดขายต่อจากสต็อกที่เหลือ' : 'Continue selling remaining stock',
      text: th ? 'นำสินค้าที่เหลือและพร้อมขายมาเปิดรับออเดอร์ต่อ ให้คนที่ไม่ได้มางานสั่งซื้อได้ หรือเลือกเปิดรับสั่งผลิตเพิ่ม พร้อมติดตามการชำระและการจัดส่ง' : 'Offer remaining available stock after the event to people who missed it, or accept made-to-order purchases, then follow payments and shipping.',
      image: '/landing/postorders.png',
      alt: th ? 'ตัวอย่างหน้าจัดการออเดอร์หลังงานของร้านจำลอง' : 'Example post-event order dashboard for a demo shop',
    },
  ];
  return <PublicShell><main className="seller-landing">
    <section className="seller-hero public-width">
      <p className="public-kicker">PAIMON FOR SELLERS</p>
      <h1>{th ? 'เตรียมร้านครั้งเดียว ดูแลการขายได้ตลอดงาน' : 'Prepare your shop for every stage of the event'}</h1>
      <p>{th ? 'จากพรีออเดอร์และการผลิต สู่การขายหน้าบูธและออเดอร์หลังงาน จัดการสินค้า คิว และออเดอร์ของคุณใน Paimon' : 'From pre-orders and production to booth sales and post-event orders, manage your products, queues and orders in Paimon.'}</p>
      <div className="seller-actions"><Link className="public-button public-primary" to="/creator/register">{th ? 'สมัครร้านค้า' : 'Register your shop'} <ArrowRight size={18} /></Link><a className="public-button" href="#event-flow">{th ? 'ดูตัวอย่างการใช้งาน' : 'See how it works'}</a></div>
    </section>
    <section className="seller-setup public-width"><div className="seller-stage seller-setup-card"><div className="seller-stage-copy"><p className="seller-stage-label">{th ? 'เริ่มต้นที่ร้านของคุณ' : 'START WITH YOUR SHOP'}</p><h2>{th ? 'สร้างร้าน เตรียมสินค้า แล้วเลือกงานที่จะขาย' : 'Set up your shop, products and events'}</h2><p>{th ? 'ใส่ข้อมูลร้าน เพิ่มรูป ราคา ตัวเลือกสินค้าและสต็อก จากนั้นสร้างอีเวนต์ เลือกสินค้า จัดสรรสต็อก ตั้งช่วงขาย วิธีรับเงิน และโปรโมชั่น' : 'Add shop details, photos, prices, variants and stock. Create an event, choose products, allocate stock, and set sales windows, payment instructions and promotions.'}</p></div><figure><img src="/landing/catalog.png" alt={th ? 'ตัวอย่างแคตตาล็อกสินค้าของร้านจำลอง' : 'Example product catalog for a demo shop'} width="1280" height="900" loading="lazy" /><figcaption>{th ? 'ภาพหน้าจอจากร้านตัวอย่าง' : 'Demo shop screen'}</figcaption></figure></div></section>
    <section id="event-flow" className="seller-flow"><div className="public-width">
      <p className="public-kicker">{th ? 'หนึ่งอีเวนต์ · สามช่วงการขาย' : 'ONE EVENT · THREE STAGES'}</p>
      <h2>{th ? 'จากไอเดีย ถึงวันส่งมอบ' : 'From your idea to the handoff'}</h2>
      <p className="seller-flow-intro">{th ? 'ดูงานที่ต้องทำและออเดอร์ของแต่ละช่วงได้ในอีเวนต์เดียว' : 'See the tasks and orders for each stage in one event workspace.'}</p>
      <div className="seller-stages">{stages.map(stage => <article className="seller-stage" key={stage.image}>
        <div className="seller-stage-copy"><p className="seller-stage-label">{stage.label}</p><h3>{stage.title}</h3><p>{stage.text}</p></div>
        <figure><img src={stage.image} alt={stage.alt} width="1280" height="900" loading="lazy" /><figcaption>{th ? 'ภาพหน้าจอจากร้านตัวอย่าง' : 'Demo shop screen'}</figcaption></figure>
      </article>)}</div>
      <p className="seller-stock-note">{th ? 'เมื่อรับสินค้าที่ผลิตเข้าสต็อก ระบบกันของให้พรีออเดอร์ที่ยืนยันแล้วก่อน ส่วนที่เหลือจึงนำไปจัดสรรขายได้ ตรวจจำนวนพร้อมขายก่อนเปิดแต่ละช่วง' : 'When produced stock is received, confirmed production orders are earmarked first. Allocate the remainder for sale and check availability before opening each phase.'}</p>
    </div></section>
    <section className="seller-extra public-width" aria-labelledby="campaign-title"><div className="seller-stage"><div className="seller-stage-copy"><p className="seller-stage-label">{th ? 'แคมเปญออนไลน์ · รอบขายที่สร้างแยกได้' : 'ONLINE CAMPAIGNS · INDEPENDENT SALES'}</p><h2 id="campaign-title">{th ? 'ไม่มีอีเวนต์ ก็เปิดรอบขายได้' : 'Run an online sale between events'}</h2><p>{th ? 'สร้างรอบขายออนไลน์ของตัวเอง จะขายสินค้าพิเศษเฉพาะรอบ สินค้าเดิม หรือทั้งคู่ก็ได้ เลือกสินค้า จัดสรรสต็อก ตั้งเวลาขาย วิธีชำระเงิน และการจัดส่งหรือจุดรับของแคมเปญ' : 'Create an independent sale for limited-run products, existing goods, or both. Choose products, allocate stock, set the sales window, payment instructions and shipping or pickup.'}</p><p>{th ? 'แคมเปญแยกจากออเดอร์หลังงาน และใช้สต็อกที่จัดสรรให้ช่องทางของแคมเปญ' : 'Campaigns are separate from post-event orders and use stock allocated to the campaign.'}</p></div><figure><img src="/landing/campaign.png" alt={th ? 'ตัวอย่างหน้าจัดการแคมเปญออนไลน์ของร้านจำลอง' : 'Example online campaign workspace for a demo shop'} width="1280" height="900" loading="lazy" /><figcaption>{th ? 'ภาพหน้าจอจากร้านตัวอย่าง' : 'Demo shop screen'}</figcaption></figure></div></section>
    <section className="seller-customer"><div className="public-width"><p className="public-kicker">{th ? 'ฝั่งลูกค้า' : 'FOR YOUR CUSTOMERS'}</p><h2>{th ? 'ลูกค้าเจอร้าน เลือกสินค้า และติดตามได้ด้วยตัวเอง' : 'Help customers find, shop and follow along'}</h2><div className="seller-customer-grid">
      <article><span>01</span><h3>{th ? 'ค้นหาร้านและดูสินค้า' : 'Find your shop'}</h3><p>{th ? 'ค้นหาร้าน ดูงาน สินค้า รูป ราคา ตัวเลือก และโปรโมชั่นที่ร้านเปิดไว้' : 'Find your shop and browse your events, products, prices, options and available promotions.'}</p></article>
      <article><span>02</span><h3>{th ? 'สั่งก่อนงานและติดตามออเดอร์' : 'Pre-order and track'}</h3><p>{th ? 'สั่งสินค้า ส่งหลักฐานชำระเงิน และเก็บลิงก์หรือรหัสไว้ติดตาม ก่อนนำไปรับที่งานในวันงาน' : 'Order, submit payment evidence, and keep the link or code to track the order and collect it at the event.'}</p></article>
      <article><span>03</span><h3>{th ? 'สแกนหน้าร้านและรับคิว' : 'Scan and join the queue'}</h3><p>{th ? 'สแกน QR ที่บูธ เลือกอีเวนต์ที่ต้องการ แล้วดูสินค้าและรับคิวเมื่อร้านเปิดให้ใช้' : 'Scan the booth QR, select the event, browse products and join the queue when available.'}</p></article>
      <article><span>04</span><h3>{th ? 'เลือกซื้อหลังงานหรือรอบออนไลน์' : 'Shop after the event or online'}</h3><p>{th ? 'สั่งสินค้าเหลือจากอีเวนต์ผ่านออเดอร์หลังงาน หรือเลือกซื้อในแคมเปญออนไลน์ที่ร้านเปิดแยก พร้อมติดตามออเดอร์' : 'Order remaining event stock after the event, or shop a separate online campaign and follow the order.'}</p></article>
    </div><div className="seller-qr"><h3>{th ? 'ทำ QR สำหรับติดที่บูธ' : 'Create a QR for your booth'}</h3><p>{th ? 'เปิดหน้าร้านสาธารณะในเบราว์เซอร์ แล้วใช้เมนูสร้าง QR สำหรับหน้านี้ เช่น คลิกขวาและเลือกสร้าง QR Code ในเบราว์เซอร์ที่รองรับ นำไปติดหรือแชร์ให้ลูกค้าสแกน' : 'Open your public shop in a browser and use its create QR code option, such as the right-click menu where supported. Display or share the code for customers to scan.'}</p><p>{th ? 'หากร้านมีหลายอีเวนต์ ให้ลูกค้าตรวจและเลือกงานที่ต้องการหลังสแกน เพราะ QR ของหน้าร้านไม่ได้ล็อกอีเวนต์ที่เลือกไว้บนเครื่องร้าน เมนูสร้าง QR อาจต่างกันตามเบราว์เซอร์' : 'If your shop has multiple events, ask customers to check and select the right one after scanning: a shop QR does not lock the event selected on your device. Browser menu names vary.'}</p></div></div></section>
    <section className="seller-extra public-width"><div className="seller-stage"><div className="seller-stage-copy"><p className="seller-stage-label">{th ? 'ดูแลร้านร่วมกัน' : 'WORK TOGETHER'}</p><h2>{th ? 'แบ่งหน้าที่ให้ทีม และดูย้อนหลังได้' : 'Share the work and review results'}</h2><p>{th ? 'เชิญทีมตามบทบาทและงานที่รับผิดชอบ ตรวจออเดอร์ สถานะการชำระ รายงานยอดขาย และประวัติรายการได้ ร้านต้องตรวจสลิปกับเงินเข้าจริงก่อนยืนยัน ระบบไม่ได้ตรวจบัญชีธนาคารให้อัตโนมัติ' : 'Invite team members with appropriate roles and review orders, payment statuses, sales reports and history. Sellers check evidence against funds received; Paimon does not verify bank deposits automatically.'}</p></div><figure><img src="/landing/team.png" alt={th ? 'ตัวอย่างหน้าจัดการทีมของร้านจำลอง' : 'Example team management screen for a demo shop'} width="1280" height="900" loading="lazy" /><figcaption>{th ? 'ภาพหน้าจอจากร้านตัวอย่าง' : 'Demo shop screen'}</figcaption></figure></div></section>
    <section className="seller-next public-width"><div><p className="public-kicker">{th ? 'พร้อมเริ่มหรือยัง?' : 'READY TO BEGIN?'}</p><h2>{th ? 'ให้ Paimon ช่วยดูแลร้านของคุณ' : 'Bring your booth to Paimon'}</h2><p>{th ? 'สร้างร้านและเตรียมข้อมูลก่อนเผยแพร่ได้เมื่อพร้อม' : 'Create your shop and prepare it before publishing.'}</p></div><div className="seller-actions"><Link className="public-button public-primary" to="/creator/register">{th ? 'สมัครร้านค้า' : 'Register your shop'}</Link><a className="public-button" href="/landing/paimon-user-manual.pdf" target="_blank" rel="noopener noreferrer">{th ? 'เปิดคู่มือร้านค้า (PDF)' : 'Open seller guide (Thai PDF)'}</a></div></section>
  </main></PublicShell>;
}
