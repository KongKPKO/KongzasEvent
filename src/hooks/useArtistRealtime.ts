import { useCallback, useEffect, useMemo, useState } from 'react';
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
  event_timezone?: string | null;
  selling_mode?: 'preorder' | 'live' | 'post_event' | 'closed';
  preorder_opens_at?: string | null;
  preorder_closes_at?: string | null;
  preorder_pickup_instructions?: string | null;
  location?: string | null;
  booth_detail?: string | null;
  queueing_area?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
  entrance_fee?: string;
  transit_info?: string;
  status: 'Confirmed' | 'Cancelled' | 'Ended';
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
  
  const fetchInitialData = useCallback(async () => {
    if (!artistId) return;

    try {
      // Timezone-safe date string (YYYY-MM-DD) for broad filtering
      const todayStr = new Date().toLocaleDateString('en-CA');

      const [artistRes, eventsRes] = await Promise.all([
        supabase
          .from('artists')
          .select('id, display_name, bio, image_url, broadcast_message, is_queue_open, x_url, facebook_url, ig_url, tiktok_url, email')
          .eq('id', artistId)
          .single(),
        // Filter strictly by date string to prevent timezone dropouts.
        // Ended events stay included while their post-event store is open
        // (selling_mode = post_event); the client-side window filter decides visibility.
        supabase
          .from('events')
          .select('id, event_name, start_date, end_date, event_timezone, selling_mode, preorder_opens_at, preorder_closes_at, preorder_pickup_instructions, location, booth_detail, queueing_area, location_name, location_detail, booth_number, entrance_fee, transit_info, status, is_booth_open')
          .eq('artist_id', artistId)
          .or(`end_date.gte.${todayStr},selling_mode.eq.post_event`)
          .order('start_date', { ascending: true })
      ]);

      if (artistRes.data) setArtist(artistRes.data);
      if (eventsRes.data) {
        const normalizedEvents = eventsRes.data.map((event: RealtimeEvent) => {
          const fallbackLocation = [event.location_name, event.location_detail]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join(', ');

          return {
            ...event,
            location: event.location && event.location.trim().length > 0 ? event.location : fallbackLocation,
            booth_detail: event.booth_detail && event.booth_detail.trim().length > 0 ? event.booth_detail : event.booth_number
          };
        });

        setEvents(normalizedEvents);
      }
    } catch (err) {
      console.error('Initial Fetch Error', err);
    }
  }, [artistId]);

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
          // Artist update does not require full refetch.
          setArtist((prev) => ({ ...(prev || {}), ...(payload.new as RealtimeArtist) } as RealtimeArtist));
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `artist_id=eq.${artistId}` },
        (payload) => {
          // Keep ordering/filtering deterministic with one refetch for event set changes.
          if (payload.eventType === 'UPDATE') {
            const updatedEvent = payload.new as RealtimeEvent;
            const fallbackLocation = [updatedEvent.location_name, updatedEvent.location_detail]
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
              .join(', ');
            const normalizedUpdatedEvent = {
              ...updatedEvent,
              location: updatedEvent.location && updatedEvent.location.trim().length > 0 ? updatedEvent.location : fallbackLocation,
              booth_detail: updatedEvent.booth_detail && updatedEvent.booth_detail.trim().length > 0 ? updatedEvent.booth_detail : updatedEvent.booth_number
            };
            setEvents((prevEvents) => prevEvents.map((e) => (e.id === normalizedUpdatedEvent.id ? { ...e, ...normalizedUpdatedEvent } : e)));
            return;
          }

          fetchInitialData();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setIsConnected(true);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setIsConnected(false);
      });

    // Connection Status Listener
    const systemChannel = supabase
      .channel(`artist-system-${artistId}`)
      .on('system', { event: '*' }, (payload) => {
        if (payload.event === 'disconnect') setIsConnected(false);
        if (payload.event === 'connect') setIsConnected(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(systemChannel);
    };
  }, [artistId, fetchInitialData]);

  return useMemo(
    () => ({ artist, events, isConnected, refresh: fetchInitialData }),
    [artist, events, isConnected, fetchInitialData]
  );
};
