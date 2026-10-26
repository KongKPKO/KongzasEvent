import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';

test('customer queue preserves a ticket across browsing and shows service completion', async ({ page }) => {
  const slug = `queue-ui-${randomUUID().slice(0, 8)}`;
  const fixture = await ensureOwnerArtistFixture({ email: `${slug}@example.com`, password: 'QueueLocal123!', slug, displayName: 'Queue Creator' });
  const eventId = randomUUID();
  try {
    const event = await fixture.service.from('events').insert({ id: eventId, artist_id: fixture.userId, event_name: 'Festival Queue', start_date: new Date(Date.now() - 3600000).toISOString(), end_date: new Date(Date.now() + 86400000).toISOString(), status: 'Confirmed', is_booth_open: true, queueing_area: 'Booth A12' });
    if (event.error) throw event.error;
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto(`/${slug}/queue`);
    await page.getByRole('button', { name: 'Get Ticket', exact: true }).click();
    const ticket = page.getByRole('region', { name: 'Your queue ticket', exact: true });
    await expect(ticket).toContainText('#1');
    const browse = page.getByRole('link', { name: /Browse this creator’s work/ });
    await expect(browse).toHaveAttribute('href', `/${slug}/menu`);
    await browse.click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/menu`));
    await expect(page.locator('main.creator-store')).toBeVisible();
    await page.goto(`/${slug}/queue`);
    await expect(ticket).toContainText('#1');
    await page.route('**/rest/v1/queues?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Unavailable"}' }));
    await page.getByRole('button', { name: 'Refresh Status', exact: true }).click();
    await expect(ticket).toContainText('#1');
    await page.unroute('**/rest/v1/queues?*');
    const serving = await fixture.service.from('queues').update({ status: 'serving' }).eq('event_id', eventId);
    if (serving.error) throw serving.error;
    await expect(ticket).toContainText(/Serving|In Service|Being served/i, { timeout: 12000 });
    const complete = await fixture.service.from('queues').update({ status: 'complete' }).eq('event_id', eventId);
    if (complete.error) throw complete.error;
    await expect(ticket).toContainText(/Complete/i, { timeout: 12000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await fixture.service.from('queues').delete().eq('event_id', eventId).throwOnError();
    await fixture.service.from('events').delete().eq('id', eventId).throwOnError();
    await fixture.service.from('artists').delete().eq('id', fixture.userId).throwOnError();
    const deleted = await fixture.service.auth.admin.deleteUser(fixture.userId);
    if (deleted.error) throw deleted.error;
  }
});
