import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

// Optimized Interfaces (Only essential fields)
export interface RealtimeArtist {
  id: string;
  display_name: string;
  bio: string;
  image_url?: string;
  broadcast_message?: string;
  is_queue_open?: boolean; // New Field
  x_url?: string | null;
  facebook_url?: string | null;
  ig_url?: string | null;
  tiktok_url?: string | null;
  email?: string | null;
}

export interface RealtimeEvent {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location_name: string;

  entrance_fee?: string;
  transit_info?: string;
  status: 'Confirmed' | 'Cancelled';
  is_booth_open: boolean;
}

interface UseArtistRealtimeProps {
  artistId: string;
  initialArtist?: RealtimeArtist; 
}

export const useArtistRealtime = ({ artistId, initialArtist }: UseArtistRealtimeProps) => {
  const [artist, setArtist] = useState<RealtimeArtist | null>(initialArtist || null);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(true); // Assumption: Starts connected
  
  // Fetch Initial Data logic (Optimized)
  const fetchInitialData = async () => {
     try {
        // Timezone-safe date string (YYYY-MM-DD) for broad filtering
        const todayStr = new Date().toLocaleDateString('en-CA');
        
const [artistRes, eventsRes] = await Promise.all([
           supabase.from('artists').select('id, display_name, bio, image_url, broadcast_message, is_queue_open, x_url, facebook_url, ig_url, tiktok_url, email').eq('id', artistId).single(),
           // Filter strictly by date string to prevent timezone dropouts
           supabase.from('events').select('id, event_name, start_date, end_date, location_name, entrance_fee, transit_info, status, is_booth_open')
             .eq('artist_id', artistId)
             .gte('end_date', todayStr) 
             .order('start_date', { ascending: true })
        ]);

        if (artistRes.data) setArtist(artistRes.data);
        if (eventsRes.data) setEvents(eventsRes.data);
     } catch (err) {
        console.error("Initial Fetch Error", err);
     }
  };

  useEffect(() => {
    if (!artistId) return;

    fetchInitialData();

    // SETUP REALTIME
    const channel: RealtimeChannel = supabase
      .channel(`artist-realtime-${artistId}`)
      .on(
         'postgres_changes',
         { event: 'UPDATE', schema: 'public', table: 'artists', filter: `id=eq.${artistId}` },
         (payload) => {
             // Full Refresh on Artist Update (Syncs everything)
             console.log("Realtime: Artist updated, refetching...", payload);
             fetchInitialData();
         }
      )
      .on(
         'postgres_changes',
         { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${artistId}` },
         (payload) => {
             console.log("Realtime: Events Change Detected", payload);
             
             // 1. Optimistic Update for "UPDATE" events (e.g. Toggle Booth)
             if (payload.eventType === 'UPDATE') {
                const updatedEvent = payload.new as RealtimeEvent;
                setEvents((prevEvents) => 
                    prevEvents.map(e => e.id === updatedEvent.id ? { ...e, ...updatedEvent } : e)
                );
             } else {
                // 2. For INSERT/DELETE, we refetch to ensure sorting & filtering logic (e.g. dates) is strict
                fetchInitialData();
             }
         }
      )
      .subscribe((status) => {
         if (status === 'SUBSCRIBED') setIsConnected(true);
         if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setIsConnected(false);
      });

    // Connection Status Listener (Global)
    supabase.channel('system').on('system', { event: '*' }, (payload) => {
        if (payload.event === 'disconnect') setIsConnected(false);
        if (payload.event === 'connect') setIsConnected(true);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [artistId]);

  return { artist, events, isConnected, refresh: fetchInitialData };
};
