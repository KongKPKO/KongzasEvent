import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { validateWebP } from './webp.ts';
import decode, { init } from 'npm:@jsquash/webp@1.5.0/decode.js';

let decoderReady: Promise<void> | undefined;
async function decodeImage(bytes: Uint8Array) {
  decoderReady ||= Deno.readFile(new URL('./webp_dec.wasm', import.meta.url)).then(wasmBinary => init({ noInitialRun: true, ...{ wasmBinary } }));
  try { await decoderReady; } catch (error) { decoderReady = undefined; throw error; }
  try { return await decode(bytes.buffer as ArrayBuffer); } catch { throw new Error('invalid_webp'); }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const limits: Record<string, { edge: number; bytes: number }> = {
  avatar: { edge: 800, bytes: 512 * 1024 }, product: { edge: 1024, bytes: 1024 * 1024 },
  problem: { edge: 2048, bytes: 2 * 1024 * 1024 },
  qr: { edge: 2048, bytes: 2 * 1024 * 1024 }, evidence: { edge: 2560, bytes: 4 * 1024 * 1024 },
};
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  let readingInput = true;
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: 'file_required' }, 400);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 4 * 1024 * 1024 + 16384) { await reader.cancel(); return reply({ error: 'file_too_large' }, 413); }
      chunks.push(value);
    }
    const form = await new Response(new Blob(chunks), { headers: { 'Content-Type': req.headers.get('Content-Type') || '' } }).formData();
    const purpose = String(form.get('purpose') || '');
    const limit = limits[purpose];
    const file = form.get('file');
    if (!limit || !(file instanceof File) || file.type !== 'image/webp' || file.size > limit.bytes) return reply({ error: 'invalid_image' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = validateWebP(bytes, limit.edge);
    readingInput = false;
    const decoded = await decodeImage(bytes);
    if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) return reply({ error: 'invalid_image' }, 400);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || `Bearer ${anon}` } } });
    const id = String(form.get('requestId') || '');
    const reserved = await caller.rpc('reserve_image_upload', {
      p_id: id, p_purpose: purpose, p_artist_id: form.get('artistId') || null,
      p_order_id: form.get('orderId') || null, p_code: form.get('code') || null, p_hash: hash,
    });
    if (reserved.error) return reply({ error: 'upload_not_allowed', detail: reserved.error.message }, 403);
    const item = reserved.data?.[0];
    if (!item) return reply({ error: 'upload_not_allowed' }, 403);
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!item.uploaded) {
      const saved = await service.storage.from(item.bucket).upload(item.path, bytes, { contentType: 'image/webp', upsert: false });
      // A response may have been lost after storing these same content-hashed bytes.
      if (saved.error && saved.error.message !== 'The resource already exists' && saved.error.message !== 'Resource already exists') return reply({ error: 'storage_unavailable' }, 503);
      const marked = await service.from('image_uploads').update({ uploaded_at: new Date().toISOString() }).eq('id', id);
      if (marked.error) return reply({ error: 'upload_status_unavailable' }, 503);
    }
    return reply({ path: item.path, bucket: item.bucket });
  } catch (error) {
    if (readingInput || (error instanceof Error && error.message === 'invalid_webp')) return reply({ error: 'invalid_image_upload' }, 400);
    console.error('[upload-image] Image processing or storage unavailable');
    return reply({ error: 'image_service_unavailable' }, 503);
  }
});
