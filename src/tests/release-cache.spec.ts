import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('built app gets fresh navigation, keeps device state and reopens existing-record recovery offline', async ({ page, context }) => {
  // Serve the real release artifacts; Vite development does not install a worker.
  const root = resolve('dist');
  const shell = readFileSync(resolve(root, 'index.html'), 'utf8');
  let version = 'first';
  const server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const asset = /\.(js|css|wasm|png|svg|ico|webmanifest|txt|xml)$/.test(path);
    try {
      const body = path === '/sw.js' ? `${readFileSync(resolve(root, 'sw.js'), 'utf8')}\n// test release ${version}`
        : asset ? readFileSync(resolve(root, `.${path}`))
        : shell.replace('<head>', `<head><meta name="test-release" content="${version}">`);
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
        : path.endsWith('.webmanifest') ? 'application/manifest+json' : asset ? 'application/octet-stream' : 'text/html';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(`${origin}/manage-login`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      localStorage.setItem('test-pending-cart', 'preserve-me');
      await caches.open('test-unrelated-cache');
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    version = 'second';
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    const update = page.getByRole('button', { name: /Load new version|โหลดเวอร์ชันใหม่/ });
    await expect(update).toBeVisible();
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', 'first');
    await update.click();
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', 'second');
    await page.goto(origin);
    version = 'third';
    await page.reload();
    await expect(page.locator('meta[name="test-release"]')).toHaveAttribute('content', 'third');
    expect(await page.evaluate(() => localStorage.getItem('test-pending-cart'))).toBe('preserve-me');
    expect(await page.evaluate(() => caches.has('test-unrelated-cache'))).toBe(true);
    const precached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter(name => name.includes('precache'));
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
    });
    expect(precached.length).toBeGreaterThan(0);
    expect(precached.some(url => /heic2any-|webp_enc/.test(url))).toBe(false);
    await context.setOffline(true);
    await page.goto(`${origin}/offline`);
    await expect(page.getByRole('heading', { name: /Recover existing offline records|กู้คืนรายการออฟไลน์เดิม/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Recover existing offline records|กู้คืนรายการออฟไลน์เดิม/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Prepare this device|เตรียมเครื่อง/ })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await page.goto('about:blank');
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});
