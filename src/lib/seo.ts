export type SeoLanguage = 'th' | 'en';
type Copy = { title: [string, string]; description: [string, string] };
export type SeoDetails = { title: string; description: string; canonical: string | null; noindex: boolean };
const origin = 'https://paimonq.com';
const pages: Record<string, Copy> = {
  '/': { title: ['ค้นหาร้านค้าและอีเวนต์ | Paimon', 'Discover shops and events | Paimon'], description: ['ค้นหาร้านค้า ผลงาน และอีเวนต์ พร้อมติดตามคิวและออเดอร์บน Paimon', 'Discover shops, creative work and events, and follow your queues and orders on Paimon.'] },
  '/creator/register': { title: ['สมัครร้านค้าบน Paimon', 'Join Paimon as a seller'], description: ['สมัครร้านค้าเพื่อจัดการสินค้า อีเวนต์ คิว และออเดอร์บน Paimon', 'Create a seller account to manage products, events, queues and orders on Paimon.'] },
  '/privacy': { title: ['นโยบายความเป็นส่วนตัว | Paimon', 'Privacy policy | Paimon'], description: ['อ่านนโยบายความเป็นส่วนตัวและการจัดการข้อมูลของ Paimon', 'Read the Paimon privacy policy and how personal information is handled.'] },
  '/terms': { title: ['ข้อกำหนดการใช้งาน | Paimon', 'Terms of service | Paimon'], description: ['อ่านข้อกำหนดการใช้งาน Paimon สำหรับร้านค้าและลูกค้า', 'Read the terms of service for Paimon sellers and customers.'] },
  '/cookies': { title: ['คุกกี้และพื้นที่จัดเก็บ | Paimon', 'Cookies and storage | Paimon'], description: ['อ่านเกี่ยวกับคุกกี้ พื้นที่จัดเก็บ และตัวเลือกความเป็นส่วนตัวบน Paimon', 'Learn about cookies, browser storage and privacy choices on Paimon.'] },
  '/help/guide': { title: ['คู่มือการใช้งาน | Paimon', 'Help guide | Paimon'], description: ['ดูคำแนะนำการใช้งานร้านค้า คิว และออเดอร์บน Paimon', 'Find help using shops, queues and orders on Paimon.'] },
};
const shopCopy: Record<string, Copy> = {
  home: { title: ['หน้าร้าน', 'Shop'], description: ['ดูหน้าร้านและอีเวนต์ของร้านบน Paimon', 'Explore the shop and its events on Paimon.'] },
  menu: { title: ['สินค้า', 'Products'], description: ['ดูสินค้าของร้านบน Paimon', 'Browse products from this shop on Paimon.'] },
  campaign: { title: ['ร้านค้าออนไลน์', 'Online shop'], description: ['ดูสินค้าและรายละเอียดร้านค้าออนไลน์บน Paimon', 'Explore products and details for this online shop on Paimon.'] },
};
export function getSeoDetails(pathname: string, language: SeoLanguage, hostname: string, shopName?: string): SeoDetails {
  const path = pathname.replace(/\/+$/, '') || '/';
  const canonicalPath = path === '/discover' ? '/' : path;
  let copy = pages[canonicalPath];
  let titlePrefix = '';
  let canonical = copy ? origin + canonicalPath : null;
  const parts = path.split('/').filter(Boolean);
  if (!copy && parts.length && !/^(manage|admin|live|staff-signup|reset-password|invitations|offline|help)(?:-|$)/.test(parts[0])) {
    const kind = parts.length === 1 || (parts.length === 2 && parts[1] === 'home') ? 'home' : parts.length === 2 && parts[1] === 'menu' ? 'menu' : parts.length === 3 && parts[1] === 'campaign' ? 'campaign' : '';
    if (kind) {
      copy = shopCopy[kind];
      let slug = parts[0];
      try { slug = decodeURIComponent(slug); } catch { /* Keep an invalid encoded path as text. */ }
      titlePrefix = (shopName || slug) + ' · ';
      canonical = origin + (parts.length === 1 ? `${path}/home` : path);
    }
  }
  const preview = hostname.endsWith('.web.app') || hostname.endsWith('.firebaseapp.com');
  const noindex = !copy || preview;
  const selected = language === 'th' ? 0 : 1;
  return { title: copy ? `${titlePrefix}${copy.title[selected]}${titlePrefix ? ' | Paimon' : ''}` : (language === 'th' ? 'Paimon | จัดการร้านและออเดอร์' : 'Paimon | Shop and order management'), description: copy?.description[selected] || (language === 'th' ? 'จัดการร้าน คิว และออเดอร์บน Paimon' : 'Manage your shop, queues and orders on Paimon.'), canonical: noindex ? null : canonical, noindex };
}
export function applySeoDetails(details: SeoDetails) {
  document.title = details.title;
  const setMeta = (selector: string, attribute: string, key: string, value: string) => {
    let element = document.head.querySelector<HTMLMetaElement>(selector);
    if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.appendChild(element); }
    element.content = value;
  };
  setMeta('meta[name="description"]', 'name', 'description', details.description);
  setMeta('meta[name="robots"]', 'name', 'robots', details.noindex ? 'noindex, nofollow' : 'index, follow');
  setMeta('meta[property="og:title"]', 'property', 'og:title', details.title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', details.description);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  let ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (details.canonical) {
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = details.canonical;
    if (!ogUrl) { ogUrl = document.createElement('meta'); ogUrl.setAttribute('property', 'og:url'); document.head.appendChild(ogUrl); }
    ogUrl.content = details.canonical;
  } else { canonical?.remove(); ogUrl?.remove(); }
}
