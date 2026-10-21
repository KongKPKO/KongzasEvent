import { openAccountMenu } from './helpers/accountMenu';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test('owner A switches to seller B without stale workspace state and can recover from logout errors', async ({ page }) => {
  test.setTimeout(60000);
  const env = resolveSupabaseTestEnv();
  expect(['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname)).toBe(true);

  const suffix = randomUUID().slice(0, 8);
  const email = `phase2-workspace-${suffix}@example.test`;
  const password = 'Phase2Workspace123!';
  const shopB = randomUUID();
  const eventB = randomUUID();
  const productB = randomUUID();
  const { userId: shopA, service } = await ensureOwnerArtistFixture({
    email,
    password,
    slug: `phase2-owner-a-${suffix}`,
    displayName: 'Phase2 Owner A',
  });

  let secondUserId: string | undefined;
  const secondEmail = `phase2-owner-b-${suffix}@example.test`;
  try {
    const secondAccount = await service.auth.admin.createUser({ email: secondEmail, password, email_confirm: true });
    if (secondAccount.error) throw secondAccount.error;
    secondUserId = secondAccount.data.user.id;
    await service.from('artists').insert({
      id: shopB,
      slug: `phase2-staff-b-${suffix}`,
      display_name: 'Phase2 Staff B',
      email: secondEmail,
      is_public: true, is_verified: true, published_at: new Date().toISOString(),
    }).throwOnError();
    await service.from('artist_members').insert({
      artist_id: shopB,
      member_email: email,
      role: 'seller',
      status: 'active',
    }).throwOnError();
    await service.from('artist_members').insert({ artist_id: shopB, member_email: secondEmail, role: 'owner', status: 'active' }).throwOnError();
    await service.from('events').insert({
      id: eventB,
      artist_id: shopB,
      event_name: 'Staff B live event',
      start_date: new Date(Date.now() - 60_000).toISOString(),
      end_date: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'Confirmed',
    }).throwOnError();

    await service.from('products').insert({ id: productB, artist_id: shopB, name: 'Staff B product', price: 100, status: 'enable', stock_total: 10, is_unlimited: false, currency: 'THB' }).throwOnError();
    await service.from('event_products').insert({ event_id: eventB, product_id: productB, artist_id: shopB, is_enabled: true, stock_total: 10, is_unlimited: false }).throwOnError();

    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/manage-login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByTestId('creator-login-submit').click();

    await expect(page).toHaveURL(/\/manage-workspaces$/);
    await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Phase2 Owner A/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Phase2 Staff B/ })).toBeVisible();

    await page.getByRole('button', { name: /Phase2 Owner A/ }).click();
    await expect(page).toHaveURL(/\/manage-events$/);

    await page.evaluate(({ shopAId, shopBId }) => {
      localStorage.setItem('posPinnedProducts', '["private-product"]');
      localStorage.setItem('posPaymentAttempt:synthetic', 'private-attempt');
      localStorage.setItem(`posSelectedEventId:${shopAId}`, 'private-event');
      localStorage.setItem(`orderSent_${shopBId}`, 'true');
      localStorage.setItem(`sentOrderId_${shopBId}`, 'customer-order-record');
    }, { shopAId: shopA, shopBId: shopB });

    await openAccountMenu(page);
    await page.getByRole('button', { name: /Phase2 Staff B/ }).click();
    await expect(page).toHaveURL(/\/live\/pos$/);
    await expect(page.getByRole('banner').getByText('Staff B live event', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /Staff B product/ }).first()).toBeVisible();
    await page.screenshot({ path: `output/playwright/phase234/workspace-${test.info().project.name}.png`, fullPage: true, animations: 'disabled', timeout: 10000 });
    const storedAfterSwitch = await page.evaluate(({ shopBId, accountId }) => ({
      selected: localStorage.getItem(`nireq:active-workspace:${accountId}`),
      pinned: JSON.parse(localStorage.getItem('posPinnedProducts') || '[]'),
      paymentAttempt: localStorage.getItem('posPaymentAttempt:synthetic'),
      customerOrderSent: localStorage.getItem(`orderSent_${shopBId}`),
      customerOrderId: localStorage.getItem(`sentOrderId_${shopBId}`),
    }), { shopBId: shopB, accountId: shopA });
    expect(storedAfterSwitch).toEqual({
      selected: shopB,
      pinned: [],
      paymentAttempt: 'private-attempt',
      customerOrderSent: 'true',
      customerOrderId: 'customer-order-record',
    });

    await page.route('**/rest/v1/rpc/resolve_actor_workspace', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic workspace resolution failure' }),
    }));
    await page.reload();
    await expect(page.getByText('Could not load your workspace. Please try again.')).toBeVisible();
    await expect.poll(() => page.evaluate((accountId) => localStorage.getItem(`nireq:active-workspace:${accountId}`), shopA)).toBe(shopB);
    await page.unroute('**/rest/v1/rpc/resolve_actor_workspace');
    await page.getByRole('button', { name: 'Retry loading workspace' }).click();
    await expect(page.getByRole('banner').getByText('Staff B live event', { exact: true })).toBeVisible();

    await page.goto('/invitations');
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByText('No pending invitations.')).toBeVisible();
    await expect(page.getByText(/another email address/)).toBeVisible();

    await page.goto('/live/pos');
    await openAccountMenu(page);
    await page.route('**/auth/v1/logout*', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Synthetic sign-out failure' }),
    }));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not sign out. Please try again.');
    await expect(page).toHaveURL(/\/live\/pos$/);
    expect(await page.evaluate(() => localStorage.getItem('posPinnedProducts'))).toBeNull();
    await page.unroute('**/auth/v1/logout*');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/manage-login$/);
    await page.getByLabel('Email', { exact: true }).fill(secondEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByTestId('creator-login-submit').click();
    await expect(page).toHaveURL(new RegExp(`/manage-events/${eventB}/workspace$`));
    const newIdentity = await page.evaluate(({ formerId, currentId }) => ({
      formerSelection: localStorage.getItem(`nireq:active-workspace:${formerId}`),
      currentSelection: localStorage.getItem(`nireq:active-workspace:${currentId}`),
      paymentAttempt: localStorage.getItem('posPaymentAttempt:synthetic'),
    }), { formerId: shopA, currentId: secondUserId! });
    expect(newIdentity).toEqual({ formerSelection: null, currentSelection: shopB, paymentAttempt: 'private-attempt' });
    await openAccountMenu(page);
    await expect(page.getByText(secondEmail, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Staff B live event', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);

  } finally {
    await service.from('artists').delete().eq('id', shopB).throwOnError();
    await service.from('artists').delete().eq('id', shopA).throwOnError();
    if (secondUserId) { const removedSecond = await service.auth.admin.deleteUser(secondUserId); if (removedSecond.error) throw removedSecond.error; }
    const removed = await service.auth.admin.deleteUser(shopA);
    if (removed.error) throw removed.error;
  }
});
