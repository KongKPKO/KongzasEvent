import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('public sitemap follows publication state and ignores caller privileges', async ({ request, page }) => {
  const env = resolveSupabaseTestEnv();
  if (!['localhost', '127.0.0.1'].includes(new URL(env.url).hostname)) throw new Error('Sitemap fixtures require disposable local Supabase');
  const id = randomUUID();
  const publicSlug = `sitemap-public-${id.slice(0, 8)}`;
  const privateSlug = `sitemap-private-${id.slice(0, 8)}`;
  const password = 'LocalSitemapTest123!';
  const publicOwner = await ensureOwnerArtistFixture({ email: `sitemap-public-${id}@example.test`, password, slug: publicSlug, displayName: 'Public fixture' });
  const privateOwner = await ensureOwnerArtistFixture({ email: `sitemap-private-${id}@example.test`, password, slug: privateSlug, displayName: 'Private fixture' });
  const service = publicOwner.service;
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  const endpoint = `${env.url}/functions/v1/public-sitemap`;
  try {
    must(await service.from('artists').update({ is_public: false }).eq('id', privateOwner.userId));
    const now = Date.now();
    const campaigns = await service.from('online_campaigns').insert([
      { artist_id: publicOwner.userId, name: 'Public campaign', slug: 'public-campaign', opens_at: new Date(now - 60000).toISOString(), closes_at: new Date(now + 86400000).toISOString(), publication_status: 'published' },
      { artist_id: publicOwner.userId, name: 'Draft campaign', slug: 'draft-campaign', opens_at: new Date(now - 60000).toISOString(), closes_at: new Date(now + 86400000).toISOString(), publication_status: 'draft' },
      { artist_id: privateOwner.userId, name: 'Private campaign', slug: 'private-campaign', opens_at: new Date(now - 60000).toISOString(), closes_at: new Date(now + 86400000).toISOString(), publication_status: 'published' },
    ]);
    must(campaigns);
    const response = await request.get(endpoint, { headers: { Authorization: `Bearer ${env.serviceKey}` } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    expect(response.headers()['cache-control']).toContain('no-store');
    const xml = await response.text();
    expect(await page.evaluate(value => new DOMParser().parseFromString(value, 'application/xml').querySelector('parsererror') === null, xml)).toBe(true);
    expect(xml).toContain(`https://paimonq.com/${publicSlug}/home`);
    expect(xml).toContain(`https://paimonq.com/${publicSlug}/menu`);
    expect(xml).toContain(`https://paimonq.com/${publicSlug}/campaign/public-campaign`);
    expect(xml).not.toContain('draft-campaign');
    expect(xml).not.toContain(privateSlug);
    must(await service.from('online_campaigns').update({ publication_status: 'draft' }).eq('artist_id', publicOwner.userId).eq('slug', 'public-campaign'));
    expect(await (await request.get(endpoint)).text()).not.toContain('public-campaign');
    must(await service.from('artists').update({ is_public: false }).eq('id', publicOwner.userId));
    const afterUnpublish = await request.get(endpoint);
    expect(afterUnpublish.status()).toBe(200);
    expect(await afterUnpublish.text()).not.toContain(publicSlug);
    expect((await request.post(endpoint)).status()).toBe(405);
  } finally {
    must(await service.from('online_campaigns').delete().in('artist_id', [publicOwner.userId, privateOwner.userId]));
    must(await service.auth.admin.deleteUser(publicOwner.userId));
    must(await service.auth.admin.deleteUser(privateOwner.userId));
  }
});
