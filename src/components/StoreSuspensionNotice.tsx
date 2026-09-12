import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useI18n } from '../i18n';

export default function StoreSuspensionNotice({ artistId }: { artistId: string }) {
  const { language } = useI18n();
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const { data, error } = await supabase.rpc('get_store_suspension', { p_artist_id: artistId });
      if (alive && !error) setSuspended(data === true);
    };
    setSuspended(false);
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [artistId]);
  if (!suspended) return null;
  return <p role="status" className="my-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">{language === 'th'
    ? 'ร้านนี้ถูกระงับการรับออเดอร์และคิวใหม่ ออเดอร์เดิมยังดูสถานะและดำเนินการต่อได้'
    : 'This store is not accepting new orders or queue tickets. Existing orders remain accessible and can be processed.'}</p>;
}
