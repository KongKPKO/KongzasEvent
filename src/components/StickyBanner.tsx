import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Coffee, AlertCircle, UserCheck } from 'lucide-react';

interface StickyBannerProps {
  artistId: string;
  initialMessage?: string | null;
  isPreview?: boolean; // For Admin Preview if needed, though we rely on real data
}

const StickyBanner = ({ artistId, initialMessage }: StickyBannerProps) => {
  const [message, setMessage] = useState<string | null>(initialMessage || null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (initialMessage) {
        setMessage(initialMessage);
        setIsVisible(true);
    }
  }, [initialMessage]);

  useEffect(() => {
    if (!artistId) return;

    // 1. Initial Fetch (if not provided or to ensure fresh)
    const fetchMessage = async () => {
      const { data } = await supabase
        .from('artists')
        .select('broadcast_message')
        .eq('id', artistId)
        .single();
      
      if (data && data.broadcast_message) {
        setMessage(data.broadcast_message);
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    fetchMessage();

    // 2. Realtime Subscription
    const channel = supabase
      .channel(`sticky-banner-${artistId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` },
        (payload) => {
          const newMsg = payload.new.broadcast_message;
          setMessage(newMsg);
          setIsVisible(!!newMsg);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [artistId]);

  if (!isVisible || !message) return null;

  // Determine Icon and Color based on message content
  // "พักเบรค" -> Coffee, Pink
  // "ติดธุระด่วน" -> Alert, Orange/Red
  // "พร้อมเรียกคิว" -> UserCheck, Green
  // Default -> Info, Gray/Pink

  let icon = <AlertCircle size={20} />;
  let bgColor = "bg-[#ff4d94]"; // Default Pink

  if (message === "พักเบรค") {
      icon = <Coffee size={20} />;
      bgColor = "bg-[#ff4d94]";
  } else if (message === "ติดธุระด่วน") {
      icon = <AlertCircle size={20} />;
      bgColor = "bg-orange-500";
  } else if (message === "พร้อมเรียกคิว") {
      icon = <UserCheck size={20} />;
      bgColor = "bg-green-500";
  }

  return (
    <div className={`w-full ${bgColor} text-white px-4 py-3 shadow-md animate-slide-down sticky top-0 z-50 flex items-center justify-center gap-3 transition-colors duration-300`}>
       {icon}
       <span className="font-bold text-sm md:text-base tracking-wide flex items-center gap-2">
          {message}
       </span>
    </div>
  );
};

export default StickyBanner;
