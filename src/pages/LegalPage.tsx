import { Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import PublicShell from '../components/PublicShell';

export type LegalPageKind = 'privacy' | 'terms' | 'cookies';

const content: Record<LegalPageKind, { title: string; englishTitle: string; updated: string; sections: Array<{ heading: string; body: string }> }> = {
  privacy: {
    title: 'นโยบายความเป็นส่วนตัว',
    englishTitle: 'Privacy Policy',
    updated: '13 กันยายน 2026',
    sections: [
      { heading: 'ข้อมูลที่ Nireq ใช้', body: 'เราใช้ข้อมูลบัญชี ข้อมูลบูธ ออเดอร์ คิว ช่องทางติดต่อ และหลักฐานการชำระเงินเท่าที่จำเป็นต่อการให้บริการ การรักษาความปลอดภัย และการช่วยเหลือผู้ใช้' },
      { heading: 'หลักฐานการชำระเงิน', body: 'ลูกค้าชำระเงินให้ครีเอเตอร์โดยตรง Nireq เป็นพื้นที่เก็บหลักฐานแบบส่วนตัวเพื่อให้ครีเอเตอร์ตรวจและยืนยันหรือปฏิเสธเอง เราไม่ได้ตรวจสอบบัญชีธนาคารหรือรับรองว่ามีเงินเข้าแล้ว' },
      { heading: 'การเปิดเผยและการเก็บรักษา', body: 'ข้อมูลสาธารณะของบูธจะแสดงเมื่อเจ้าของเผยแพร่บูธ ข้อมูลคำสั่งซื้อและหลักฐานไม่แสดงต่อสาธารณะ เราอาจใช้ผู้ให้บริการโฮสติ้ง ฐานข้อมูล อีเมล และการติดตามข้อผิดพลาดที่จำเป็นต่อการทำงานของระบบ' },
      { heading: 'สิทธิและการติดต่อ', body: 'คุณขอเข้าถึง แก้ไข หรือลบข้อมูลที่กฎหมายอนุญาตได้โดยติดต่อเรา อาจต้องยืนยันตัวตนก่อนดำเนินการ' },
    ],
  },
  terms: {
    title: 'ข้อกำหนดการใช้งาน',
    englishTitle: 'Terms of Service',
    updated: '13 กันยายน 2026',
    sections: [
      { heading: 'บทบาทของ Nireq', body: 'Nireq ช่วยจัดการคิว ออเดอร์ หลักฐานการชำระเงิน และการรับสินค้า แต่ไม่ได้เป็นผู้ขาย ผู้รับชำระเงิน หรือผู้ตรวจสอบธุรกรรมระหว่างลูกค้ากับครีเอเตอร์' },
      { heading: 'ความรับผิดชอบของผู้ใช้', body: 'ผู้ใช้ต้องให้ข้อมูลที่ถูกต้อง รักษาความลับของบัญชี และไม่ใช้ระบบเพื่อฉ้อโกง ละเมิดสิทธิ รบกวนบริการ หรือเข้าถึงข้อมูลที่ไม่ได้รับอนุญาต' },
      { heading: 'ออเดอร์ การชำระเงิน และข้อพิพาท', body: 'ครีเอเตอร์เป็นผู้กำหนดราคา สต็อก เงื่อนไขรับสินค้า และเป็นผู้ตรวจหลักฐานการชำระเงินเอง ข้อพิพาทเรื่องสินค้าและการชำระเงินควรติดต่อครีเอเตอร์ก่อน' },
      { heading: 'ความพร้อมใช้งาน', body: 'เราพยายามให้บริการต่อเนื่อง แต่อาจหยุดชั่วคราวเพื่อบำรุงรักษา ความปลอดภัย หรือเหตุที่อยู่นอกการควบคุม และอาจปรับข้อกำหนดโดยประกาศวันที่แก้ไข' },
    ],
  },
  cookies: {
    title: 'การใช้คุกกี้และพื้นที่จัดเก็บ',
    englishTitle: 'Cookies & Local Storage',
    updated: '13 กันยายน 2026',
    sections: [
      { heading: 'สิ่งที่เราใช้', body: 'Nireq ใช้คุกกี้หรือพื้นที่จัดเก็บในเบราว์เซอร์ที่จำเป็นสำหรับการเข้าสู่ระบบ ความปลอดภัย ภาษา ตะกร้า คิว และการกลับมาดูสถานะออเดอร์' },
      { heading: 'การควบคุม', body: 'คุณลบข้อมูลเว็บไซต์ผ่านการตั้งค่าเบราว์เซอร์ได้ แต่อาจทำให้ต้องเข้าสู่ระบบใหม่หรือสูญเสียข้อมูลคิวและตะกร้าที่เก็บในอุปกรณ์นั้น' },
      { heading: 'บันทึกการใช้งานโดยสมัครใจ', body: 'LogRocket เริ่มบันทึกเมื่อคุณยินยอมเท่านั้น โดยปกปิดข้อความ รูป และช่องกรอกข้อมูล ไม่ส่งเนื้อหาเครือข่าย console logs หรือข้อมูลระบุตัวบัญชี คุณปฏิเสธได้โดยยังใช้บริการหลักได้ตามปกติ ถอนความยินยอมได้จากปุ่มความเป็นส่วนตัว โดยบันทึกงานก่อนเพราะหน้าจะโหลดใหม่เพื่อหยุดตัวบันทึก' },
    ],
  },
};

const english: typeof content = {
  privacy: {
    title: 'Privacy Policy', englishTitle: 'Privacy Policy', updated: '13 September 2026',
    sections: [
      { heading: 'Information NireQ uses', body: 'We use account, booth, order, queue, contact and payment evidence information as needed to provide the service, protect its security and support users.' },
      { heading: 'Payment evidence', body: 'Customers pay creators directly. NireQ stores payment evidence privately for the creator to review and accept or reject. We do not check bank accounts or certify that funds have arrived.' },
      { heading: 'Sharing and storage', body: 'Public booth information appears when its owner publishes it. Orders and evidence are not published publicly. We may use hosting, database, email and technical support providers to operate the service.' },
      { heading: 'Your requests', body: 'Contact us to request access, correction, export or deletion of your personal information. We may need to verify your identity. We will explain any information we must retain and the reason.' },
    ],
  },
  terms: {
    title: 'Terms of Service', englishTitle: 'Terms of Service', updated: '13 September 2026',
    sections: [
      { heading: 'NireQ’s role', body: 'NireQ helps manage queues, orders, payment evidence and pickup. We are not the seller, payment recipient or verifier of transactions between customers and creators.' },
      { heading: 'Your responsibilities', body: 'Provide accurate information, protect your account and do not use the service for fraud, infringement, disruption or unauthorized access.' },
      { heading: 'Orders, payments and disputes', body: 'Creators set prices, stock and fulfillment terms and review payment evidence. Contact the creator first about product or payment disputes.' },
      { heading: 'Availability', body: 'We aim to provide a reliable service. Maintenance, security incidents or events beyond our control may interrupt it. Changes to these terms include an updated date.' },
    ],
  },
  cookies: {
    title: 'Cookies & Local Storage', englishTitle: 'Cookies & Local Storage', updated: '13 September 2026',
    sections: [
      { heading: 'Essential storage', body: 'NireQ uses browser storage for sign-in, security, language, cart, queues and returning to your order status.' },
      { heading: 'Your controls', body: 'You can clear site data in your browser settings. This may sign you out and remove queue or cart information stored on that device.' },
      { heading: 'Optional session replay', body: 'LogRocket starts recording only with your consent. Text, images and inputs are hidden. Network content, console logs and account identity are not sent. Declining does not affect core features. You can withdraw through Privacy preferences. Save your work first: withdrawal reloads the page to unload the recorder.' },
    ],
  },
};

export default function LegalPage({ kind }: { kind: LegalPageKind }) {
  const { language } = useI18n();
  const th = language === 'th';
  const page = (th ? content : english)[kind];

  return (
    <PublicShell><main className="public-width py-8 sm:py-12">
      <nav className="mb-8 flex flex-wrap gap-3" aria-label={th ? 'เอกสารและความช่วยเหลือ' : 'Policies and help'}>
        {(['privacy', 'terms', 'cookies'] as const).map(key => <Link key={key} to={`/${key}`} aria-current={kind === key ? 'page' : undefined} className={`public-button ${kind === key ? 'public-primary' : ''}`}>{key === 'privacy' ? (th ? 'ความเป็นส่วนตัว' : 'Privacy') : key === 'terms' ? (th ? 'ข้อกำหนด' : 'Terms') : (th ? 'คุกกี้' : 'Cookies')}</Link>)}
        <Link to="/help" className="public-text-link">{th ? 'ช่วยเหลือ' : 'Help'}</Link>
      </nav>
      <article className="max-w-3xl mx-auto">
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-sm text-gray-500">{th ? 'ปรับปรุงล่าสุด' : 'Last updated'} {page.updated}</p>

        <nav aria-label={th ? 'สารบัญ' : 'On this page'} className="mt-8 border-y border-pink-200 py-4">
          <p className="mb-2 text-sm font-bold">{th ? 'เนื้อหาในหน้านี้' : 'On this page'}</p>
          {page.sections.map((section, index) => <a key={section.heading} href={`#section-${index}`} className="flex min-h-11 items-center text-sm font-semibold text-pink-800">{section.heading}</a>)}
        </nav>
        <div className="mt-8 space-y-8">
          {page.sections.map((section) => (
            <section key={section.heading} id={`section-${page.sections.indexOf(section)}`} className="scroll-mt-6">
              <h2 className="text-lg font-black text-gray-900">{section.heading}</h2>
              <p className="mt-2 leading-7 text-gray-600">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-pink-100 bg-pink-50/60 p-5">
          <h2 className="font-black">{th ? 'ติดต่อ NireQ' : 'Contact NireQ'}</h2>
          <a href="mailto:konglnwzas@gmail.com" className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold text-pink-700 hover:text-pink-900">
            <Mail size={17} /> konglnwzas@gmail.com
          </a>
        </div>
      </article>
    </main></PublicShell>
  );
}
