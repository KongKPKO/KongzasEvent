import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { LoginPage } from './e2e/pages/LoginPage';

test('event gift-only setting is saved independently and global gifts are labelled', async ({ page }) => {
  const id = randomUUID(), eventId = randomUUID(), ordinary = randomUUID(), gift = randomUUID();
  const email = `event-gift-${id}@example.test`, password = 'LocalOnlyGiftPassword123!';
  const { service, userId } = await ensureOwnerArtistFixture({ email, password, slug: `gift-${id.slice(0, 8)}`, displayName: 'Event gift test' });
  const must = (result: { error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); };
  try {
    must(await service.from('products').insert([
      { id: ordinary, artist_id: userId, name: 'Ordinary item', price: 100, stock_total: 20, is_unlimited: false, status: 'enable', gift_only: false },
      { id: gift, artist_id: userId, name: 'Gift item', price: 0, stock_total: 20, is_unlimited: false, status: 'enable', gift_only: true },
    ]));
    must(await service.from('events').insert({ id: eventId, artist_id: userId, event_name: 'Gift event', start_date: new Date(Date.now() - 3600000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed', is_booth_open: true }));
    must(await service.from('event_products').insert([ordinary, gift].map(product_id => ({ event_id: eventId, artist_id: userId, product_id, stock_total: 5, is_unlimited: false, is_enabled: true }))));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await new LoginPage(page).goto();
    await new LoginPage(page).login(email, password);
    await expect(page).toHaveURL(/manage-events/);
    await page.goto(`/manage-events/${eventId}/catalog`);
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    const normalCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Ordinary item', exact: true }) });
    const giftCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Gift item', exact: true }) });
    await expect(giftCard.getByText('Gift enabled', { exact: true })).toBeVisible();
    await expect(giftCard.getByRole('checkbox', { name: 'Gift only in this event: Gift item' })).toBeDisabled();
    await normalCard.getByRole('checkbox', { name: 'Gift only in this event: Ordinary item' }).check();
    await expect(normalCard.getByText('Gift enabled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
    await expect.poll(async () => (await service.from('event_products').select('is_sellable').eq('event_id', eventId).eq('product_id', ordinary).single()).data?.is_sellable).toBe(false);
    await page.reload();
    await page.getByRole('button', { name: 'Visual', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Gift only in this event: Ordinary item' })).toBeChecked();
    await page.getByRole('button', { name: 'Operations', exact: true }).click();
    await page.locator('details.event-assignment-item').filter({ hasText: 'Ordinary item' }).locator(':scope > summary').click();
    await expect(page.getByRole('checkbox', { name: 'Gift only in this event: Ordinary item' })).toBeChecked();
    await expect.poll(async () => (await service.from('products').select('gift_only').eq('id', ordinary).single()).data?.gift_only).toBe(false);
  } finally {
    await service.from('event_products').delete().eq('event_id', eventId);
    await service.from('events').delete().eq('id', eventId);
    await service.from('products').delete().eq('artist_id', userId);
    await service.from('artists').delete().eq('id', userId);
    await service.auth.admin.deleteUser(userId);
  }
});
