import { useI18n } from '../i18n';
import { formatDateInTimeZone } from '../utils/timezone';

export function matchesEventDate(value: string | null | undefined, from: string, to: string, timeZone: string): boolean {
  if (!from && !to) return true;
  const day = formatDateInTimeZone(value, timeZone);
  return Boolean(day) && (!from || day >= from) && (!to || day <= to);
}

export default function EventDateFilter({ from, to, timeZone, onChange }: {
  from: string; to: string; timeZone: string; onChange: (from: string, to: string) => void;
}) {
  const { language } = useI18n();
  const th = language === 'th';
  return <fieldset className="mb-5 min-w-0 rounded-xl border border-gray-200 bg-white p-4">
    <legend className="px-2 text-sm font-bold">{th ? 'ช่วงวันที่ขาย' : 'Sales date range'}</legend>
    <div className="mb-3 flex flex-wrap gap-2">
      <button type="button" className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-bold" onClick={() => { const day = formatDateInTimeZone(new Date().toISOString(), timeZone); onChange(day, day); }}>{th ? 'วันนี้' : 'Today'}</button>
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 flex-1 basis-40 gap-1 text-sm font-semibold">{th ? 'ตั้งแต่วันที่' : 'From date'}<input className="min-h-11 min-w-0 w-full rounded-lg border border-gray-200 px-3" type="date" value={from} max={to || undefined} onChange={event => onChange(event.target.value, to)} /></label>
      <label className="grid min-w-0 flex-1 basis-40 gap-1 text-sm font-semibold">{th ? 'ถึงวันที่' : 'To date'}<input className="min-h-11 min-w-0 w-full rounded-lg border border-gray-200 px-3" type="date" value={to} min={from || undefined} onChange={event => onChange(from, event.target.value)} /></label>
      <button type="button" className="min-h-11 whitespace-nowrap rounded-lg border border-gray-200 px-4 text-sm font-bold" onClick={() => onChange('', '')}>{th ? 'ทุกช่วงเวลา' : 'All dates'}</button>
    </div>
    <p className="mt-2 text-xs text-gray-500">{th ? 'นับตามวันที่สร้างรายการ รวมวันเริ่มและวันสิ้นสุด อ้างอิงเขตเวลา' : 'Based on creation date, including both selected days. Timezone:'} {timeZone}</p>
    {from && to && from > to && <p role="alert" className="mt-2 text-sm text-red-700">{th ? 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น' : 'End date must not be before start date.'}</p>}
  </fieldset>;
}
