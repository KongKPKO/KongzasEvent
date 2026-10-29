import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Settings2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { listPromotionDefinitions, PromotionSaveConflict, saveEventPromotionSelection, toPromotionError, type SaveEventPromotionSelectionInput } from '../../lib/promotions';
import { promotionLocalDateTime } from '../../lib/promotionDateTime';
import type { PromotionCombinationPolicy, PromotionDefinition, PromotionEventPhase } from '../../types/promotion';
import { promotionV1RuleText, type PromotionEditorProduct } from './PromotionV1Editor';
import './promotion-workspace.css';

const phases: PromotionEventPhase[] = ['preorder', 'live', 'postorder'];
type PhaseDraft = { enabled: boolean; start: string; end: string; policy: PromotionCombinationPolicy };

export default function EventPromotionPicker({ artistId, eventId, eventName, products }: { artistId: string; eventId: string; eventName: string; products: PromotionEditorProduct[] }) {
  const { language } = useI18n();
  const th = language === 'th';
  const [definitions, setDefinitions] = useState<PromotionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PromotionDefinition | null>(null);
  const [draft, setDraft] = useState<Partial<Record<PromotionEventPhase, PhaseDraft>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const returnFocusId = useRef<string | null>(null);

  useEffect(() => {
    // Wait until React has re-enabled the row action before restoring focus.
    if (!editing && !saving && returnFocusId.current) {
      document.getElementById(`event-promotion-${returnFocusId.current}`)?.focus();
      returnFocusId.current = null;
    }
  }, [editing, saving]);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false); setEditing(null); setMessage(''); setError('');
    void listPromotionDefinitions(artistId).then(data => { if (active) setDefinitions(data); }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [artistId, eventId]);

  const phaseName = (phase: PromotionEventPhase) => phase === 'preorder' ? (th ? 'ก่อนงาน · พรีออเดอร์' : 'Pre-order') : phase === 'live' ? (th ? 'ขายวันงาน' : 'Live event') : (th ? 'หลังจบงาน' : 'Post-order');
  const open = (definition: PromotionDefinition) => {
    setEditing(definition); setError(''); setMessage('');
    setDraft(Object.fromEntries(phases.map(phase => {
      const current = definition.assignments.find(item => item.event_id === eventId && item.event_phase === phase);
      return [phase, { enabled: current ? !current.is_paused : false, start: promotionLocalDateTime(current?.starts_at), end: promotionLocalDateTime(current?.ends_at), policy: current?.combination_policy || 'combine' }];
    })));
  };
  const close = () => {
    returnFocusId.current = editing?.id || null; setEditing(null); setError('');
  };
  const update = (phase: PromotionEventPhase, change: Partial<PhaseDraft>) => setDraft(current => ({ ...current, [phase]: { ...current[phase]!, ...change } }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || saving) return;
    for (const phase of phases) {
      const value = draft[phase]!;
      if (value.enabled && ((value.start && !Number.isFinite(new Date(value.start).getTime())) || (value.end && !Number.isFinite(new Date(value.end).getTime())) || (value.start && value.end && new Date(value.start) >= new Date(value.end)))) {
        setError(th ? 'เวลาเริ่มต้องมาก่อนเวลาสิ้นสุด และต้องเป็นวันเวลาที่ถูกต้อง' : 'Enter valid dates with the start before the end.'); return;
      }
    }
    const assignments: SaveEventPromotionSelectionInput['assignments'] = [];
    for (const phase of phases) {
      const value = draft[phase]!;
      const current = editing.assignments.find(item => item.event_id === eventId && item.event_phase === phase);
      if (!value.enabled) continue;
      const instant = (input: string, original: string | null | undefined) => input === promotionLocalDateTime(original) ? original || null : input ? new Date(input).toISOString() : null;
      assignments.push({ event_phase: phase, starts_at: instant(value.start, current?.starts_at), ends_at: instant(value.end, current?.ends_at), combination_policy: value.policy });
    }
    const payload: SaveEventPromotionSelectionInput = { eventId, promotionId: editing.id, expectedRevision: editing.revision, assignments };
    setSaving(true); setError('');
    try {
      try { await saveEventPromotionSelection(payload); }
      catch (failure) {
        if (!(failure instanceof PromotionSaveConflict)) throw failure;
        if (!window.confirm(th ? `โปรนี้ชนกับ ${failure.promotionNames.join(', ')}\nยืนยันใช้กติกาการใช้ร่วมกันที่เลือกไว้?` : `This overlaps ${failure.promotionNames.join(', ')}. Confirm the selected combination rules?`)) {
          setError(th ? 'ยังไม่ได้บันทึก การใช้งานเดิมไม่เปลี่ยน' : 'Not saved. Existing assignments are unchanged.'); return;
        }
        await saveEventPromotionSelection({ ...payload, confirmationToken: failure.token });
      }
      const latest = await listPromotionDefinitions(artistId);
      setDefinitions(latest); close(); setMessage(th ? 'บันทึกการใช้งานในอีเวนต์นี้แล้ว' : 'Event promotion settings saved.');
    } catch (failure) {
      const code = toPromotionError(failure).code;
      setError(code === 'promotion_changed' ? (th ? 'โปรโมชั่นเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนเลือกใช้อีกครั้ง' : 'The promotion changed. Reload before trying again.') : (th ? 'ยืนยันผลการบันทึกไม่ได้ กรุณาโหลดหน้าใหม่เพื่อตรวจสถานะและสินค้าในอีเวนต์' : 'Could not confirm the save. Reload to check the current settings and event products.'));
    } finally { setSaving(false); }
  };

  const visible = definitions.filter(item => item.lifecycle_status !== 'archived' && (item.name || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="promotion-workspace" aria-label={th ? 'เลือกโปรโมชั่นในอีเวนต์' : 'Event promotion selection'}>
    <div className="promotion-toolbar"><div><h3>{th ? 'โปรโมชั่นในอีเวนต์' : 'Event promotions'}</h3><p className="promotion-help">{th ? `เลือกโปรโมชั่นของร้านมาใช้ใน ${eventName} และกำหนดช่วงใช้งานของงานนี้` : `Choose store promotions for ${eventName} and set this event’s schedule.`}</p></div><Link className="promotion-button" to="/manage-promotions">{th ? 'จัดการโปรโมชั่นของร้าน' : 'Manage store promotions'}</Link></div>
    <p className="promotion-context">{th ? 'สร้างและแก้เงื่อนไขโปรโมชั่นที่เมนูโปรโมชั่นของร้าน การเลือกที่นี่เปลี่ยนเฉพาะอีเวนต์นี้ ออเดอร์เดิมคงราคาเดิม' : 'Create and edit offers in Store promotions. Selection here affects only this event; existing orders keep their prices.'}</p>
    {message && <p role="status" className="promotion-notice">{message}</p>}
    {loading ? <p role="status" className="promotion-empty"><Loader2 className="animate-spin" size={20} />{th ? 'กำลังโหลดโปรโมชั่น…' : 'Loading promotions…'}</p> : loadError ? <div role="alert"><p>{th ? 'โหลดโปรโมชั่นไม่สำเร็จ' : 'Could not load promotions.'}</p><button className="promotion-button" onClick={() => window.location.reload()}>{th ? 'ลองใหม่' : 'Retry'}</button></div> : <>
      <label className="promotion-label">{th ? 'ค้นหาโปรโมชั่น' : 'Search promotions'}<input disabled={saving} type="search" className="promotion-input" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {!visible.length && <p className="promotion-empty">{th ? (definitions.some(item => item.lifecycle_status !== 'archived') ? 'ไม่พบโปรโมชั่นที่ค้นหา' : 'ยังไม่มีโปรโมชั่น สร้างที่เมนูโปรโมชั่นของร้านก่อน แล้วกลับมาเลือกใช้ที่นี่') : 'No promotions found. Create offers in Store promotions, then select them here.'}</p>}
      <div className="promotion-list">{visible.map(definition => {
        const selected = definition.assignments.filter(item => item.event_id === eventId && !item.is_paused);
        return <article className="promotion-saved" key={definition.id}>
          <div className="promotion-toolbar"><div><p className="promotion-help">{selected.length ? (th ? 'เลือกใช้ในอีเวนต์นี้แล้ว' : 'Selected for this event') : (th ? 'ยังไม่ได้เลือกใช้' : 'Not selected')}</p><h4>{definition.name}</h4></div><button id={`event-promotion-${definition.id}`} className="promotion-button" disabled={saving || definition.lifecycle_status !== 'ready'} onClick={() => open(definition)}><Settings2 size={16} />{selected.length ? (th ? 'ตั้งค่าการใช้งาน' : 'Usage settings') : (th ? 'เลือกใช้' : 'Select promotion')}</button></div>
          <p className="promotion-saved-rule">{definition.v1_config ? promotionV1RuleText(definition.v1_config, products, th) : definition.promotion_type === 'quantity_discount' ? (th ? `ทุก ${definition.buy_quantity} ชิ้น ลด ฿${definition.reward_value}` : `Every ${definition.buy_quantity} items, save ฿${definition.reward_value}`) : definition.promotion_type === 'quantity_gift' ? (th ? `ทุก ${definition.buy_quantity} ชิ้น รับฟรี ${definition.reward_quantity} ชิ้น` : `Every ${definition.buy_quantity} items, get ${definition.reward_quantity} free`) : definition.promotion_type === 'spend_tier_gift' ? (th ? 'รับของแถมตามยอดซื้อ' : 'Gifts by spending tier') : ''}</p>
          <p className="promotion-help">{selected.map(item => phaseName(item.event_phase!)).join(' · ')}</p>
          {definition.lifecycle_status !== 'ready' && <p className="promotion-help">{th ? 'บันทึกรายละเอียดที่เมนูโปรโมชั่นของร้านให้เรียบร้อยก่อนเลือกใช้' : 'Complete this offer in Store promotions before selecting it.'}</p>}
          {editing?.id === definition.id && <form onSubmit={save} aria-label={th ? `เลือกใช้ ${definition.name}` : `Assign ${definition.name}`}>
            <fieldset disabled={saving} className="space-y-3"><legend className="promotion-label">{th ? 'ช่วงที่ใช้โปรโมชั่น' : 'Promotion phases'}</legend>
              {phases.map(phase => <div className="promotion-assignment" key={phase}><label className="promotion-channel"><input type="checkbox" checked={draft[phase]?.enabled || false} onChange={event => update(phase, { enabled: event.target.checked })} />{phaseName(phase)}</label>
                {draft[phase]?.enabled && <div className="grid gap-3 md:grid-cols-3"><label className="promotion-label">{th ? 'เริ่มใช้งาน (ไม่บังคับ)' : 'Starts at (optional)'}<input className="promotion-input" type="datetime-local" value={draft[phase]!.start} onChange={event => update(phase, { start: event.target.value })} /></label><label className="promotion-label">{th ? 'สิ้นสุด (ไม่บังคับ)' : 'Ends at (optional)'}<input className="promotion-input" type="datetime-local" value={draft[phase]!.end} onChange={event => update(phase, { end: event.target.value })} /></label><label className="promotion-label">{th ? 'ใช้ร่วมกับโปรโมชั่นอื่น' : 'Combining offers'}<select className="promotion-input" value={draft[phase]!.policy} onChange={event => update(phase, { policy: event.target.value as PromotionCombinationPolicy })}><option value="exclusive">{th ? 'ไม่ใช้ร่วมกัน' : 'Exclusive'}</option><option value="combine">{th ? 'ใช้ร่วมกันได้' : 'Combine'}</option></select></label></div>}
              </div>)}
              <p className="promotion-help">{th ? `เวลาแสดงตาม ${Intl.DateTimeFormat().resolvedOptions().timeZone} ใช้ได้เมื่อช่องทางนั้นเปิดขาย ปิดทุกช่วงเพื่อหยุดใช้กับออเดอร์ใหม่ของงานนี้` : `Times use ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Offers apply while the channel is open. Uncheck all phases to stop new use in this event.`}</p>
              {error && <p role="alert" className="promotion-notice">{error}</p>}
              <div className="promotion-actions"><button className="promotion-button promotion-primary" type="submit">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{th ? 'บันทึกการเลือกใช้' : 'Save event selection'}</button><button className="promotion-button" type="button" onClick={close}>{th ? 'ยกเลิก' : 'Cancel'}</button></div>
            </fieldset>
          </form>}
        </article>;
      })}</div>
    </>}
  </section>;
}
