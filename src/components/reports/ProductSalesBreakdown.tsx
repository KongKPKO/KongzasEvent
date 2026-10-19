import { ChevronDown, ChevronLeft, ChevronRight, Download, PackageSearch, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  buildProductSalesCsv,
  downloadUtf8Csv,
  loadProductSalesImages,
  normalizeProductSalesReport,
  type ProductSalesDirection,
  type ProductSalesReportResult,
  type ProductSalesRow,
  type ProductSalesSort,
} from '../../lib/productSalesReport';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { supabase } from '../../supabaseClient';
import { formatPrice } from '../../utils/currency';
import { getMenuImageUrl } from '../../utils/imageUtils';

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 500;

const emptyResult: ProductSalesReportResult = {
  rows: [], total_count: 0, page: 1, page_size: PAGE_SIZE,
  categories: [], timezone: 'Asia/Bangkok', refund_allocation_available: false,
};

interface ProductSalesBreakdownProps {
  eventId: string;
  eventName: string;
  from: string;
  to: string;
  currency?: string;
}

interface ReportRequest {
  eventId: string;
  from: string;
  to: string;
  search: string;
  category: string;
  sort: ProductSalesSort;
  direction: ProductSalesDirection;
  page: number;
  pageSize: number;
  currency?: string;
}

async function requestReport(request: ReportRequest) {
  const { data, error } = await supabase.rpc('get_event_product_sales_report', {
    p_event_id: request.eventId,
    p_from: request.from || null,
    p_to: request.to || null,
    p_search: request.search || null,
    p_category: request.category || null,
    p_sort: request.sort,
    p_direction: request.direction,
    p_page: request.page,
    p_page_size: request.pageSize,
    p_currency: request.currency || null,
  });
  if (error) throw error;
  return normalizeProductSalesReport(data);
}

