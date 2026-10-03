export interface EventAppearance {
  id: string;
  artist_id: string;
  event_id: string;
  character_name: string;
  series_name?: string | null;
  image_url?: string | null;
  appearance_date: string;
  day_label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  note?: string | null;
  booth?: string | null;
  zone?: string | null;
  is_public: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface EventAppearanceDraft {
  character_name: string;
  series_name: string;
  image_url: string;
  appearance_date: string;
  day_label: string;
  start_time: string;
  end_time: string;
  note: string;
  booth: string;
  zone: string;
  is_public: boolean;
}

export interface AppearanceEventContext {
  id: string;
  artist_id: string;
  start_date: string;
  end_date: string;
  event_timezone?: string | null;
  booth_detail?: string | null;
  booth_number?: string | null;
  location?: string | null;
}
