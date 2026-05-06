import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export interface Artist {
  id: string;
  slug: string;
  display_name?: string;
  bio?: string;

  x_url?: string;
  ig_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  email?: string;
  broadcast_message?: string;
}

export const useArtist = (slug: string | undefined) => {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setArtist(null);
    setError(null);

    if (!slug) {
       setLoading(false);
       return;
    }

    let isActive = true;
    setLoading(true);

    const fetchArtist = async () => {
      try {
        const { data, error } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, x_url, ig_url, facebook_url, tiktok_url, email, broadcast_message')
          .eq('slug', slug)
          .maybeSingle();

        if (error) {
           console.error("Supabase Artist Fetch Error:", error.message, error.details);
           if (!isActive) return;
           setError(error.message);
           setArtist(null);
        } else if (!data) {
           if (!isActive) return;
           setError('artist_not_found');
           setArtist(null);
        } else {
           if (!isActive) return;
           setArtist(data);
        }
      } catch (err: any) {
        console.error("Unexpected Error fetching artist:", err);
        if (!isActive) return;
        setError(`Failed to fetch artist: ${err.message || 'Unknown error'}`);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    fetchArtist();

    return () => {
      isActive = false;
    };
  }, [slug]);

  return { artist, loading, error };
};
