import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('team event access saves through the atomic RPC and retains access after a failed request', async ({ page }) => {
  const env = resolveSupabaseTestEnv();
  expect(['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)).toBe(true);
  const suffix = randomUUID().slice(0, 8), password = 'LocalTeamBoundary123!';
  const email = `team-ui-${suffix}@example.test`, staff = `staff-ui-${suffix}@example.test`;
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `team-ui-${suffix}`, displayName: 'Synthetic Team Owner' });
  const first = randomUUID(), second = randomUUID(), member = randomUUID();
  try {
    await service.from('events').insert([
      { id: first, event_name: 'Team first event' }, { id: second, event_name: 'Team second event' },
    ].map(event => ({ ...event, artist_id: userId, status: 'Confirmed', start_date: new Date().toISOString(), end_date: new Date(Date.now() + 86400000).toISOString() }))).throwOnError();
    await service.from('artist_members').insert({ id: member, artist_id: userId, member_email: staff, role: 'seller', status: 'active' }).throwOnError();
    await service.from('event_member_assignments').insert({ artist_id: userId, member_id: member, event_id: first }).throwOnError();
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/manage-login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByTestId('creator-login-submit').click();
    await expect(page).toHaveURL(/\/manage-events$/);
    await page.goto('/manage-team');
    const row = page.getByText(staff, { exact: true }).locator('..').locator('..').locator('..');
    await expect(row.getByRole('checkbox', { name: 'Team first event', exact: true })).toBeChecked();
    const saved = page.waitForResponse(response => response.url().endsWith('/rpc/replace_event_member_assignments'));
    await row.getByRole('checkbox', { name: 'Team second event', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect.poll(async () => (await service.from('event_member_assignments').select('event_id').eq('member_id', member).throwOnError()).data?.length).toBe(2);
    await expect(row.getByRole('checkbox', { name: 'Team second event', exact: true })).toBeChecked();
    await page.route('**/rest/v1/rpc/replace_event_member_assignments', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic assignment failure"}' }));
    await row.getByRole('checkbox', { name: 'Team first event', exact: true }).click();
    await expect(page.getByText('Synthetic assignment failure', { exact: true })).toBeVisible();
    await expect(row.getByRole('checkbox', { name: 'Team first event', exact: true })).toBeChecked();
    expect((await service.from('event_member_assignments').select('event_id').eq('member_id', member).throwOnError()).data).toHaveLength(2);
    await page.unroute('**/rest/v1/rpc/replace_event_member_assignments');
    await row.getByRole('checkbox', { name: 'Team first event', exact: true }).click();
    await expect.poll(async () => (await service.from('event_member_assignments').select('event_id').eq('member_id', member).throwOnError()).data?.map(item => item.event_id)).toEqual([second]);
    await page.reload();
    await expect(row.getByRole('checkbox', { name: 'Team first event', exact: true })).not.toBeChecked();
    await expect(row.getByRole('checkbox', { name: 'Team second event', exact: true })).toBeChecked();
  } finally {
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
});
