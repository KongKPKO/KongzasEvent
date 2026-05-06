import type { RealtimeArtist, RealtimeEvent } from '../hooks/useArtistRealtime';

export interface CustomerOutletContext {
  artist: any;
  realtimeArtist: RealtimeArtist | null;
  events: RealtimeEvent[];
  isConnected: boolean;
  refresh: () => Promise<void>;
  selectedEvent: RealtimeEvent | null;
  availableEvents: RealtimeEvent[];
  setSelectedEventId: (eventId: string) => void;
}