export default function ProductSalesBreakdown({ eventId, eventName, from, to, currency }: ProductSalesBreakdownProps) {
  const { language } = useI18n();
  const th = language === 'th';
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<ProductSalesSort>('net');
  const [direction, setDirection] = useState<ProductSalesDirection>('desc');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(emptyResult);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [gallery, setGallery] = useState<{ name: string; images: string[] } | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setImageError(false);
    setGallery(null);
    void requestReport({ eventId, from, to, search, category, sort, direction, page, pageSize: PAGE_SIZE, currency })
      .then(async (next) => {
        if (!active) return;
        setResult(next);
        try {
          const rows = await loadProductSalesImages(next.rows);
          if (active) setResult({ ...next, rows });
        } catch (imageLoadError) {
          console.error('[ProductSalesBreakdown] images failed:', imageLoadError);
          if (active) setImageError(true);
        }
        if (!active) return;
        if (category && !next.categories.includes(category)) setCategory('');
        if (next.total_count > 0 && page > Math.ceil(next.total_count / PAGE_SIZE)) setPage(1);
      })
      .catch((loadError) => {
        console.error('[ProductSalesBreakdown] fetch failed:', loadError);
        if (active) setError(true);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, currency, direction, eventId, from, page, search, sort, to]);

  const totalPages = Math.max(1, Math.ceil(result.total_count / PAGE_SIZE));
  const foundLabel = th
    ? `พบ ${result.total_count.toLocaleString('th-TH')} สินค้าหลัก`
    : `${result.total_count.toLocaleString('en-GB')} product${result.total_count === 1 ? '' : 's'} found`;
  const sortValue = `${sort}-${direction}`;
  const categoryLabel = (value: string) => value === 'Other' ? (th ? 'อื่น ๆ' : 'Other') : value;
  const dateSuffix = [from, to].filter(Boolean).join('-to-') || 'all-dates';
  const filenameBase = eventName.normalize('NFKD').replace(/[^a-zA-Z0-9ก-๙]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'event';

  const visibleRange = useMemo(() => {
    if (!result.total_count) return '';
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, result.total_count);
    return `${start.toLocaleString(th ? 'th-TH' : 'en-GB')}–${end.toLocaleString(th ? 'th-TH' : 'en-GB')}`;
  }, [page, result.total_count, th]);

  const changeSort = (value: string) => {
    const separator = value.lastIndexOf('-');
    setSort(value.slice(0, separator) as ProductSalesSort);
    setDirection(value.slice(separator + 1) as ProductSalesDirection);
    setPage(1);
  };

  const toggleExpanded = (familyId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(familyId)) next.delete(familyId); else next.add(familyId);
      return next;
    });
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(false);
    try {
      const first = await requestReport({ eventId, from, to, search, category, sort, direction, page: 1, pageSize: EXPORT_PAGE_SIZE, currency });
      const rows = [...first.rows];
      const pages = Math.ceil(first.total_count / EXPORT_PAGE_SIZE);
      for (let exportPage = 2; exportPage <= pages; exportPage += 1) {
        const next = await requestReport({ eventId, from, to, search, category, sort, direction, page: exportPage, pageSize: EXPORT_PAGE_SIZE, currency });
        rows.push(...next.rows);
      }
      downloadUtf8Csv(buildProductSalesCsv(rows, th ? 'th' : 'en'), `${filenameBase}-product-sales-${dateSuffix}.csv`);
    } catch (exportError) {
      console.error('[ProductSalesBreakdown] export failed:', exportError);
      setError(true);
    } finally {
      setExporting(false);
    }
  };

  return <section className="report-panel product-sales-breakdown" aria-labelledby="product-sales-heading">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 id="product-sales-heading" className="text-lg font-black text-gray-900">{th ? 'ยอดขายรายสินค้า' : 'Product sales breakdown'}</h2>
        <p className="mt-1 text-sm text-gray-600">{th ? 'รวมจากออเดอร์ที่สำเร็จ และใช้ชื่อสินค้าและราคาที่บันทึกตอนขาย' : 'Completed orders, using the name, product code and unit price saved at the time of sale.'}</p>
      </div>
      <button type="button" className="report-button shrink-0 gap-2" disabled={exporting || loading || result.total_count === 0} onClick={() => void exportCsv()}>
        <Download size={16} aria-hidden="true" />{exporting ? (th ? 'กำลังส่งออก…' : 'Exporting…') : (th ? 'ส่งออก CSV รายสินค้า' : 'Export product CSV')}
      </button>
    </div>

    <div className="report-filters mt-5">
      <label className="flex-1 basis-64">
        {th ? 'ค้นหาชื่อสินค้า' : 'Search products'}
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} aria-hidden="true" />
          <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="report-search-input" placeholder={th ? 'เช่น 2-Shot' : 'e.g. 2-Shot'} />
        </span>
      </label>
      <label className="flex-1 basis-48">
        {th ? 'หมวดหมู่' : 'Category'}
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
          <option value="">{th ? 'ทุกหมวดหมู่' : 'All categories'}</option>
          {result.categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
        </select>
      </label>
      <label className="flex-1 basis-52">
        {th ? 'เรียงตาม' : 'Sort by'}
        <select value={sortValue} onChange={(event) => changeSort(event.target.value)}>
          <option value="net-desc">{th ? 'ยอดขายสุทธิ มาก → น้อย' : 'Net sales, high to low'}</option>
          <option value="gross-desc">{th ? 'ยอดขายรวม มาก → น้อย' : 'Gross sales, high to low'}</option>
          <option value="quantity-desc">{th ? 'จำนวนขาย มาก → น้อย' : 'Units sold, high to low'}</option>
          <option value="name-asc">{th ? 'ชื่อสินค้า ก → ฮ' : 'Product name, A–Z'}</option>
          <option value="name-desc">{th ? 'ชื่อสินค้า ฮ → ก' : 'Product name, Z–A'}</option>
        </select>
      </label>
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600" aria-live="polite">
      <strong className="text-gray-800">{loading ? (th ? 'กำลังโหลด…' : 'Loading…') : foundLabel}</strong>
      {visibleRange && <span>{th ? 'แสดง' : 'Showing'} {visibleRange}</span>}
    </div>

    {imageError && <p role="status" className="mt-3 text-sm text-amber-800">{th ? 'โหลดรูปสินค้าเพิ่มเติมไม่สำเร็จ ลองโหลดหน้านี้ใหม่ได้ โดยยอดขายยังแสดงตามเดิม' : 'Additional product images could not load. Reload to retry; sales figures are still available.'}</p>}
    {gallery && <ReportGallery name={gallery.name} images={gallery.images} th={th} onClose={() => setGallery(null)} />}
    {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{th ? 'โหลดรายงานรายสินค้าไม่สำเร็จ กรุณาลองใหม่' : 'Could not load the product sales report. Please retry.'}</div>
      : !loading && result.rows.length === 0 ? <div className="mt-4 grid min-h-40 place-items-center rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <div><PackageSearch className="mx-auto mb-2 text-gray-400" aria-hidden="true" /><p className="font-bold text-gray-700">{th ? 'ไม่พบยอดขายสินค้าตามตัวกรองนี้' : 'No product sales match these filters'}</p><p className="mt-1 text-sm text-gray-500">{th ? 'ลองเปลี่ยนคำค้น หมวดหมู่ หรือช่วงวันที่' : 'Try a different search, category or date range.'}</p></div>
      </div> : <>
        <div className="product-sales-table-wrap mt-4 hidden md:block">
          <table className="product-sales-table">
            <thead><tr>
              <th scope="col">{th ? 'สินค้า' : 'Product'}</th>
              <th scope="col">{th ? 'หมวดหมู่' : 'Category'}</th>
              <th scope="col" className="numeric">{th ? 'จำนวน' : 'Units'}</th>
              <th scope="col" className="numeric">{th ? 'ยอดรวม' : 'Gross'}</th>
              <th scope="col" className="numeric">{th ? 'ส่วนลด' : 'Discount'}</th>
              <th scope="col" className="numeric">{th ? 'คืนเงิน*' : 'Refund*'}</th>
              <th scope="col" className="numeric">{th ? 'ยอดสุทธิ' : 'Net'}</th>
            </tr></thead>
            <tbody>{result.rows.map((row) => <DesktopRows key={row.family_id} row={row} expanded={expanded.has(row.family_id)} onToggle={() => toggleExpanded(row.family_id)} th={th} categoryLabel={categoryLabel} onGallery={setGallery} />)}</tbody>
          </table>
        </div>
        <div className="mt-4 space-y-3 md:hidden">{result.rows.map((row) => <MobileRow key={row.family_id} row={row} expanded={expanded.has(row.family_id)} onToggle={() => toggleExpanded(row.family_id)} th={th} categoryLabel={categoryLabel} onGallery={setGallery} />)}</div>
      </>}

    {totalPages > 1 && <nav className="mt-5 flex items-center justify-between gap-3" aria-label={th ? 'หน้ารายงานยอดขายรายสินค้า' : 'Product sales report pages'}>
      <button type="button" className="report-button gap-1" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={17} aria-hidden="true" />{th ? 'ก่อนหน้า' : 'Previous'}</button>
      <span className="text-sm font-bold text-gray-700">{th ? 'หน้า' : 'Page'} {page.toLocaleString(th ? 'th-TH' : 'en-GB')} / {totalPages.toLocaleString(th ? 'th-TH' : 'en-GB')}</span>
      <button type="button" className="report-button gap-1" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{th ? 'ถัดไป' : 'Next'}<ChevronRight size={17} aria-hidden="true" /></button>
    </nav>}

    <p className="mt-5 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-500">
      {th
        ? '* ระบบบันทึกการคืนเงินที่ระดับออเดอร์ จึงยังจัดสรรยอดคืนให้สินค้าแต่ละชิ้นอย่างเชื่อถือไม่ได้ ช่องคืนเงินจะแสดง “—” และยอดสุทธิรายสินค้าหักเฉพาะส่วนลดที่จัดสรรแล้ว หมวดหมู่และรูปใช้ข้อมูลแคตตาล็อกปัจจุบัน'
        : '* Refunds are recorded at order level, so they cannot be reliably allocated to individual products. Refund shows “—”, and product net deducts allocated discounts only. Category and image use the current catalog.'}
    </p>
  </section>;
}

