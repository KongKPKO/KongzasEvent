import { expect, test } from '@playwright/test';
import { selectLanguage } from './helpers/languageMenu';

const shops = {
  creator: { sellerType: 'creator', shop: 'Creator shop', artwork: 'Made by a creator' },
  cosplayer: { sellerType: 'cosplayer', shop: 'Cosplayer shop', artwork: 'Works by a cosplayer' },
  retail: { sellerType: 'shop', shop: 'Shop', artwork: 'Products' },
  fallback: { sellerType: undefined, shop: 'Creator shop', artwork: 'Made by a creator' },
} as const;

test('customer storefront uses seller-specific labels with creator fallback and language switching', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('nireq-language', 'en'));
  await page.route('**/seller-type-product.png', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/artists')) {
      const artistId = url.searchParams.get('id')?.replace(/^eq\./, '');
      const slug = url.searchParams.get('slug')?.replace(/^eq\./, '')
        || (artistId?.endsWith('2') ? 'cosplayer' : artistId?.endsWith('3') ? 'retail' : artistId?.endsWith('4') ? 'fallback' : 'creator');
      const fixture = shops[slug as keyof typeof shops] || shops.fallback;
      return route.fulfill({
        json: {
          id: `00000000-0000-4000-8000-00000000000${slug === 'creator' ? '1' : slug === 'cosplayer' ? '2' : slug === 'retail' ? '3' : '4'}`,
          slug,
          display_name: `${slug} storefront`,
          bio: '',
          ...(fixture.sellerType && url.searchParams.get('select')?.includes('seller_type') ? { seller_type: fixture.sellerType } : {}),
        },
      });
    }
    if (path.endsWith('/get_public_online_campaign')) {
      return route.fulfill({ json: { id: 'campaign', artist_id: '00000000-0000-4000-8000-000000000002', artist_slug: 'cosplayer', artist_name: 'cosplayer storefront', artist_seller_type: 'cosplayer', name: 'Online test', slug: 'test', state: 'open', currency: 'THB', shipping_enabled: true, flat_shipping_fee: 0, opens_at: new Date(Date.now() - 1000).toISOString(), closes_at: new Date(Date.now() + 86400000).toISOString(), pickup_points: [], payment_methods: [], products: [{ product_id: 'product', name: 'Test photo', price: 100, currency: 'THB', category: 'Photo', status: 'enable', is_unlimited: true, image_url: 'seller-type-product.png' }] } });
    }
    if (path.endsWith('/products')) {
      return route.fulfill({ json: [{
        id: '10000000-0000-4000-8000-000000000001',
        name: 'Seller type product',
        price: 100,
        currency: 'THB',
        image_url: 'seller-type-product.png',
        status: 'enable',
        is_unlimited: true,
      }] });
    }
    return route.fulfill({ json: [] });
  });

  for (const [slug, fixture] of Object.entries(shops)) {
    await page.goto(`/${slug}/menu`);
    await expect(page.getByText(fixture.shop, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.artwork, { exact: true })).toBeVisible();
  }

  await page.goto('/cosplayer/menu');
  await page.getByRole('link', { name: 'cosplayer storefront shop home', exact: true }).click();
  await expect(page).toHaveURL(/\/cosplayer\/home$/);
  await expect(page.getByText('Cosplayer shop', { exact: true })).toBeVisible();
  await page.goto('/cosplayer/campaign/test');
  await expect(page.getByText('Works by a cosplayer', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'cosplayer storefront shop home', exact: true }).click();
  await expect(page).toHaveURL(/\/cosplayer\/home$/);
  await page.goto('/cosplayer/menu');
  await selectLanguage(page, 'th');
  await expect(page.getByText('ร้านคอสเพลย์เยอร์', { exact: true })).toBeVisible();
  await expect(page.getByText('ผลงานจากคอสเพลย์เยอร์', { exact: true })).toBeVisible();
});
