import { ArrowLeft, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

export type LegalPageKind = 'privacy' | 'terms' | 'cookies';

const content: Record<LegalPageKind, { title: string; englishTitle: string; updated: string; sections: Array<{ heading: string; body: string }> }> = {
  privacy: {
    title: 'นโยบายความเป็นส่วนตัว',
    englishTitle: 'Privacy Policy',
    updated: '16 กรกฎาคม 2026',
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
    updated: '16 กรกฎาคม 2026',
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
    updated: '16 กรกฎาคม 2026',
    sections: [
      { heading: 'สิ่งที่เราใช้', body: 'Nireq ใช้คุกกี้หรือพื้นที่จัดเก็บในเบราว์เซอร์ที่จำเป็นสำหรับการเข้าสู่ระบบ ความปลอดภัย ภาษา ตะกร้า คิว และการกลับมาดูสถานะออเดอร์' },
      { heading: 'การควบคุม', body: 'คุณลบข้อมูลเว็บไซต์ผ่านการตั้งค่าเบราว์เซอร์ได้ แต่อาจทำให้ต้องเข้าสู่ระบบใหม่หรือสูญเสียข้อมูลคิวและตะกร้าที่เก็บในอุปกรณ์นั้น' },
      { heading: 'การวัดผลและข้อผิดพลาด', body: 'เราอาจเก็บข้อมูลทางเทคนิคแบบจำกัดเพื่อหาข้อผิดพลาดและปรับปรุงความเสถียร โดยหลีกเลี่ยงการส่งรหัสผ่าน โทเคน และหลักฐานการชำระเงินไปยังระบบติดตาม' },
    ],
  },
};

export default function LegalPage({ kind }: { kind: LegalPageKind }) {
  const page = content[kind];

  return (
    <main className="min-h-screen bg-[#fffafc] px-4 py-8 text-gray-950">
      <article className="mx-auto max-w-3xl rounded-3xl border border-pink-100 bg-white p-6 shadow-sm sm:p-10">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-pink-700 hover:text-pink-900">
          <ArrowLeft size={17} /> กลับไป Nireq
        </Link>
        <p className="mt-8 text-xs font-black uppercase tracking-[0.18em] text-pink-700">{page.englishTitle}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-sm text-gray-500">ปรับปรุงล่าสุด {page.updated}</p>

        <div className="mt-8 space-y-7">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-black text-gray-900">{section.heading}</h2>
              <p className="mt-2 leading-7 text-gray-600">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-pink-100 bg-pink-50/60 p-5">
          <h2 className="font-black">ติดต่อ Nireq</h2>
          <a href="mailto:kongphop.sunit@gmail.com" className="mt-2 inline-flex min-h-11 items-center gap-2 font-bold text-pink-700 hover:text-pink-900">
            <Mail size={17} /> kongphop.sunit@gmail.com
          </a>
        </div>
      </article>
    </main>
  );
}