type OpenGallery = (gallery: { name: string; images: string[] }) => void;

function ReportImage({ src, name = '' }: { src: string; name?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="grid h-full w-full place-items-center bg-gray-50 text-gray-400"><PackageSearch size={18} aria-hidden="true" /></span>
    : <img src={getMenuImageUrl(src)} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain" />;
}

function ImagePreview({ images, name, th, onGallery }: { images: string[]; name: string; th: boolean; onGallery: OpenGallery }) {
  if (!images.length) return <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gray-50 text-gray-300"><PackageSearch size={18} aria-hidden="true" /></span>;
  return <button type="button" className="report-image-preview" onClick={() => onGallery({ name, images })} aria-label={th ? `ดูรูปของ ${name} ทั้งหมด ${images.length} รูป` : `View all ${images.length} images of ${name}`}>
    <span className={`grid h-full w-full gap-px ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${images.length > 2 ? 'grid-rows-2' : ''}`}>
      {images.slice(0, 4).map(image => <span key={image} className="min-h-0 overflow-hidden"><ReportImage src={image} /></span>)}
    </span>
    {images.length > 4 && <span className="absolute bottom-0 right-0 rounded-tl bg-gray-900 px-1 text-[10px] font-bold text-white">+{images.length - 4}</span>}
  </button>;
}

function ReportGallery({ images, name, th, onClose }: { images: string[]; name: string; th: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const dialog = useDialogFocus<HTMLDialogElement>(true, () => dismiss());
  const dismiss = () => { dialog.current?.close(); onClose(); };
  useEffect(() => { dialog.current?.showModal(); }, [dialog]);
  const move = (delta: number) => setSelected(current => (current + delta + images.length) % images.length);
  return <dialog ref={dialog} className="report-image-dialog" aria-label={th ? `รูปสินค้า ${name}` : `Product images: ${name}`} onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target === event.currentTarget) dismiss(); }} onKeyDown={event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
  }}>
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-4"><h3 className="min-w-0 break-words font-bold">{name}</h3><button type="button" className="report-icon shrink-0" onClick={dismiss} aria-label={th ? 'ปิดรูปสินค้า' : 'Close product images'}><X size={20} /></button></div>
    <div className="report-image-stage"><ReportImage key={images[selected]} src={images[selected]} name={`${name} ${selected + 1}`} /></div>
    <div className="flex items-center justify-between gap-3 p-4"><button type="button" className="report-icon" disabled={images.length < 2} onClick={() => move(-1)} aria-label={th ? 'รูปก่อนหน้า' : 'Previous image'}><ChevronLeft size={20} /></button><span aria-live="polite">{selected + 1} / {images.length}</span><button type="button" className="report-icon" disabled={images.length < 2} onClick={() => move(1)} aria-label={th ? 'รูปถัดไป' : 'Next image'}><ChevronRight size={20} /></button></div>
  </dialog>;
}

