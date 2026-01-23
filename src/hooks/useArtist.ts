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
    if (!slug) {
       setLoading(false);
       return;
    }

    const fetchArtist = async () => {
      try {
        const { data, error } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, x_url, ig_url, facebook_url, tiktok_url, email, broadcast_message')
          .eq('slug', slug)
          .single();

        if (error) {
           console.error("Supabase Artist Fetch Error:", error.message, error.details);
           setError(`Artist not found: ${error.message}`);
           setArtist(null);
        } else {
           setArtist(data);
        }
      } catch (err: any) {
        console.error("Unexpected Error fetching artist:", err);
        setError(`Failed to fetch artist: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    fetchArtist();
  }, [slug]);

  return { artist, loading, error };
};
