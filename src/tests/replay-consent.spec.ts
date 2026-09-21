import { expect, test } from '@playwright/test';

test('replay requires consent, drops private channels, and unloads on withdrawal', async ({ page }) => {
  let sdkLoads = 0;
  await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
  await page.route('**/src/lib/observability.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(
      'const appId = import.meta.env.VITE_LOGROCKET_APP_ID;', 'const appId = "test/replay";'
    ) });
  });
  await page.route('**/logrocket.js*', async route => {
    sdkLoads++;
    await route.fulfill({ contentType: 'application/javascript', body: `export default { init(id, options) {
      window.replayOptions = options;
    } };` });
  });
  await page.goto('/cookies');
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  expect(sdkLoads).toBe(0);
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Privacy preferences', exact: true })).toBeVisible();
  expect(sdkLoads).toBe(0);
  await expect(page.getByRole('link', { name: 'konglnwzas@gmail.com' })).toBeVisible();
  await page.getByRole('button', { name: 'Privacy preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect.poll(() => sdkLoads).toBe(1);
  await page.waitForFunction(() => 'replayOptions' in window);
  const policy = await page.evaluate(() => {
    const options = (window as Window & { replayOptions?: {
      network: { requestSanitizer: (value: unknown) => unknown; responseSanitizer: (value: unknown) => unknown };
      browser: { urlSanitizer: (value: string) => string };
      dom: { textSanitizer: boolean; imageSanitizer: boolean };
      console: { isEnabled: boolean };
      shouldDetectExceptions: boolean;
    } }).replayOptions;
    if (!options) throw new Error('Replay test SDK did not initialize');
    return {
      request: options.network.requestSanitizer({ url: '/order/private', body: 'secret', headers: { authorization: 'secret' } }),
      response: options.network.responseSanitizer({ body: 'customer address' }),
      url: options.browser.urlSanitizer('/order/private?token=secret'),
      text: options.dom.textSanitizer,
      images: options.dom.imageSanitizer,
      logs: options.console.isEnabled,
      errors: options.shouldDetectExceptions,
    };
  });
  expect(policy).toMatchObject({ request: null, response: null, text: true, images: true, logs: false, errors: false });
  expect(policy.url).not.toContain('secret');
  await page.getByRole('button', { name: 'Privacy preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Withdraw and reload', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Privacy preferences', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nireq-replay-consent-v1'))).toBe('rejected');
  expect(sdkLoads).toBe(1);
});