function ProductIdentity({ row, th, onGallery }: { row: ProductSalesRow; th: boolean; onGallery: OpenGallery }) {
  return <div className="flex min-w-0 items-center gap-3">
    <ImagePreview images={row.images || (row.image_url ? [row.image_url] : [])} name={row.name} th={th} onGallery={onGallery} />
    <div className="min-w-0"><div className="break-words font-black text-gray-900">{row.name}</div>{row.has_variants && <div className="mt-0.5 text-xs text-gray-500">{row.variants.length} {th ? 'รายการสินค้า' : 'products'}</div>}</div>
  </div>;
}

function DesktopRows({ row, expanded, onToggle, th, categoryLabel, onGallery }: { row: ProductSalesRow; expanded: boolean; onToggle: () => void; th: boolean; categoryLabel: (value: string) => string; onGallery: OpenGallery }) {
  const detailId = `product-sales-${row.family_id}`;
  return <>
    <tr className="product-sales-parent-row">
      <td><div className="flex items-center gap-2">{row.has_variants ? <button type="button" className="report-icon shrink-0" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} aria-label={expanded ? (th ? `ซ่อนตัวเลือกของ ${row.name}` : `Collapse ${row.name} variants`) : (th ? `ดูตัวเลือกของ ${row.name}` : `Expand ${row.name} variants`)}><ChevronDown size={17} className={expanded ? '' : '-rotate-90'} aria-hidden="true" /></button> : <span className="w-11 shrink-0" />}<ProductIdentity row={row} th={th} onGallery={onGallery} /></div></td>
      <td>{categoryLabel(row.category)}</td><td className="numeric font-bold">{row.quantity.toLocaleString()}</td><td className="numeric">{formatPrice(row.gross, row.currency)}</td><td className="numeric">{formatPrice(row.discount, row.currency)}</td><td className="numeric text-gray-400">—</td><td className="numeric font-black">{formatPrice(row.net, row.currency)}</td>
    </tr>
    {expanded && row.has_variants && row.variants.map((variant, index) => <tr id={index === 0 ? detailId : undefined} key={variant.product_id} className="product-sales-variant-row">
      <td><div className="flex items-center gap-3 pl-14"><ImagePreview images={variant.images || []} name={variant.variant_name === 'Default' ? variant.name : variant.variant_name} th={th} onGallery={onGallery} /><div><div className="font-bold text-gray-800">{variant.variant_name === 'Default' ? variant.name : variant.variant_name}</div><div className="mt-0.5 text-xs text-gray-500">{variant.sku || (th ? 'ไม่มีรหัสสินค้า' : 'No product code')}</div></div></div></td>
      <td>{categoryLabel(row.category)}</td><td className="numeric">{variant.quantity.toLocaleString()}</td><td className="numeric">{formatPrice(variant.gross, row.currency)}</td><td className="numeric">{formatPrice(variant.discount, row.currency)}</td><td className="numeric text-gray-400">—</td><td className="numeric font-bold">{formatPrice(variant.net, row.currency)}</td>
    </tr>)}
  </>;
}

