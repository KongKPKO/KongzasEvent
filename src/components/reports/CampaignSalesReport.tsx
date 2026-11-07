import { useEffect, useState } from 'react';
import EventDateFilter from '../EventDateFilter';
import { ProductMedia } from '../menu/ProductPresentation';
import type { CampaignProduct } from '../../types/onlineCampaign';
import { getMenuImageUrl } from '../../utils/imageUtils';
import { useI18n } from '../../i18n';
import { buildUtf8Csv, downloadUtf8Csv } from '../../lib/productSalesReport';
import { supabase } from '../../supabaseClient';
import { formatPrice } from '../../utils/currency';
import '../../pages/creators/sales-reports.css';

type Product = { product_id: string; name: string; category: string; qty: number | null; gifts: number | null; revenue: number };
type Period = { orders: number; revenue: number; day: string };
type Report = { currency: string; revenue: number; discount: number; shipping: number; orders: number; items: number; gifts: number; products: Product[]; categories: {category: string; qty: number; revenue: number}[]; days: Period[]; promotions: {id: string; name: string; orders: number; discount: number}[] };

export default function CampaignSalesReport({ campaignId, name, timeZone, catalog }: { campaignId: string; name: string; timeZone: string; catalog: CampaignProduct[] }) {
  const { language } = useI18n();
  const th = language === 'th';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<'quantity' | 'revenue' | 'name'>('quantity');
  useEffect(() => {
    let active = true;
    setReport(null); setError('');
    void Promise.resolve(supabase.rpc('get_campaign_sales_analytics', { p_campaign_id: campaignId, p_from: from || null, p_to: to || null })).then(({ data, error: failure }) => {
      if (!active) return;
      if (failure || !data) { setError(failure?.message || 'report_missing'); return; }
      setReport(data as Report);
    }).catch(() => { if (active) setError('request_failed'); });
    return () => { active = false; };
  }, [campaignId, from, to, retry]);
  const productImage = (product: Product) => <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-gray-50"><ProductMedia product={{ ...catalog.find(item => (item.product_id || item.id) === product.product_id), id: product.product_id, name: product.name, price: 0 }} getImageUrl={getMenuImageUrl} /></span>;
  const money = (value: number) => formatPrice(Number(value), report?.currency || 'THB');
  const download = () => {
    if (!report) return;
    const rows = [[th ? 'สินค้า' : 'Product', th ? 'หมวดหมู่' : 'Category', th ? 'จำนวนขาย' : 'Units sold', th ? 'ของแถม' : 'Gift units', th ? 'ยอดก่อนส่วนลด' : 'Gross sales', th ? 'สกุลเงิน' : 'Currency'], ...report.products.map(p => [p.name, p.category, String(p.qty || 0), String(p.gifts || 0), String(p.revenue), report.currency])];
    downloadUtf8Csv(buildUtf8Csv(rows), `campaign-sales-${campaignId}.csv`);
  };
  return <div className="sales-reports space-y-5" aria-label={th ? 'รายงานยอดขายแคมเปญ' : 'Campaign sales report'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black">{th ? 'ภาพรวมยอดขาย' : 'Sales dashboard'}</h2><p className="font-bold text-blue-800">{name}</p><p className="mt-2 text-sm text-gray-600">{th ? 'ออเดอร์ที่ยืนยันการชำระแล้ว รวมค่าจัดส่งและหักส่วนลด ไม่รวมออเดอร์ที่คืนเงินหรือรอชำระ' : 'Payment-confirmed orders, including shipping and after discounts. Refunded and unpaid orders are excluded.'}</p></div><button className="report-button" disabled={!report} onClick={download}>{th ? 'ส่งออก CSV รายสินค้า' : 'Export product CSV'}</button></div>
    <EventDateFilter from={from} to={to} timeZone={timeZone} onChange={(a, b) => { setFrom(a); setTo(b); }} />
    {error ? <div className="report-panel" role="alert">{error.includes('campaign_currency_mismatch') ? (th ? 'พบออเดอร์ที่ใช้สกุลเงินต่างจากแคมเปญ จึงไม่สามารถรวมยอดได้' : 'Orders use a different currency from this campaign; totals cannot be combined.') : (th ? 'โหลดรายงานไม่สำเร็จ' : 'Could not load report.')} <button className="report-button" onClick={() => setRetry(n => n + 1)}>{th ? 'ลองอีกครั้ง' : 'Retry'}</button></div> : !report ? <p role="status">{th ? 'กำลังโหลดรายงาน...' : 'Loading report...'}</p> : <>
      <div className="report-metrics grid grid-cols-2 gap-3 md:grid-cols-4">{[[th ? 'ยอดขายที่ยืนยันแล้ว' : 'Confirmed revenue', money(report.revenue)], [th ? 'ส่วนลดที่ให้' : 'Discounts', money(report.discount)], [th ? 'สินค้าที่ขาย / ของแถม' : 'Sold / gift units', `${report.items} / ${report.gifts}`], [th ? 'ออเดอร์ที่ยืนยันชำระ' : 'Confirmed orders', String(report.orders)]].map(([label, value]) => <div key={label} className="rounded-2xl border"><span className="text-sm font-bold">{label}</span><strong className="mt-2 block text-2xl">{value}</strong></div>)}</div>
      <div className="grid gap-4 md:grid-cols-2"><section className="report-panel"><h3 className="font-black">{th ? 'สินค้าขายดี' : 'Top products'}</h3><p className="text-sm text-gray-500">{th ? 'เรียงตามจำนวนที่ขาย ยอดก่อนส่วนลด' : 'Sorted by units sold, before discounts'}</p>{report.products.filter(p => Number(p.qty) > 0).slice(0, 8).map(p => <div key={`${p.product_id}-${p.name}`} className="flex justify-between gap-3 border-b py-3"><div className="flex min-w-0 items-center gap-3">{productImage(p)}<span className="break-words">{p.name}</span></div><strong className="shrink-0">{p.qty} · {money(p.revenue)}</strong></div>)}{!report.products.length && <p className="mt-3 text-sm text-gray-500">{th ? 'ยังไม่มียอดขาย' : 'No sales yet.'}</p>}</section>
      <section className="report-panel"><h3 className="font-black">{th ? 'ยอดขายตามหมวดหมู่' : 'Sales by category'}</h3><p className="text-sm text-gray-500">{th ? 'ยอดสินค้า ก่อนส่วนลด ไม่รวมของแถม' : 'Product totals before discounts, excluding gifts'}</p>{report.categories.map(c => <div key={c.category} className="flex justify-between gap-2 border-b py-3"><span>{c.category}</span><strong>{c.qty} · {money(c.revenue)}</strong></div>)}</section></div>
      <div className="grid gap-4 md:grid-cols-2"><section className="report-panel"><h3 className="font-black">{th ? 'ยอดขายรายวัน' : 'Sales by day'}</h3><p className="text-sm text-gray-500">{timeZone} · {th ? 'ตามเวลาสร้างออเดอร์' : 'by order creation time'}</p>{report.days.map(p => <div key={p.day} className="flex justify-between gap-2 border-b py-2 text-sm"><span>{p.day}</span><strong>{p.orders} {th ? 'ออเดอร์' : 'orders'} · {money(p.revenue)}</strong></div>)}{!report.days.length && <p className="mt-3 text-sm text-gray-500">{th ? 'ไม่มีข้อมูลในช่วงนี้' : 'No data for this period.'}</p>}</section>
      <section className="report-panel"><h3 className="font-black">{th ? 'สรุปการใช้โปรโมชั่น' : 'Promotion usage'}</h3><p className="text-sm text-gray-500">{th ? 'ตามรายละเอียดที่บันทึกในออเดอร์ที่ยืนยันชำระ' : 'From saved payment-confirmed orders'}</p>{report.promotions.map(p => <div key={p.id} className="flex justify-between gap-3 border-b py-3"><div><strong>{p.name}</strong><p className="text-sm">{p.orders} {th ? 'ออเดอร์' : 'orders'}</p></div><strong>{money(p.discount)}</strong></div>)}{!report.promotions.length && <p className="mt-3 text-sm text-gray-500">{th ? 'ไม่มีโปรโมชั่นที่บันทึกไว้ในช่วงนี้' : 'No promotions recorded in this period.'}</p>}</section></div>
      <section className="report-panel"><h3 className="font-black">{th ? 'ยอดขายรายสินค้า' : 'Product sales'}</h3><p className="text-sm text-gray-500">{th ? 'ยอดสินค้าเป็นราคาก่อนส่วนลด ไม่รวมค่าจัดส่ง หมวดหมู่อ้างอิงข้อมูลสินค้าปัจจุบัน' : 'Product amounts before discounts and excluding shipping; categories use current catalog data.'}</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="block text-sm font-bold">{th ? 'ค้นหาสินค้า' : 'Search products'}<input value={search} onChange={e => setSearch(e.target.value)} className="mt-1 block w-full rounded-xl border p-3" /></label><label className="block text-sm font-bold">{th ? 'หมวดหมู่' : 'Category'}<select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full rounded-xl border p-3"><option value="">{th ? 'ทุกหมวดหมู่' : 'All categories'}</option>{[...new Set(report.products.map(p => p.category))].sort().map(value => <option key={value}>{value}</option>)}</select></label><label className="block text-sm font-bold">{th ? 'เรียงตาม' : 'Sort by'}<select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="mt-1 block w-full rounded-xl border p-3"><option value="quantity">{th ? 'จำนวนขาย' : 'Units sold'}</option><option value="revenue">{th ? 'ยอดก่อนส่วนลด' : 'Gross sales'}</option><option value="name">{th ? 'ชื่อสินค้า' : 'Product name'}</option></select></label></div><div className="mt-3 divide-y">{report.products.filter(p => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (!category || p.category === category)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'revenue' ? Number(b.revenue) - Number(a.revenue) : Number(b.qty || 0) - Number(a.qty || 0)).map(p => <div key={`${p.product_id}-${p.name}`} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3">{productImage(p)}<div className="min-w-0"><strong className="break-words">{p.name}</strong><p className="text-sm text-gray-500">{p.category}</p></div></div><div className="text-right text-sm"><strong>{p.qty || 0} {th ? 'ชิ้นขาย' : 'sold'} · {money(p.revenue)}</strong>{!!p.gifts && <p>{th ? 'ของแถม' : 'Gifts'} {p.gifts}</p>}</div></div>)}</div></section>
    </>}
  </div>;
}
