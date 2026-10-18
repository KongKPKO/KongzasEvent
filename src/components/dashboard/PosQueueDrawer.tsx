import { useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useQueueOperations, type QueueTicket } from '../../hooks/useQueueOperations';

interface Props {
  eventId: string;
  queues: QueueTicket[];
  selectedQueueId: string | null;
  onUpdated: (id: string, changes: Partial<QueueTicket>) => void;
  onSelect: (queue: QueueTicket) => void;
  onClose: () => void;
  disabled: boolean;
}

export default function PosQueueDrawer({ eventId, queues, selectedQueueId, onUpdated, onSelect, onClose, disabled }: Props) {
  const { language } = useI18n();
  const th = language === 'th';
  const ref = useDialogFocus<HTMLDivElement>(true, onClose);
  const { action, callBatch, pending, error, retryBatchCount } = useQueueOperations(eventId, onUpdated);
  const blocked = pending || disabled;
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;
  const groups = [
    { key: 'arrived', title: th ? 'มาถึงแล้ว' : 'Arrived', tickets: queues.filter(q => q.status === 'calling' && q.arrived_at) },
    { key: 'serving', title: th ? 'กำลังให้บริการ' : 'Serving', tickets: queues.filter(q => q.status === 'serving') },
    { key: 'called', title: th ? 'เรียกแล้ว' : 'Called', tickets: queues.filter(q => q.status === 'calling' && !q.arrived_at) },
    { key: 'waiting', title: th ? 'รอเรียก' : 'Waiting', tickets: queues.filter(q => q.status === 'waiting' || q.status === 'queued') },
    { key: 'missed', title: th ? 'ไม่มาตามคิว / หมดเวลา' : 'Missed / expired', tickets: queues.filter(q => q.status === 'missed' || q.status === 'expired') },
  ];
  const openSale = async (ticket: QueueTicket) => {
    const selected = ticket.status === 'serving' ? ticket : await action(ticket, 'serving');
    if (selected && currentEvent.current === selected.event_id) { onSelect(selected); onClose(); }
  };
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="pos-queue-title" className="flex h-[100dvh] w-full max-w-xl flex-col bg-white shadow-xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 p-4"><h2 id="pos-queue-title" className="font-black text-gray-900">{th ? 'จัดการคิว' : 'Manage queues'}</h2><button type="button" className="min-h-11 min-w-11 rounded-xl border" onClick={onClose} aria-label={th ? 'ปิดจัดการคิว' : 'Close queue management'}><X className="mx-auto" size={20} /></button></header>
      <div className="shrink-0 border-b border-gray-100 p-4"><p className="mb-2 text-sm text-gray-600">{th ? 'เรียกคิวถัดไป เลือกขายให้คนที่มาถึงก่อนได้' : 'Call next tickets. Serve whoever arrives first.'}</p><div className="grid grid-cols-4 gap-2">{[1,3,5,10].map(count => <button key={count} type="button" className="min-h-11 rounded-xl border border-pink-200 bg-pink-50 text-sm font-bold text-pink-800 disabled:opacity-50" disabled={blocked || (retryBatchCount !== null ? retryBatchCount !== count : !groups[3].tickets.length)} onClick={() => void callBatch(count)}>{th ? `เรียก ${count} คน` : `Call ${count}`}</button>)}</div>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">{groups.map(group => <section key={group.key} aria-label={group.title}><h3 className="mb-2 font-bold">{group.title} ({group.tickets.length})</h3>{!group.tickets.length ? <p className="text-sm text-gray-400">{th ? 'ไม่มีคิว' : 'No tickets'}</p> : <ul className="space-y-2">{group.tickets.map(ticket => <li key={ticket.id} className={`rounded-xl border p-3 ${selectedQueueId === ticket.id ? 'border-pink-400 bg-pink-50' : 'border-gray-200'}`}><div className="mb-2 flex items-center justify-between"><strong className="text-xl">#{ticket.queue_number}</strong>{selectedQueueId === ticket.id && <span className="text-xs font-bold text-pink-700">{th ? 'กำลังเปิดขาย' : 'Current sale'}</span>}</div><div className="flex flex-wrap gap-2">
        {ticket.status === 'calling' && !ticket.arrived_at && <button type="button" disabled={blocked} className="min-h-11 rounded-lg border px-3 text-sm font-bold" onClick={() => void action(ticket, 'arrive')}>{th ? 'มาถึงแล้ว' : 'Mark arrived'}</button>}
        {(ticket.status === 'calling' || ticket.status === 'serving') && <button type="button" disabled={blocked} className="min-h-11 rounded-lg bg-pink-700 px-3 text-sm font-bold text-white disabled:opacity-50" onClick={() => void openSale(ticket)}>{th ? 'เปิดขายให้คิวนี้' : 'Open sale for this queue'}</button>}
        {ticket.status === 'calling' && <><button type="button" disabled={blocked} className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => void action(ticket, 'recall')}>{th ? 'เรียกซ้ำ' : 'Recall'}</button><button type="button" disabled={blocked} className="min-h-11 rounded-lg border px-3 text-sm text-red-700" onClick={() => void action(ticket, 'missed')}>{th ? 'ไม่มาตามคิว' : 'Mark missed'}</button></>}
        {(ticket.status === 'missed' || ticket.status === 'expired') && <button type="button" disabled={blocked} className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => void action(ticket, 'waiting')}>{th ? 'กลับไปรอเรียก' : 'Return to waiting'}</button>}
      </div></li>)}</ul>}</section>)}</div>
    </div>
  </div>;
}
