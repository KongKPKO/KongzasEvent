import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sitemapOrigin } from './origin.mjs';

const reserved = new Set(['admin', 'live', 'staff-signup', 'reset-password', 'invitations', 'offline', 'help', 'creator', 'for-sellers', 'manage-events', 'manage-online-sales']);
const pageSize = 500;
const maxUrls = 50000;

function segment(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000-\u001f]/.test(value)) return null;
  try { return encodeURIComponent(value); } catch { return null; }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !key) throw new Error('Missing public API configuration');
    const origin = sitemapOrigin(url);
    // Never forward caller credentials: sitemap visibility must always be anonymous.
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const locations = new Set<string>();
    const publicArtists = new Set<string>();
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('artists').select('id, slug').eq('is_public', true).eq('is_verified', true).not('published_at', 'is', null).order('id').range(offset, offset + pageSize - 1);
      if (error || !data) throw new Error('Public shop lookup failed');
      for (const row of data) {
        const slug = segment(row.slug);
        if (!slug || reserved.has(row.slug.toLowerCase())) continue;
        publicArtists.add(row.slug);
        locations.add(`${origin}/${slug}/home`);
        locations.add(`${origin}/${slug}/menu`);
        if (locations.size > maxUrls) throw new Error('Sitemap URL limit exceeded');
      }
      if (data.length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.rpc('list_public_online_campaigns', { p_artist_slug: null }).order('artist_slug').order('slug').range(offset, offset + pageSize - 1);
      if (error || !data) throw new Error('Public campaign lookup failed');
      for (const row of data) {
        const shop = segment(row.artist_slug), campaign = segment(row.slug);
        if (!shop || !campaign || !publicArtists.has(row.artist_slug)) continue;
        locations.add(`${origin}/${shop}/campaign/${campaign}`);
        if (locations.size > maxUrls) throw new Error('Sitemap URL limit exceeded');
      }
      if (data.length < pageSize) break;
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...locations].sort().map(location => `  <url><loc>${location.replaceAll('&', '&amp;')}</loc></url>`).join('\n')}\n</urlset>\n`;
    return new Response(request.method === 'HEAD' ? null : xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    console.error('[public-sitemap]', error instanceof Error ? error.message : 'Unknown failure');
    return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
});
