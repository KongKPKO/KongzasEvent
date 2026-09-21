import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { validateWebP } from '../../supabase/functions/upload-image/webp';

test('every image purpose converts small PNGs and validates private upload boundaries', async ({ page, request }) => {
  const env = resolveSupabaseTestEnv();
  if (!['localhost', '127.0.0.1'].includes(new URL(env.url).hostname)) throw new Error('Local Supabase required');
  const suffix = randomUUID().slice(0, 12), email = `images-${suffix}@example.com`, password = 'LocalOnlyImage123!';
  const fixture = await ensureOwnerArtistFixture({ email, password, slug: `images-${suffix}`, displayName: 'Image upload test' });
  const uploaded: Array<{ bucket: string; path: string }> = [];
  try {
    await page.goto('/cookies');
    const converted = await page.evaluate(async ({ email, password }) => {
      const imageModule = '/src/utils/uploadImage.ts';
      const clientModule = '/src/supabaseClient.ts';
      const { prepareUploadImage } = await import(imageModule);
      const { supabase } = await import(clientModule);
      const login = await supabase.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 200);
      context.fillStyle = '#000'; context.font = '20px sans-serif'; context.fillText('TEST 123.45', 20, 80);
      const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const files = [];
      for (const purpose of ['avatar', 'product', 'qr', 'evidence', 'problem']) {
        const file = await prepareUploadImage(new File([png], 'small.png', { type: 'image/png' }), purpose);
        const bitmap = await createImageBitmap(file);
        files.push({ purpose, type: file.type, name: file.name, bytes: Array.from(new Uint8Array(await file.arrayBuffer())), width: bitmap.width, height: bitmap.height });
        bitmap.close();
      }
      let rejected = false;
      try { await prepareUploadImage(new File(['not an image'], 'fake.webp', { type: 'image/webp' }), 'evidence'); }
      catch { rejected = true; }
      return { files, rejected, token: login.data.session.access_token };
    }, { email, password });
    expect(converted.rejected).toBe(true);
    for (const file of converted.files) {
      expect(file.type).toBe('image/webp'); expect(file.name).toBe('small.webp');
      expect(validateWebP(new Uint8Array(file.bytes), 2560)).toEqual({ width: 320, height: 200 });
      expect(() => validateWebP(new Uint8Array(file.bytes).slice(0, -1), 2560)).toThrow();
      expect(() => validateWebP(new Uint8Array(file.bytes), 100)).toThrow();
    }
    const headers = { apikey: env.anonKey, Authorization: `Bearer ${converted.token}` };
    const file = converted.files[0];
    const requestId = randomUUID();
    const multipart = { purpose: 'avatar', artistId: fixture.userId, requestId, file: { name: 'image.webp', mimeType: 'image/webp', buffer: Buffer.from(file.bytes) } };
    const response = await request.post(`${env.url}/functions/v1/upload-image`, { headers, multipart });
    expect(await response.text()).not.toContain('invalid_image_upload');
    expect(response.status()).toBe(200);
    const saved = await response.json(); uploaded.push(saved);
    const retry = await request.post(`${env.url}/functions/v1/upload-image`, { headers, multipart });
    expect(retry.status()).toBe(200); expect(await retry.json()).toEqual(saved);
    const rows = await fixture.service.from('image_uploads').select('id').eq('id', requestId);
    expect(rows.data).toHaveLength(1);
    const spoof = await request.post(`${env.url}/functions/v1/upload-image`, { headers, multipart: { ...multipart, requestId: randomUUID(), file: { ...multipart.file, buffer: Buffer.from('fake webp') } } });
    expect(spoof.status()).toBe(400);
    const foreign = await request.post(`${env.url}/functions/v1/upload-image`, { headers, multipart: { ...multipart, artistId: randomUUID(), requestId: randomUUID() } });
    expect(foreign.status()).toBe(403);
    const evidence = await request.post(`${env.url}/functions/v1/upload-image`, { headers, multipart: { ...multipart, purpose: 'evidence', orderId: randomUUID(), code: 'INVALID', requestId: randomUUID() } });
    expect(evidence.status()).toBe(403);
    const bypass = await request.post(`${env.url}/storage/v1/object/Avatar/${fixture.userId}/bypass.webp`, { headers: { ...headers, 'Content-Type': 'image/webp' }, data: Buffer.from(file.bytes) });
    expect(bypass.ok()).toBe(false);
  } finally {
    for (const item of uploaded) await fixture.service.storage.from(item.bucket).remove([item.path]);
    await fixture.service.from('artists').delete().eq('id', fixture.userId);
    await fixture.service.auth.admin.deleteUser(fixture.userId);
  }
});

test('unsupported native WebP encoding uses the bundled encoder', async ({ page }) => {
  await page.goto('/cookies');
  const message = await page.evaluate(async () => {
    const modulePath = '/src/utils/uploadImage.ts';
    const { prepareUploadImage } = await import(modulePath);
    const original = HTMLCanvasElement.prototype.toBlob;
    const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    HTMLCanvasElement.prototype.toBlob = function (callback) { original.call(this, callback, 'image/png'); };
    try { const result = await prepareUploadImage(new File([png], 'image.png', { type: 'image/png' }), 'avatar'); return result.type; }
    catch (error) { return error instanceof Error ? error.message : ''; }
    finally { HTMLCanvasElement.prototype.toBlob = original; }
  });
  expect(message).toBe('image/webp');
});
