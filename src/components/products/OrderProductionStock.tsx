import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n';

interface ProductionOrderStock { order_id: string; required: number; allocated: number; fulfilled: number; shortfall: number; tracking: boolean }
export function useProductionOrderStock(eventId: string | undefined, campaignId: string | undefined, revision: string) {
  const [rows, setRows] = useState<Record<string, ProductionOrderStock>>({});
  const [error, setError] = useState(false);
  const [focus, setFocus] = useState(0);
  const refresh = useCallback(() => setFocus(value => value+1), []);
  useEffect(() => { window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [refresh]);
  useEffect(() => {
    if (!eventId && !campaignId) return;
    const channel = supabase.channel(`production-stock-${eventId || campaignId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: eventId ? 'event_products' : 'online_campaign_products', filter: eventId ? `event_id=eq.${eventId}` : `campaign_id=eq.${campaignId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [eventId, campaignId, refresh]);
  useEffect(() => {
    if (!eventId && !campaignId) return;
    let active = true; setRows({}); setError(false);
    void supabase.rpc('production_order_stock', { p_event_id: eventId || null, p_campaign_id: campaignId || null }).then(({ data, error: failure }) => {
      if (!active) return;
      if (failure || !Array.isArray(data)) { setError(true); return; }
      setRows(Object.fromEntries(((data || []) as ProductionOrderStock[]).map(row => [row.order_id, row])));
    }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [eventId, campaignId, revision, focus]);
  return { rows, error };
}
export function OrderProductionStock({ value, error }: { value?: ProductionOrderStock; error?: boolean }) {
  const { language } = useI18n(); const th = language === 'th';
  if (error) return <p role="alert" className="mt-2 text-xs font-bold text-red-700">{th ? 'โหลดความพร้อมสต็อกไม่สำเร็จ กรุณารีเฟรชก่อนส่งมอบ' : 'Could not load stock readiness. Refresh before fulfillment.'}</p>;
  if (!value) return null;
  return <p className={`mt-2 rounded-lg p-2 text-xs font-bold ${value.shortfall>0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
    {th ? `รับสั่งผลิต ${value.required} · กันของแล้ว ${value.allocated} · ส่งมอบแล้ว ${value.fulfilled} · ยังขาด ${value.shortfall}` : `Made to order ${value.required} · earmarked ${value.allocated} · fulfilled ${value.fulfilled} · shortfall ${value.shortfall}`}
    {!value.tracking && <span className="block">{th ? 'สินค้าบางรายการไม่นับสต็อก ตรวจของจริงก่อนส่งมอบ' : 'Some items are untracked. Check physical units before fulfillment.'}</span>}
  </p>;
}
