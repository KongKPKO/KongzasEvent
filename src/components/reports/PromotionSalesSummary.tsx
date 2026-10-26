import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { formatPrice } from '../../utils/currency';

export interface PromotionSalesSummaryData {
  rows: Array<{ promotion_id: string; name: string; order_count: number; discount_total: number; gift_units: number; activity_units: number }>;
  unattributedDiscount: number;
  discountTotal: number;
  discountMismatch: boolean;
}

export default function PromotionSalesSummary({ summary, currency, historyUrl }: { summary: PromotionSalesSummaryData | undefined; currency: string; historyUrl: string }) {
  const { language } = useI18n();
  const th = language === 'th';
  if (!summary) return <section className="report-panel" role="alert">{th ? 'โหลดสรุปโปรโมชั่นไม่สำเร็จ กรุณาลองใหม่' : 'Could not load promotion usage. Please retry.'}</section>;
  return <section className="report-panel" aria-label={th ? 'สรุปการใช้โปรโมชั่น' : 'Promotion usage'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-black">{th ? 'สรุปการใช้โปรโมชั่น' : 'Promotion usage'}</h2><p className="mt-1 text-sm text-gray-600">{th ? 'นับออเดอร์ที่สำเร็จในช่วงวันที่และสกุลเงินที่เลือก อ้างอิงโปรโมชั่นที่บันทึกตอนขาย แต่ละโปรโมชั่นนับหนึ่งครั้งต่อออเดอร์' : 'Completed orders in the selected dates and currency. Uses saved sale details; each promotion counts once per order.'}</p></div>
      <Link className="report-button" to={historyUrl}>{th ? 'ดูโปรโมชั่นในประวัติการขาย' : 'View promotions in sales history'}</Link>
    </div>
    {summary.rows.length ? <div className="mt-4 space-y-3">{summary.rows.map(row => <article key={row.promotion_id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 p-4">
      <div className="min-w-0"><h3 className="break-words font-bold">{row.name}</h3><p className="mt-1 text-sm text-gray-600">{th ? `ใช้ใน ${row.order_count.toLocaleString()} ออเดอร์` : `Used in ${row.order_count.toLocaleString()} ${row.order_count === 1 ? 'order' : 'orders'}`}</p>
        {row.gift_units > 0 && <p className="mt-1 text-sm">{th ? `ของแถม ${row.gift_units.toLocaleString()} ชิ้น` : `${row.gift_units.toLocaleString()} gift units`}</p>}
        {row.activity_units > 0 && <p className="mt-1 text-sm">{th ? `สิทธิ์กิจกรรม ${row.activity_units.toLocaleString()} สิทธิ์` : `${row.activity_units.toLocaleString()} activity rewards`}</p>}
      </div><div className="text-right"><span className="block text-xs text-gray-600">{th ? 'ส่วนลดรวม' : 'Total discount'}</span><strong>{formatPrice(Number(row.discount_total), currency)}</strong></div>
    </article>)}</div> : <p className="mt-4 text-sm text-gray-600">{th ? 'ไม่มีโปรโมชั่นที่บันทึกไว้ในออเดอร์ช่วงนี้' : 'No saved promotions for orders in this period.'}</p>}
    {summary.unattributedDiscount > 0 && <p className="mt-4 text-sm text-gray-700">{th ? 'ส่วนลดระดับออเดอร์ที่ไม่มีรายละเอียดโปรโมชั่น' : 'Order discounts without promotion details'}: <strong>{formatPrice(Number(summary.unattributedDiscount), currency)}</strong></p>}
    {summary.discountMismatch && <p role="status" className="mt-3 text-sm text-amber-800">{th ? 'ยอดส่วนลดในรายละเอียดโปรโมชั่นต่างจากยอดส่วนลดออเดอร์ โปรดตรวจประวัติการขาย โดยยอดขายยังใช้ยอดออเดอร์ที่บันทึกไว้' : 'Promotion details differ from recorded order discounts. Review sales history; revenue still uses saved order totals.'}</p>}
    <p className="mt-4 border-t border-gray-100 pt-3 text-sm">{th ? 'ส่วนลดออเดอร์รวม' : 'Total order discounts'} <strong>{formatPrice(Number(summary.discountTotal), currency)}</strong></p>
  </section>;
}