function MobileRow({ row, expanded, onToggle, th, categoryLabel, onGallery }: { row: ProductSalesRow; expanded: boolean; onToggle: () => void; th: boolean; categoryLabel: (value: string) => string; onGallery: OpenGallery }) {
  return <article className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3"><ProductIdentity row={row} th={th} onGallery={onGallery} /><div className="shrink-0 text-right"><div className="text-xs text-gray-500">{th ? 'ยอดสุทธิ' : 'Net'}</div><div className="font-black text-gray-900">{formatPrice(row.net, row.currency)}</div></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><span className="block text-xs text-gray-500">{th ? 'หมวดหมู่' : 'Category'}</span><strong>{categoryLabel(row.category)}</strong></div><div><span className="block text-xs text-gray-500">{th ? 'จำนวนขาย' : 'Units sold'}</span><strong>{row.quantity.toLocaleString()}</strong></div><div><span className="block text-xs text-gray-500">{th ? 'ยอดรวม' : 'Gross'}</span><strong>{formatPrice(row.gross, row.currency)}</strong></div><div><span className="block text-xs text-gray-500">{th ? 'ส่วนลด' : 'Discount'}</span><strong>{formatPrice(row.discount, row.currency)}</strong></div></div>
    {row.has_variants && <button type="button" className="report-button mt-3 w-full justify-between" aria-expanded={expanded} onClick={onToggle}><span>{expanded ? (th ? 'ซ่อนตัวเลือก' : 'Hide variants') : (th ? 'ดูตัวเลือก' : 'View variants')}</span><ChevronDown size={17} className={expanded ? '' : '-rotate-90'} aria-hidden="true" /></button>}
    {expanded && row.has_variants && <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">{row.variants.map((variant) => <div key={variant.product_id} className="py-3 text-sm"><div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-3"><ImagePreview images={variant.images || []} name={variant.variant_name === 'Default' ? variant.name : variant.variant_name} th={th} onGallery={onGallery} /><div><strong className="text-gray-900">{variant.variant_name === 'Default' ? variant.name : variant.variant_name}</strong><div className="text-xs text-gray-500">{variant.sku || (th ? 'ไม่มีรหัสสินค้า' : 'No product code')}</div></div></div><strong>{formatPrice(variant.net, row.currency)}</strong></div><div className="mt-1 text-xs text-gray-500">{variant.quantity.toLocaleString()} {th ? 'ชิ้น' : 'units'} · {th ? 'ยอดรวม' : 'gross'} {formatPrice(variant.gross, row.currency)} · {th ? 'ส่วนลด' : 'discount'} {formatPrice(variant.discount, row.currency)}</div></div>)}</div>}
  </article>;
}
