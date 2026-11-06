import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('seller landing build contains public content and metadata in the initial HTML', async () => {
  const html = await readFile('dist/seller-landing.html', 'utf8');
  assert.match(html, /<h1[^>]*>Prepare your shop for every stage of the event<\/h1>/);
  assert.match(html, /href="\/creator\/register"/);
  assert.match(html, /<title>Manage your shop and events \| Paimon<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/paimonq\.com\/for-sellers"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
  for (const configPath of ['firebase.json', 'firebase.prod.json']) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const seller = config.hosting.rewrites.findIndex(rule => rule.destination === '/seller-landing.html');
    const fallback = config.hosting.rewrites.findIndex(rule => rule.destination === '/index.html');
    assert.ok(seller >= 0 && seller < fallback, configPath);
    assert.match('/for-sellers', new RegExp(config.hosting.rewrites[seller].regex));
  }
});
