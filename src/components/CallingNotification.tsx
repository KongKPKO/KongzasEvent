import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, ChevronRight, Coffee, Info, AlertTriangle, PauseCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatDateInTimeZone } from '../utils/timezone';
import {
  TICKET_UPDATED_EVENT,
  clearStoredTicketId,
  getStoredTicketId,
  ticketStorageKey,
} from '../utils/customerEvents';

interface CallingNotificationProps {
  artistId: string;
  slug: string;
  broadcastMessage?: string;
}

const CallingNotification = ({ artistId, slug, broadcastMessage: initialBroadcastMessage }: CallingNotificationProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isCalling, setIsCalling] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [queueingArea, setQueueingArea] = useState<string | null>(null);
  
  // State สำหรับเก็บข้อความ Broadcast
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(initialBroadcastMessage || null);

  const isTicketFromToday = (ticket: any) => {
    if (!ticket?.queue_service_date) return true;
    const eventData = Array.isArray(ticket.events) ? ticket.events[0] : ticket.events;
    const eventTimeZone = eventData?.event_timezone || 'Asia/Bangkok';
    return ticket.queue_service_date === formatDateInTimeZone(new Date(), eventTimeZone);
  };

  const fetchQueueingArea = async (eventId?: string | null) => {
    if (!eventId) {
      setQueueingArea(null);
      return;
    }

    const { data } = await supabase
      .from('events')
      .select('queueing_area')
      .eq('id', eventId)
      .maybeSingle();

    setQueueingArea(data?.queueing_area || null);
  };

  // 1. โหลดข้อมูลเริ่มต้น
  useEffect(() => {
    if (!artistId) return;

    // 1.1 ดึง Broadcast ล่าสุด
    const fetchBroadcast = async () => {
      const { data } = await supabase
        .from('artists')
        .select('broadcast_message')
        .eq('id', artistId)
        .maybeSingle();
      if (data) setBroadcastMessage(data.broadcast_message);
    };
    fetchBroadcast();

    // 1.2 ดึงสถานะ Ticket ตัวเองจาก LocalStorage (Namespaced by Artist ID)
    const storedTicketId = getStoredTicketId(artistId);

    if (storedTicketId) {
      setTicketId(storedTicketId);
      const fetchTicketStatus = async () => {
        const { data } = await supabase
            .from('queues')
            .select('status, queue_number, event_id, queue_service_date, events(event_timezone)')
            .eq('id', storedTicketId)
            .maybeSingle();

        // รองรับทั้ง serving และ calling
        if (data && isTicketFromToday(data) && (data.status === 'serving' || data.status === 'calling')) {
          setIsCalling(true);
          setTicketNumber(data.queue_number);
          await fetchQueueingArea(data.event_id);
        } else {
          if (data && !isTicketFromToday(data)) {
            clearStoredTicketId(artistId);
          }
          setQueueingArea(null);
        }
      };
      fetchTicketStatus();
    }
  }, [artistId]);

  // 2. Keep ticketId in sync when the customer joins the queue in the same tab
  //    or in a different tab.
  //
  //    Problem: the initialisation effect above (dep: [artistId]) runs once on
  //    mount. If no ticket exists yet, ticketId stays null and the realtime
  //    subscription below is never created.  When QueueView later writes the
  //    ticket to localStorage, artistId has not changed, so the init effect
  //    never re-runs.
  //
  //    Solution:
  //    - QueueView dispatches TICKET_UPDATED_EVENT (CustomEvent) immediately after
  //      localStorage.setItem so we catch the same-tab case.
  //    - The native 'storage' StorageEvent fires automatically for cross-tab
  //      writes; we filter it to our specific key.
  //
  //    Both paths call syncTicketFromStorage, which re-reads localStorage and
  //    updates ticketId state only when the value actually changed.
  useEffect(() => {
    if (!artistId) return;

    const storageKey = ticketStorageKey(artistId);

    const syncTicketFromStorage = () => {
      const stored = getStoredTicketId(artistId);
      // Functional update avoids stale-closure comparison and
      // skips a re-render when the value hasn't changed.
      setTicketId((prev) => (stored !== prev ? stored : prev));
    };

    // Same-tab: dispatched by QueueView right after the localStorage write.
    window.addEventListener(TICKET_UPDATED_EVENT, syncTicketFromStorage);

    // Cross-tab: the browser fires 'storage' when a different tab modifies
    // localStorage.  Filter to our exact key so unrelated writes are ignored.
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === storageKey) syncTicketFromStorage();
    };
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener(TICKET_UPDATED_EVENT, syncTicketFromStorage);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [artistId]);

  // 3. Realtime Listener
  useEffect(() => {
    let ticketChannel: any = null;
    
    // ฟัง Ticket ของเรา
    if (ticketId) {
       ticketChannel = supabase.channel(`my-ticket-notification:${ticketId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${ticketId}` }, (payload) => {
            if (!payload.new) return;
            if (payload.new.status === 'serving' || payload.new.status === 'calling') {
              setIsCalling(true);
              setTicketNumber(payload.new.queue_number);
              void fetchQueueingArea(payload.new.event_id);
              if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            } else {
              setIsCalling(false);
              setQueueingArea(null);
            }
        })
        .subscribe();
    }

    // ฟัง Broadcast ส่วนกลาง
    const broadcastChannel = supabase.channel(`artist-broadcast-notification:${artistId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` }, (payload) => {
          if (!payload.new) return;
          setBroadcastMessage(payload.new.broadcast_message);
      })
      .subscribe();

    return () => {
      if (ticketChannel) supabase.removeChannel(ticketChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [ticketId, artistId]);


  // 🎨 RENDER LOGIC
  const proceedDestination = queueingArea?.trim();
  const proceedMessage = proceedDestination
    ? `Please proceed to ${proceedDestination}`
    : t('notificationProceedBooth');
  
  // Priority 1: Calling Notification
  if (isCalling) {
    const accessibleLabel = `${t('notificationYourTurn')}. ${t('notificationQueue')} ${ticketNumber}. ${proceedMessage}`;

    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
        <button 
          onClick={() => navigate(`/${slug}/queue`)}
          className="pointer-events-auto w-full max-w-md bg-yellow-400 text-yellow-900 rounded-b-2xl shadow-xl shadow-yellow-400/20 py-3 px-4 flex items-center justify-between cursor-pointer border-b-2 border-x-2 border-yellow-200 animate-bounce-in text-left appearance-none"
          aria-live="assertive"
          aria-atomic="true"
          aria-label={accessibleLabel}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-white/90 p-2 rounded-full shadow-sm animate-pulse flex-shrink-0" aria-hidden="true">
              <Bell size={18} className="text-yellow-600 fill-yellow-600" />
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span className="font-black text-sm text-yellow-950 uppercase tracking-wide leading-tight" aria-hidden="true">
                {t('notificationYourTurn')}
              </span>
              <span className="text-xs font-semibold text-yellow-800 truncate leading-tight" aria-hidden="true">
                 {t('notificationQueue')} <span className="font-black text-sm text-yellow-950">#{ticketNumber}</span> {proceedMessage}
              </span>
            </div>
          </div>
          <div className="bg-white/40 p-1 rounded-full flex-shrink-0 ml-2" aria-hidden="true">
             <ChevronRight size={16} className="text-yellow-900" />
          </div>
        </button>
      </div>
    );
  }

  // Priority 2: Broadcast Message
  if (broadcastMessage) {
    const msg = broadcastMessage.toLowerCase();
    
    let theme = "bg-blue-500 border-blue-400 shadow-blue-500/20 text-white"; 
    let Icon = Info;
    let iconColor = "text-white";

    if (msg.includes('พัก') || msg.includes('break')) {
        theme = "bg-pink-500 border-pink-400 shadow-pink-500/20 text-white";
        Icon = Coffee;
    } else if (msg.includes('ด่วน') || msg.includes('urgent') || msg.includes('sorry')) {
        theme = "bg-orange-500 border-orange-400 shadow-orange-500/20 text-white";
        Icon = AlertTriangle;
    } else if (msg.includes('หยุด') || msg.includes('stop') || msg.includes('closed') || msg.includes('pause')) {
        theme = "bg-gray-200 border-gray-300 shadow-gray-300/20 text-gray-800";
        Icon = PauseCircle;
        iconColor = "text-gray-800";
    }

    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
        <div className={`pointer-events-auto w-full max-w-md rounded-b-2xl shadow-xl py-3 px-4 flex items-center justify-center gap-3 border-b-2 border-x-2 animate-slide-down ${theme}`}>
            <div className="bg-white/20 p-1.5 rounded-full flex-shrink-0">
              <Icon size={18} className={iconColor} />
            </div>
            <div className="font-bold text-sm text-center break-words">
              {broadcastMessage}
            </div>
        </div>
      </div>
    );
  }

  return null;
};

export default CallingNotification;
