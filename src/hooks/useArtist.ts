import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export interface Artist {
  id: string;
  slug: string;
  display_name?: string;
  bio?: string;
  is_active?: boolean;
  x_url?: string;
  ig_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  email?: string;
}

export const useArtist = (slug: string | undefined) => {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
       setLoading(false);
       return;
    }

    const fetchArtist = async () => {
      try {
        const { data, error } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, is_active, x_url, ig_url, facebook_url, tiktok_url, email')
          .eq('slug', slug)
          .single();

        if (error) {
           setError('Artist not found');
           setArtist(null);
        } else {
           setArtist(data);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to fetch artist');
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [slug]);

  return { artist, loading, error };
};
