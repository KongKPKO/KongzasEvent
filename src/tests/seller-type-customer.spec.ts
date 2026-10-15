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
          ...(fixture.sellerType ? { seller_type: fixture.sellerType } : {}),
        },
      });
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
  await selectLanguage(page, 'th');
  await expect(page.getByText('ร้านคอสเพลย์เยอร์', { exact: true })).toBeVisible();
  await expect(page.getByText('ผลงานจากคอสเพลย์เยอร์', { exact: true })).toBeVisible();
});
