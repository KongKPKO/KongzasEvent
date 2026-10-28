import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { LoginPage } from './e2e/pages/LoginPage';

for (const role of ['owner', 'manager']) {
  test(`${role} linked to a different shop ID can save seller type and customers see it`, async ({ page }) => {
    const run = randomUUID();
    const password = 'LocalOnlyProfileMember123!';
    const slug = `member-profile-${run.slice(0, 8)}`;
    const fixture = await ensureOwnerArtistFixture({ email: `profile-shop-${run}@example.test`, password, slug, displayName: 'Member profile test shop' });
    const memberEmail = `profile-member-${run}@example.test`;
    let memberId = '';
    try {
      const member = await fixture.service.auth.admin.createUser({ email: memberEmail, password, email_confirm: true });
      if (member.error) throw member.error;
      memberId = member.data.user.id;
      expect(memberId).not.toBe(fixture.userId);
      await fixture.service.from('artist_members').insert({ artist_id: fixture.userId, member_email: memberEmail, role, status: 'active' }).throwOnError();
      await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
      const login = new LoginPage(page);
      await login.goto();
      await login.login(memberEmail, password);
      await expect(page).not.toHaveURL(/manage-login/);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Open workspace menu' }).click();
      await page.getByRole('button', { name: 'Shop profile', exact: true }).click();
      await expect(page).toHaveURL(/\/manage-profile$/);
      await expect(page.getByRole('heading', { name: 'Shop profile', exact: true })).toBeVisible();
      await expect(page.locator('#artist-seller-type')).toHaveValue('creator');
      await page.locator('#artist-seller-type').selectOption('cosplayer');
      await page.getByRole('button', { name: 'Save Updates', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Shop profile saved.' })).toBeVisible();
      const saved = await fixture.service.from('artists').select('seller_type, is_public, is_verified').eq('id', fixture.userId).single().throwOnError();
      expect(saved.data).toEqual({ seller_type: 'cosplayer', is_public: true, is_verified: true });
      await page.reload();
      await expect(page.locator('#artist-seller-type')).toHaveValue('cosplayer');
      await page.getByRole('link', { name: 'Manage events', exact: true }).click();
      await expect(page).toHaveURL(/\/manage-events\?view=all$/);
      await expect(page.locator('#artist-seller-type')).toHaveCount(0);
      await page.goto('/manage-events?tab=profile');
      await expect(page.locator('#artist-seller-type')).toHaveValue('cosplayer');
      await page.goto(`/${slug}/home`);
      await expect(page.getByText('Cosplayer shop', { exact: true })).toBeVisible();
    } finally {
      await fixture.service.from('artist_members').delete().eq('artist_id', fixture.userId).throwOnError();
      await fixture.service.from('artists').delete().eq('id', fixture.userId).throwOnError();
      for (const id of [memberId, fixture.userId].filter(Boolean)) {
        const deleted = await fixture.service.auth.admin.deleteUser(id);
        if (deleted.error) throw deleted.error;
      }
    }
  });
}
