import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useI18n } from '../../i18n';

export interface SupplySettings {
  preorder_supply_mode?: 'stock' | 'production';
  preorder_production_limit?: number | null;
  postorder_supply_mode?: 'stock' | 'production';
  postorder_production_limit?: number | null;
  supply_mode?: 'stock' | 'production';
  production_limit?: number | null;
}

export function SupplyPolicyEditor({ productId, eventId, campaignId, settings, onSaved }: {
  productId: string; eventId?: string; campaignId?: string; settings: SupplySettings; onSaved?: () => void;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const phases = eventId ? ['preorder', 'postorder'] as const : ['campaign'] as const;
  const save = async (phase: typeof phases[number]) => {
    const mode = phase === 'campaign' ? draft.supply_mode || 'stock' : draft[`${phase}_supply_mode`] || 'stock';
    const limit = phase === 'campaign' ? draft.production_limit : draft[`${phase}_production_limit`];
    if (limit != null && (!Number.isInteger(limit) || limit <= 0)) { setMessage(th ? 'กรอกเพดานเป็นจำนวนเต็มมากกว่า 0 หรือเลือกไม่จำกัด' : 'Enter a positive whole-number cap or choose unlimited.'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await supabase.rpc('configure_product_supply', { p_product_id: productId, p_event_id: eventId || null, p_campaign_id: campaignId || null, p_phase: phase, p_mode: mode, p_limit: limit ?? null, p_expected: { mode: phase === 'campaign' ? saved.supply_mode || 'stock' : saved[`${phase}_supply_mode`] || 'stock', limit: (phase === 'campaign' ? saved.production_limit : saved[`${phase}_production_limit`]) ?? null } });
      if (error) throw error;
      setSaved(current => phase === 'campaign' ? { ...current, supply_mode: mode, production_limit: limit } : { ...current, [`${phase}_supply_mode`]: mode, [`${phase}_production_limit`]: limit }); setMessage(th ? 'บันทึกวิธีขายแล้ว ออเดอร์เดิมใช้เงื่อนไขเดิม' : 'Saved. Existing orders keep their original supply policy.');
      onSaved?.();
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
      setMessage(detail.includes('supply_policy_changed_reload') ? (th ? 'วิธีขายถูกแก้จากอุปกรณ์อื่น กรุณาโหลดหน้าใหม่ก่อนบันทึก' : 'Policy changed on another device. Reload before saving.') : detail.includes('production_limit_below_orders') ? (th ? 'เพดานต้องไม่น้อยกว่ายอดที่รับออเดอร์ไว้แล้ว' : 'The cap cannot be below accepted orders.') : (th ? `บันทึกไม่สำเร็จ: ${detail}` : `Could not save: ${detail}`));
    } finally { setBusy(false); }
  };
  return <details className="mt-2 rounded-xl border border-pink-100 bg-white p-2 text-xs" onClick={e => e.stopPropagation()}>
    <summary className="min-h-11 cursor-pointer py-3 font-bold text-pink-700">{th ? 'วิธีขาย / รับสั่งผลิต' : 'Supply / made to order'}<span className="block text-[10px] text-gray-500">{eventId ? `Preorder: ${saved.preorder_supply_mode === 'production' ? (th ? 'รับสั่งผลิต' : 'Production') : (th ? 'สต็อก' : 'Stock')} · Postorder: ${saved.postorder_supply_mode === 'production' ? (th ? 'รับสั่งผลิต' : 'Production') : (th ? 'สต็อก' : 'Stock')}` : saved.supply_mode === 'production' ? (th ? 'รับสั่งผลิต' : 'Production') : (th ? 'ขายจากสต็อก' : 'Stock')}</span></summary>
    <p className="mb-2 text-gray-500">{th ? 'วันงานขายจากสต็อกเดิม ตั้งรับสั่งผลิตแยกสำหรับก่อนและหลังงานได้' : 'Live sales use existing stock. Pre/post-order can accept production orders.'}</p>
    {phases.map(phase => {
      const modeKey = phase === 'campaign' ? 'supply_mode' : `${phase}_supply_mode` as const;
      const limitKey = phase === 'campaign' ? 'production_limit' : `${phase}_production_limit` as const;
      const mode = draft[modeKey] || 'stock'; const limit = draft[limitKey];
      const changed = (saved[modeKey] || 'stock') !== mode || (saved[limitKey] ?? null) !== (limit ?? null);
      return <fieldset key={phase} disabled={busy} className="mb-3 space-y-2 border-t border-gray-100 pt-2">
        <legend className="font-black">{phase === 'preorder' ? 'Preorder' : phase === 'postorder' ? 'Postorder' : (th ? 'ร้านออนไลน์' : 'Online shop')}</legend>
        <label className="block">{th ? 'วิธีขาย' : 'Supply policy'}<select aria-label={`${phase} supply policy`} value={mode} onChange={e => setDraft(current => ({ ...current, [modeKey]: e.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border p-2">
          <option value="stock">{th ? 'ขายจากสต็อก / ตามการนับของแคตตาล็อก' : 'Sell from catalog stock'}</option>
          <option value="production">{th ? 'รับสั่งผลิต — แยกจากสต็อกจริง' : 'Made to order — separate from physical stock'}</option>
        </select></label>
        {mode === 'production' && <>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={limit == null} onChange={e => setDraft(current => ({ ...current, [limitKey]: e.target.checked ? null : 1 }))} />{th ? 'ไม่จำกัดยอดรับสั่งผลิต' : 'Unlimited production orders'}</label>
          {limit != null && <label className="block">{th ? 'รับสั่งผลิตสูงสุด (รวมยอดที่รับไว้แล้ว)' : 'Production cap (including accepted orders)'}<input aria-label={`${phase} production cap`} type="number" min="1" step="1" value={limit} onChange={e => setDraft(current => ({ ...current, [limitKey]: Number(e.target.value) }))} className="mt-1 min-h-11 w-full rounded-lg border p-2" /></label>}
          <p className="text-gray-500">{th ? 'ไม่ดึงของพร้อมขายเดิม เมื่อรับสินค้าเข้าใหม่จะกันให้ยอดยืนยันก่อน หรือร้านเลือกกันของเดิมเองได้' : 'Existing ready stock stays separate. New receipts earmark confirmed orders first; you may also earmark ready units explicitly.'}</p>
        </>}
        <button type="button" disabled={busy || !changed} onClick={() => void save(phase)} className="min-h-11 rounded-lg bg-pink-600 px-3 font-bold text-white disabled:opacity-40">{busy ? (th ? 'กำลังบันทึก…' : 'Saving…') : (th ? 'บันทึกวิธีขาย' : 'Save policy')}</button>
      </fieldset>;
    })}
    {message && <p role="status" className="font-semibold text-gray-700">{message}</p>}
  </details>;
}
