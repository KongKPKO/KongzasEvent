import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { sitemapOrigin } from '../supabase/functions/public-sitemap/origin.mjs';

test('sitemap origin matches the target environment and rejects unknown projects', () => {
  assert.equal(sitemapOrigin('https://kdjqitvtxmcrnnpuxuyl.supabase.co'), 'https://nireqapp--dev-mttk3ru2.web.app');
  assert.equal(sitemapOrigin('https://fnutmjnzugpayccscvgr.supabase.co'), 'https://paimonq.com');
  assert.throws(() => sitemapOrigin('https://unknown.supabase.co'));
});

test('hosting keeps known deep links while unknown route shapes reach the 404 page', async () => {
  for (const configPath of ['firebase.json', 'firebase.prod.json']) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const fallback = config.hosting.rewrites.find(rule => rule.destination === '/index.html');
    const matches = new RegExp(fallback.regex);
    for (const path of ['/', '/discover', '/discover/shops', '/for-sellers', '/creator/register', '/manage-products', '/manage-products/home', '/manage-events/id/catalog', '/manage-events/id/postorder-dashboard', '/manage-online-sales/id', '/live/pos', '/admin/support', '/shop', '/shop/home', '/shop/menu', '/shop/queue', '/shop/campaign/sale', '/shop/order/code', '/help/guide']) assert.match(path, matches, `${configPath}: ${path}`);
    for (const path of ['/shop/unknown', '/shop/campaign/sale/extra', '/a/b/c/d/e', '/help/guide/unknown']) assert.doesNotMatch(path, matches, `${configPath}: ${path}`);
  }
  assert.match(await readFile('public/404.html', 'utf8'), /noindex, nofollow/);
});
