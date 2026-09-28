import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('customers discover available online shops and open a campaign', async ({ page }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const shopSlug = `luna-paper-${suffix}`;
  const quietSlug = `maple-ink-${suffix}`;
  const shopName = `Luna Paper ${suffix}`;
  const quietName = `Maple Ink ${suffix}`;
  const campaignIds = Array.from({ length: 6 }, () => randomUUID());
  const productId = randomUUID();
  const runtimeErrors: string[] = [];
  const fixtures: Awaited<ReturnType<typeof ensureOwnerArtistFixture>>[] = [];

  page.on('pageerror', error => runtimeErrors.push(error.message));

  try {
    const shop = await ensureOwnerArtistFixture({
      email: `${shopSlug}@example.com`,
      password: 'LocalOnlineShop123!',
      slug: shopSlug,
      displayName: shopName,
    });
    fixtures.push(shop);
    const quiet = await ensureOwnerArtistFixture({
      email: `${quietSlug}@example.com`,
      password: 'LocalOnlineShop123!',
      slug: quietSlug,
      displayName: quietName,
    });
    fixtures.push(quiet);

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const campaigns = [
      { id: campaignIds[0], name: `Moonlit Market ${suffix}`, slug: 'moonlit-market', opens_at: new Date(now - hour).toISOString(), closes_at: new Date(now + 7 * 24 * hour).toISOString(), publication_status: 'published' },
      { id: campaignIds[1], name: `Sold-out Sketchbook ${suffix}`, slug: 'sold-out-sketchbook', opens_at: new Date(now - hour / 2).toISOString(), closes_at: new Date(now + 6 * 24 * hour).toISOString(), publication_status: 'published' },
      { id: campaignIds[2], name: `Starry Stationery ${suffix}`, slug: 'starry-stationery', opens_at: new Date(now + 24 * hour).toISOString(), closes_at: new Date(now + 8 * 24 * hour).toISOString(), publication_status: 'published' },
      { id: campaignIds[3], name: `Cloudy Postcards ${suffix}`, slug: 'cloudy-postcards', opens_at: new Date(now + 2 * 24 * hour).toISOString(), closes_at: new Date(now + 9 * 24 * hour).toISOString(), publication_status: 'published' },
      { id: campaignIds[4], name: `Past Collection ${suffix}`, slug: 'past-collection', opens_at: new Date(now - 9 * 24 * hour).toISOString(), closes_at: new Date(now - 8 * 24 * hour).toISOString(), publication_status: 'published' },
      { id: campaignIds[5], name: `Private Collection ${suffix}`, slug: 'private-collection', opens_at: new Date(now - hour).toISOString(), closes_at: new Date(now + 7 * 24 * hour).toISOString(), publication_status: 'draft' },
    ];

    const artistUpdate = await shop.service.from('artists').update({ bio: 'Paper goods and small-batch illustrations.' }).eq('id', shop.userId);
    if (artistUpdate.error) throw artistUpdate.error;
    const product = await shop.service.from('products').insert({
      id: productId,
      artist_id: shop.userId,
      name: `Moonlit Print ${suffix}`,
      description: 'A small art print for the collection.',
      category: 'Prints',
      price: 120,
      is_unlimited: true,
      status: 'enable',
    });
    if (product.error) throw product.error;
    const campaignInsert = await shop.service.from('online_campaigns').insert(campaigns.map(campaign => ({
      ...campaign,
      artist_id: shop.userId,
      description: 'Limited paper goods available online.',
      campaign_timezone: 'Asia/Bangkok',
      shipping_enabled: true,
    })));
    if (campaignInsert.error) throw campaignInsert.error;
    const allocations = await shop.service.from('online_campaign_products').insert(
      [campaignIds[0], campaignIds[2], campaignIds[3], campaignIds[4], campaignIds[5]].map(campaignId => ({
        campaign_id: campaignId,
        product_id: productId,
        artist_id: shop.userId,
        is_unlimited: true,
      })),
    );
    if (allocations.error) throw allocations.error;

    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/');

    const shopCard = page.getByTestId('creator-card').filter({ hasText: shopName });
    const quietCard = page.getByTestId('creator-card').filter({ hasText: quietName });
    await expect(shopCard).toBeVisible();
    await expect(quietCard).toBeVisible();
    await expect(shopCard.getByText('Online shop', { exact: true })).toBeVisible();

    await quietCard.getByRole('link', { name: 'View booth' }).click();
    await expect(page.getByRole('heading', { name: quietName, exact: true })).toBeVisible();
    await expect(page.getByTestId('online-shop-section')).toHaveCount(0);
    await page.goto('/');

    await page.getByRole('button', { name: 'Online shop', exact: true }).click();
    await expect(page).toHaveURL(/(?:\?|&)online=1(?:&|$)/);
    await expect(shopCard).toBeVisible();
    await expect(quietCard).toHaveCount(0);

    await shopCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/nireq-online-discover-${testInfo.project.name}.png` });
    let releaseLoading!: () => void;
    const loadingGate = new Promise<void>(resolve => { releaseLoading = resolve; });
    let failListingOnce = true;
    await page.route('**/rest/v1/rpc/list_public_online_campaigns', async route => {
      if (failListingOnce) {
        await loadingGate;
        await route.fulfill({ status: 400, json: { code: 'PGRST100', message: 'Fixture unavailable' } });
        return;
      }
      await route.continue();
    });
    await shopCard.getByRole('link', { name: 'View booth' }).click();

    await expect(page.getByRole('link', { name: 'Merchandise' }).first()).toHaveAttribute('href', `/${shopSlug}/menu`);
    await expect(page.getByRole('link', { name: 'Queue' }).first()).toHaveAttribute('href', `/${shopSlug}/queue`);
    await expect(page.getByTestId('online-shop-section').getByRole('status')).toContainText('Loading online shop');
    releaseLoading();
    await expect(page.getByTestId('online-shop-section').getByRole('alert')).toContainText('Could not load online shops');
    failListingOnce = false;
    await page.getByTestId('online-shop-section').getByRole('button', { name: 'Retry' }).click();

    const onlineShop = page.getByTestId('online-shop-section');
    await expect(onlineShop.getByRole('link')).toHaveCount(2);
    await expect(onlineShop.getByText(campaigns[0].name, { exact: true })).toBeVisible();
    await expect(onlineShop.getByText(campaigns[2].name, { exact: true })).toBeVisible();
    await expect(onlineShop.getByText(campaigns[1].name, { exact: true })).toHaveCount(0);
    await expect(onlineShop.getByText(campaigns[4].name, { exact: true })).toHaveCount(0);
    await expect(onlineShop.getByText(campaigns[5].name, { exact: true })).toHaveCount(0);

    await onlineShop.getByRole('button', { name: 'View all' }).click();
    await expect(onlineShop.getByRole('link')).toHaveCount(4);
    await expect(onlineShop.getByText(campaigns[3].name, { exact: true })).toBeVisible();
    await expect(onlineShop.getByText(campaigns[1].name, { exact: true })).toBeVisible();
    await expect(onlineShop.getByText('Sold out', { exact: true })).toBeVisible();
    await expect(onlineShop.getByText('Scheduled', { exact: true })).toHaveCount(2);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await page.screenshot({ path: `/tmp/nireq-online-shop-${testInfo.project.name}.png`, fullPage: true });

    await onlineShop.getByRole('link', { name: new RegExp(campaigns[1].name) }).click();
    await expect(page).toHaveURL(`/${shopSlug}/campaign/${campaigns[1].slug}`);
    await expect(page.getByRole('heading', { name: campaigns[1].name })).toBeVisible();
    await expect(page.getByText('Sold out', { exact: true })).toBeVisible();
    await expect(page.getByText('Sales are not open. You can still view this campaign.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home' }).first()).toHaveAttribute('href', `/${shopSlug}/home`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await shop.service.from('online_campaigns').update({ publication_status: 'archived' }).in('id', campaignIds.slice(1)).throwOnError();
    await page.goto(`/${shopSlug}/home`);
    await expect(onlineShop.getByRole('link')).toHaveCount(1);
    await expect(onlineShop.getByRole('button', { name: 'View all' })).toHaveCount(0);
    await onlineShop.getByRole('link').click();
    await expect(page).toHaveURL(`/${shopSlug}/campaign/${campaigns[0].slug}`);
    await expect(page.getByRole('heading', { name: campaigns[0].name })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  } finally {
    for (const fixture of fixtures) {
      await fixture.service.from('online_campaigns').delete().eq('artist_id', fixture.userId).throwOnError();
      await fixture.service.from('products').delete().eq('artist_id', fixture.userId).throwOnError();
      await fixture.service.from('artists').delete().eq('id', fixture.userId).throwOnError();
      const deleted = await fixture.service.auth.admin.deleteUser(fixture.userId);
      if (deleted.error) throw deleted.error;
    }
  }
});
