import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';

export default function HelpPage() {
  const { language } = useI18n();
  const th = language === 'th';
  const questions = th ? [
    ['เริ่มเตรียมร้านอย่างไร?', 'ตั้งชื่อร้านและช่องทางติดต่อ เพิ่มสินค้าและสต็อก แล้วเลือกอีเวนต์หรือแคมเปญที่ต้องการขาย ตรวจความพร้อมก่อนเผยแพร่หน้าร้าน'],
    ['เพิ่มสินค้าแล้ว ทำไมยังขายไม่ได้?', 'สินค้าในคลังต้องถูกเลือกและจัดสรรสต็อกให้ช่องทางขายนั้นก่อน ตรวจช่วงเปิดขายและสถานะของอีเวนต์หรือแคมเปญด้วย'],
    ['ลูกค้าโอนเงินแล้ว แต่สถานะยังรอตรวจ?', 'ครีเอเตอร์ต้องเปิดรายการออเดอร์ ตรวจหลักฐานกับยอดเงินที่ได้รับจริง แล้วจึงยืนยัน NireQ ไม่ได้ยืนยันยอดเงินเข้าธนาคารให้อัตโนมัติ'],
    ['ต้องการติดตามออเดอร์หรือสอบถามสินค้า?', 'เปิดลิงก์ติดตามออเดอร์ที่ได้รับ หรือติดต่อครีเอเตอร์ผ่านหน้าร้าน แจ้งเลขออเดอร์เพื่อช่วยค้นหารายการ'],
    ['เปลี่ยนภาษาและความเป็นส่วนตัวที่ไหน?', 'เปลี่ยนภาษาได้จากปุ่มบนหัวหน้าเว็บ และจัดการความยินยอมบันทึกการใช้งานจากปุ่มความเป็นส่วนตัว ควรบันทึกงานก่อนถอนความยินยอมเพราะหน้าจะโหลดใหม่'],
  ] : [
    ['How do I prepare my shop?', 'Set your shop name and contact links, add products and stock, then choose an event or campaign. Review readiness before publishing.'],
    ['Why can’t I sell a product I added?', 'Select the product and allocate stock to the sales channel first. Check its sales window and event or campaign status.'],
    ['Why is a transfer still awaiting review?', 'The creator must review the evidence against funds actually received before confirming the order. NireQ does not automatically verify bank deposits.'],
    ['How do I track an order or ask about a product?', 'Open your order tracking link or contact the creator through their shop. Include the order number to help locate the purchase.'],
    ['Where are language and privacy controls?', 'Change language in the page header. Use Privacy preferences to manage session recording consent. Save your work before withdrawing consent, as the page will reload.'],
  ];
  return <PublicShell><main className="public-width py-8 sm:py-12">
    <p className="public-kicker">NireQ · {th ? 'ช่วยเหลือ' : 'Help'}</p>
    <h1 className="text-3xl font-black">{th ? 'ให้คุณกลับไปทำงานต่อได้' : 'Get back to your booth'}</h1>
    <p className="mt-3 max-w-2xl leading-7 text-slate-600">{th ? 'คำตอบสำหรับการเตรียมร้าน การขาย และการติดตามออเดอร์' : 'Answers for shop setup, selling and order tracking.'}</p>
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section aria-label={th ? 'คำถามที่พบบ่อย' : 'Common questions'} className="divide-y divide-pink-100">
        {questions.map(([question, answer]) => <details key={question} className="py-4"><summary className="min-h-11 cursor-pointer py-3 font-bold text-slate-900">{question}</summary><p className="max-w-2xl pb-4 leading-7 text-slate-600">{answer}</p></details>)}
      </section>
      <aside className="self-start rounded-2xl border border-pink-200 bg-white p-6">
        <h2 className="text-xl font-bold">{th ? 'ยังต้องการความช่วยเหลือ?' : 'Still need help?'}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{th ? 'แจ้งหน้าที่พบปัญหา ขั้นตอนก่อนเกิดเหตุ และข้อความผิดพลาด ไม่ต้องส่งรหัสผ่านหรือรหัส OTP' : 'Include the affected page, steps and error message. Do not send passwords or OTP codes.'}</p>
        <a className="public-text-link mt-3 break-all" href="mailto:konglnwzas@gmail.com">konglnwzas@gmail.com</a>
        <nav className="mt-5 flex flex-col border-t border-pink-100 pt-3" aria-label={th ? 'นโยบาย' : 'Policies'}>
          <Link className="public-text-link" to="/privacy">{th ? 'ความเป็นส่วนตัว' : 'Privacy'}</Link><Link className="public-text-link" to="/terms">{th ? 'ข้อกำหนดการใช้งาน' : 'Terms'}</Link><Link className="public-text-link" to="/cookies">{th ? 'คุกกี้และพื้นที่จัดเก็บ' : 'Cookies and storage'}</Link>
        </nav>
      </aside>
    </div>
  </main></PublicShell>;
}
