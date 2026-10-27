import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import {
  filterEventCatalogSetupProducts,
  type EventCatalogSetupDraft,
  type EventCatalogSetupProduct,
} from '../../lib/eventCatalogSetup';

interface SourceEvent { id: string; event_name: string; start_date: string; }

interface Props {
  artistId: string;
  events: SourceEvent[];
  language: string;
  value: EventCatalogSetupDraft;
  onChange: Dispatch<SetStateAction<EventCatalogSetupDraft>>;
  onProductsChange: (products: EventCatalogSetupProduct[]) => void;
  onReadyChange: (ready: boolean) => void;
}

const EventCatalogInitializer = ({ artistId, events, language, value, onChange, onProductsChange, onReadyChange }: Props) => {
  const th = language === 'th';
  const [products, setProducts] = useState<EventCatalogSetupProduct[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [bulkStock, setBulkStock] = useState('0');
  const [loadedSource, setLoadedSource] = useState('');
  const [productsReady, setProductsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setProductsReady(false);
    setError('');
    void (async () => {
      try {
        const [productResult, summaryResult] = await Promise.all([
          supabase.from('products').select('id, name, category, tags, is_unlimited').eq('artist_id', artistId).is('deleted_at', null).in('status', ['enable', 'soldout']).order('name'),
          supabase.rpc('list_product_stock_summaries', { p_artist_id: artistId }),
        ]);
        if (!active) return;
        if (productResult.error) throw productResult.error;
        if (summaryResult.error) throw summaryResult.error;
        const available = new Map<string, number>((summaryResult.data || []).map((row: { product_id: string; available: number }) => [row.product_id, Number(row.available || 0)]));
        const nextProducts: EventCatalogSetupProduct[] = (productResult.data || []).map((product) => ({
          ...product,
          available: product.is_unlimited ? Number.MAX_SAFE_INTEGER : available.get(product.id) || 0,
        }));
        setProducts(nextProducts);
        setProductsReady(true);
        onProductsChange(nextProducts);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [artistId, onProductsChange]);

  useEffect(() => {
    if (value.mode !== 'reuse' || !value.sourceEventId) return;
    let active = true;
    setError('');
    void (async () => {
      try {
        const { data, error: loadError } = await supabase.rpc('list_event_products', { p_event_id: value.sourceEventId });
        if (!active) return;
        if (loadError) throw loadError;
        const sourceIds = (data || []).map((row: { id: string }) => row.id);
        setLoadedSource(value.sourceEventId);
        onChange((current) => ({ ...current, selectedProductIds: sourceIds, allocations: {} }));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => { active = false; };
  }, [value.mode, value.sourceEventId, onChange]);

  useEffect(() => {
    onReadyChange(value.mode === 'empty' || (productsReady && !error && (value.mode !== 'reuse' || loadedSource === value.sourceEventId)));
  }, [value.mode, value.sourceEventId, productsReady, error, loadedSource, onReadyChange]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((product) => product.category || 'Other'))).sort()], [products]);
  const filtered = useMemo(() => filterEventCatalogSetupProducts(products, search, category), [products, search, category]);
  const selected = new Set(value.selectedProductIds);
  const selectedCount = value.selectedProductIds.length;
  const updateSelection = (productIds: string[], checked: boolean) => {
    const next = new Set(value.selectedProductIds);
    productIds.forEach((id) => checked ? next.add(id) : next.delete(id));
    onChange({ ...value, selectedProductIds: [...next] });
  };
  const applyBulkStock = (useAvailable = false) => {
    const requested = Math.max(0, Math.trunc(Number(bulkStock) || 0));
    const allocations = { ...value.allocations };
    filtered.forEach((product) => {
      if (selected.has(product.id) && !product.is_unlimited) allocations[product.id] = Math.min(useAvailable ? product.available : requested, product.available);
    });
    onChange({ ...value, allocations });
  };

  return <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4" aria-labelledby="event-catalog-setup-title">
    <div><h4 id="event-catalog-setup-title" className="font-black text-gray-900">{th ? 'สินค้าเริ่มต้นของงาน' : 'Starting event products'}</h4><p className="mt-1 text-xs font-semibold text-gray-600">{th ? 'เลือกเฉพาะรายการที่จะขายในงานนี้ สต็อกแบบนับจำนวนเริ่มที่ 0 จนกว่าจะจัดสรร' : 'Choose only what this event will sell. Tracked products start at 0 until allocated.'}</p></div>
    <div className="grid gap-2 sm:grid-cols-3">
      {(['empty', 'reuse', 'select'] as const).map((mode) => <button key={mode} type="button" aria-pressed={value.mode === mode} onClick={() => { if (value.mode !== mode) onChange({ ...value, mode, selectedProductIds: [], allocations: {} }); }} className={`min-h-11 rounded-lg border px-3 text-sm font-black ${value.mode === mode ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 bg-white text-gray-700'}`}>
        {mode === 'empty' ? (th ? 'เริ่มว่าง' : 'Start empty') : mode === 'reuse' ? (th ? 'ใช้รายการจากงานเดิม' : 'Reuse previous list') : (th ? 'เลือกจากแคตตาล็อก' : 'Choose from catalog')}
      </button>)}
    </div>
    {value.mode === 'empty' && <p className="rounded-lg bg-white p-3 text-xs font-semibold text-gray-600">{th ? 'งานจะยังไม่มีสินค้าขาย เพิ่มภายหลังได้จากหน้าสินค้าและสต็อกของงาน' : 'The event will have no products for sale. You can add them later from its catalog.'}</p>}
    {value.mode === 'reuse' && <div className="space-y-2"><label className="block text-xs font-black uppercase text-gray-600">{th ? 'งานต้นทาง' : 'Source event'}</label><select aria-label={th ? 'งานต้นทาง' : 'Source event'} value={value.sourceEventId} onChange={(event) => { setLoadedSource(''); onChange({ ...value, sourceEventId: event.target.value, selectedProductIds: [], allocations: {} }); }} className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 font-semibold"><option value="">{th ? 'เลือกงานเดิม' : 'Choose an event'}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.event_name}</option>)}</select><p className="text-xs font-semibold text-gray-600">{th ? `คัดลอกเฉพาะรายการที่เปิดขาย ${selectedCount} รายการ ไม่คัดลอกสต็อก ยอดขาย หรือยอดจอง ตรวจรายการและจัดสรรสต็อกใหม่ด้านล่าง` : `Copies ${selectedCount} enabled memberships only. Allocations, sold, and reserved counts are never copied. Review the list and allocate fresh stock below.`}</p></div>}
    {(value.mode === 'select' || (value.mode === 'reuse' && value.sourceEventId)) && <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]"><label className="relative"><Search size={16} className="absolute left-3 top-3.5 text-gray-400" aria-hidden="true"/><input type="search" aria-label={th ? 'ค้นหาสินค้า' : 'Search products'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? 'ค้นหาชื่อ หมวดหมู่ หรือแท็ก…' : 'Search name, category, or tag…'} className="min-h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3" /></label><select aria-label={th ? 'กรองหมวดหมู่' : 'Filter category'} value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3">{categories.map((item) => <option key={item} value={item}>{item === 'All' ? (th ? 'ทุกหมวดหมู่' : 'All categories') : item}</option>)}</select></div>
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => updateSelection(filtered.map((product) => product.id), true)} className="min-h-11 rounded-lg border border-pink-200 bg-white px-3 text-xs font-black text-pink-700">{th ? 'เลือกทั้งหมดที่กรอง' : 'Select all filtered'}</button><button type="button" onClick={() => updateSelection(filtered.map((product) => product.id), false)} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-xs font-black text-gray-700">{th ? 'ยกเลิกที่กรอง' : 'Clear filtered'}</button><span className="text-xs font-bold text-gray-500">{th ? `เลือกแล้ว ${selectedCount} รายการ` : `${selectedCount} selected`}</span></div>
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-2"><label className="text-xs font-black text-gray-600">{th ? 'จัดสรรสต็อกให้รายการที่เลือกและกำลังแสดง' : 'Allocate selected visible products'}<input type="number" min="0" step="1" value={bulkStock} onChange={(event) => setBulkStock(event.target.value)} className="mt-1 block min-h-11 w-28 rounded-lg border border-gray-200 px-3" /></label><button type="button" onClick={() => applyBulkStock()} className="min-h-11 rounded-lg bg-gray-900 px-3 text-xs font-black text-white">{th ? 'ใช้จำนวนนี้' : 'Apply quantity'}</button><button type="button" onClick={() => applyBulkStock(true)} className="min-h-11 rounded-lg border border-gray-200 px-3 text-xs font-black">{th ? 'ใช้ที่พร้อมจัดสรรทั้งหมด' : 'Use all available'}</button></div>
      <div className="max-h-64 divide-y overflow-y-auto rounded-lg border border-gray-200 bg-white">{filtered.map((product) => <div key={product.id} className="flex min-h-12 items-center gap-3 p-2"><input type="checkbox" aria-label={product.name} checked={selected.has(product.id)} onChange={(event) => updateSelection([product.id], event.target.checked)} className="h-4 w-4"/><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{product.name}</strong><span className="text-xs text-gray-500">{product.category || 'Other'} · {product.is_unlimited ? (th ? 'ไม่จำกัด' : 'Unlimited') : (th ? `พร้อมจัดสรร ${product.available}` : `${product.available} available`)}</span></div>{selected.has(product.id) && !product.is_unlimited && <input type="number" min="0" max={product.available} step="1" aria-label={`${th ? 'สต็อก' : 'Stock'} ${product.name}`} value={value.allocations[product.id] ?? ''} placeholder="0" onChange={(event) => { const allocations = { ...value.allocations }; if (event.target.value === '') delete allocations[product.id]; else allocations[product.id] = Math.min(product.available, Math.max(0, Math.trunc(Number(event.target.value) || 0))); onChange({ ...value, allocations }); }} className="min-h-11 w-20 rounded-lg border border-gray-200 px-2 text-center font-bold"/>}</div>)}{!filtered.length && <p className="p-4 text-center text-sm text-gray-500">{th ? 'ไม่พบสินค้า' : 'No matching products'}</p>}</div>
    </div>}
    {value.mode !== 'empty' && <p className="rounded-lg bg-white p-3 text-xs font-semibold text-gray-700">{th ? `สรุปก่อนสร้าง: เลือก ${selectedCount} รายการ · จัดสรรใหม่ ${products.filter(p => selected.has(p.id) && !p.is_unlimited).reduce((sum,p) => sum + (value.allocations[p.id] || 0), 0)} ชิ้น · รายการที่นับสต็อกแต่ยังไม่จัดสรรจะยังซื้อไม่ได้` : `Before creating: ${selectedCount} selected · ${products.filter(p => selected.has(p.id) && !p.is_unlimited).reduce((sum,p) => sum + (value.allocations[p.id] || 0), 0)} units newly allocated · Tracked items with no allocation cannot be bought.`}</p>}
    {loading && <p className="text-xs font-semibold text-gray-500">{th ? 'กำลังโหลดสินค้า…' : 'Loading products…'}</p>}
    {error && <p role="alert" className="text-xs font-bold text-red-600">{error}</p>}
  </section>;
};

export default EventCatalogInitializer;
