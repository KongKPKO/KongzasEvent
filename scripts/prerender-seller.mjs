import { readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.mjs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const [{ default: SellerLanding }, { LanguageProvider }, { getSeoDetails }] = await Promise.all([
    server.ssrLoadModule('/src/pages/SellerLanding.tsx'),
    server.ssrLoadModule('/src/i18n.tsx'),
    server.ssrLoadModule('/src/lib/seo.ts'),
  ]);
  const details = getSeoDetails('/for-sellers', 'en', 'paimonq.com');
  const content = renderToString(createElement(StaticRouter, { location: '/for-sellers' }, createElement(LanguageProvider, null, createElement(SellerLanding))));
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  let html = await readFile('dist/index.html', 'utf8');
  if (!html.includes('<div id="root"></div>') || !details.canonical || !content.includes('<h1')) throw new Error('Cannot prerender seller landing: expected content missing');
  html = html.replace('<div id="root"></div>', `<div id="root">${content}</div>`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(details.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escape(details.description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escape(details.title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escape(details.description)}" />`)
    .replace('</head>', `<link rel="canonical" href="${details.canonical}" /><meta property="og:url" content="${details.canonical}" /><meta property="og:image" content="https://paimonq.com/pwa-512x512.png" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="${escape(details.title)}" /><meta name="twitter:description" content="${escape(details.description)}" /><meta name="twitter:image" content="https://paimonq.com/pwa-512x512.png" /></head>`);
  await writeFile('dist/seller-landing.html', html);
} finally {
  await server.close();
}
