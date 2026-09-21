import { ArrowRight, Check } from 'lucide-react';
import type { SetupReadiness, SetupStepId } from '../../lib/setupReadiness';
import { useI18n } from '../../i18n';

interface GuidedSetupPanelProps {
  readiness: SetupReadiness;
  eventId: string;
  compact?: boolean;
  onEditEvent: () => void;
  onNavigate: (path: string) => void;
}

// Hallmark · existing NireQ workflow · pre-emit critique: P4 H4 E4 S4 R5 V4
export default function GuidedSetupPanel({ readiness, eventId, compact = false, onEditEvent, onNavigate }: GuidedSetupPanelProps) {
  const { language } = useI18n();
  const th = language === 'th';
  const complete = (id: SetupStepId) => readiness.steps.find(step => step.id === id)?.complete;
  const steps = [
    { id: 'event', title: th ? 'รายละเอียดงาน' : 'Event details', detail: th ? 'ตรวจวัน เวลา สถานที่ และจุดตั้งบูธ' : 'Check dates, venue and booth location.', action: onEditEvent, done: complete('event') },
    { id: 'catalog', title: th ? 'เลือกสินค้าและจัดสรรสต็อก' : 'Choose products & allocate stock', detail: th ? 'เพิ่มสินค้าจากคลังร้าน แล้วกำหนดจำนวนที่จะขายในงานนี้' : 'Add products from your shop and assign stock to this event.', action: () => onNavigate(`/manage-events/${eventId}/catalog`), done: false },
    { id: 'schedule', title: th ? 'ช่วงขายและรับเงิน' : 'Schedule & payment', detail: th ? 'เลือกขายก่อนงาน / วันงาน / หลังงาน พร้อมวิธีโอนเงินและคำแนะนำรับสินค้า' : 'Set pre-order and post-order windows, payment and pickup instructions.', action: () => onNavigate(`/manage-events/${eventId}/preorder`), done: false },
    { id: 'promotion', title: th ? 'โปรโมชัน (ไม่บังคับ)' : 'Promotions (optional)', detail: th ? 'เลือกเงื่อนไข ส่วนลดหรือของแถม และช่วงเวลาที่ใช้กับงานนี้' : 'Choose discounts or gifts and when they apply to this event.', action: () => onNavigate(`/manage-events/${eventId}/promotion`), done: false },
  ];

  return (
    <section className="sales-readiness mb-5" aria-label={th ? 'ขั้นตอนเตรียมขาย' : 'Event setup steps'}>
      <div className="mb-4">
        <p className="text-xs font-bold text-pink-700">{th ? 'เตรียมงานของคุณ' : 'Prepare your event'}</p>
        <h2 className="mt-1 text-xl font-black text-gray-950">{th ? 'ตั้งค่าให้ครบ ก่อนเริ่มขาย' : 'Set up before you start selling'}</h2>
        <p className="mt-2 text-sm text-gray-600">{th ? 'เริ่มจากสินค้าและสต็อก แล้วเลือกช่วงขายที่ต้องการ แต่ละข้อกลับมาแก้ไขได้เสมอ' : 'Start with products and stock, then choose your sales windows. You can revisit every step.'}</p>
      </div>
      <ol className="divide-y divide-gray-100">
        {steps.map((step, index) => (
          <li key={step.id} className="!flex flex-wrap items-center gap-3 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-50 font-bold text-pink-700">{step.done ? <Check size={16} aria-label={th ? 'ข้อมูลครบ' : 'Details complete'} /> : index + 1}</span>
            <div className="min-w-0 flex-1 basis-48">
              <h3 className="font-bold text-gray-900">{step.title}</h3>
              {!compact && <p className="mt-1 text-sm text-gray-600">{step.detail}</p>}
            </div>
            <button type="button" onClick={step.action} aria-label={step.title} className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl border border-pink-200 px-4 text-sm font-bold text-pink-700 hover:bg-pink-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-700">
              {th ? 'ตั้งค่า' : 'Configure'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      {!compact && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <p className="text-sm text-gray-600">{th ? 'ก่อนแชร์ร้าน ตรวจสต็อก ช่วงขาย การรับเงิน และหน้าที่ลูกค้าจะเห็น' : 'Before sharing, review stock, schedule, payment and the customer view.'}</p>
        <button type="button" onClick={() => onNavigate('/manage-events?focus=publish')} className="min-h-11 whitespace-nowrap rounded-xl border border-pink-200 px-4 text-sm font-bold text-pink-700 hover:bg-pink-50">{th ? 'ตรวจหน้าร้านก่อนเผยแพร่' : 'Review storefront'}</button>
      </div>}
    </section>
  );
}
