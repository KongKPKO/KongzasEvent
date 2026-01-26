import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, ChevronRight, Coffee, Info, AlertTriangle, PauseCircle } from 'lucide-react';

interface CallingNotificationProps {
  artistId: string;
  slug: string;
  broadcastMessage?: string;
}

const CallingNotification = ({ artistId, slug, broadcastMessage: initialBroadcastMessage }: CallingNotificationProps) => {
  const navigate = useNavigate();
  const [isCalling, setIsCalling] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  
  // State สำหรับเก็บข้อความ Broadcast
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(initialBroadcastMessage || null);

  // 1. โหลดข้อมูลเริ่มต้น
  useEffect(() => {
    if (!artistId) return;

    // 1.1 ดึง Broadcast ล่าสุด
    const fetchBroadcast = async () => {
      const { data } = await supabase
        .from('artists')
        .select('broadcast_message')
        .eq('id', artistId)
        .single();
      if (data) setBroadcastMessage(data.broadcast_message);
    };
    fetchBroadcast();

    // 1.2 ดึงสถานะ Ticket ตัวเอง
    const storedTicketId = localStorage.getItem(`ticket_id_${artistId}`);
    if (storedTicketId) {
      setTicketId(storedTicketId);
      const fetchTicketStatus = async () => {
        const { data } = await supabase.from('queues').select('status, queue_number').eq('id', storedTicketId).single();
        if (data && data.status === 'calling') {
          setIsCalling(true);
          setTicketNumber(data.queue_number);
        }
      };
      fetchTicketStatus();
    }
  }, [artistId]);

  // 2. Realtime Listener
  useEffect(() => {
    let ticketChannel: any = null;
    
    // ฟัง Ticket ของเรา
    if (ticketId) {
       ticketChannel = supabase.channel(`my-ticket:${ticketId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${ticketId}` }, (payload) => {
            if (payload.new.status === 'calling') {
              setIsCalling(true);
              setTicketNumber(payload.new.queue_number);
              if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            } else {
              setIsCalling(false);
            }
        })
        .subscribe();
    }

    // ฟัง Broadcast ส่วนกลาง
    const broadcastChannel = supabase.channel(`artist-broadcast:${artistId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` }, (payload) => {
          setBroadcastMessage(payload.new.broadcast_message);
      })
      .subscribe();

    return () => {
      if (ticketChannel) supabase.removeChannel(ticketChannel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [ticketId, artistId]);


  // 🎨 RENDER LOGIC
  
  // Priority 1: Calling (เปลี่ยนเป็นภาษาอังกฤษตามที่ขอ)
  if (isCalling) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
        <div 
          onClick={() => navigate(`/${slug}/queue`)}
          className="pointer-events-auto w-full max-w-md bg-yellow-400 text-yellow-900 rounded-b-2xl shadow-xl shadow-yellow-400/20 py-3 px-4 flex items-center justify-between cursor-pointer border-b-2 border-x-2 border-yellow-200 animate-bounce-in"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="bg-white/90 p-2 rounded-full shadow-sm animate-pulse flex-shrink-0">
              <Bell size={18} className="text-yellow-600 fill-yellow-600" />
            </div>
            {/* 👇 ปรับ Text ตรงนี้ */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span className="font-black text-sm text-yellow-950 uppercase tracking-wide leading-tight">
                Your Turn!
              </span>
              <span className="text-xs font-semibold text-yellow-800 truncate leading-tight">
                 Queue <span className="font-black text-sm text-yellow-950">#{ticketNumber}</span> Please come to booth!
              </span>
            </div>
          </div>
          <div className="bg-white/40 p-1 rounded-full flex-shrink-0 ml-2">
             <ChevronRight size={16} className="text-yellow-900" />
          </div>
        </div>
      </div>
    );
  }

  // Priority 2: Broadcast
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