import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildCampaignEmail } from './campaign-email.ts';

test('campaign email uses the configured site, escapes content, and lists items separately', () => {
  const email = buildCampaignEmail(
    { pickup_code: 'OC-123', total_price: 0, currency: 'THB' },
    { name: 'Shop <script>' }, { display_name: 'Seller & Co', slug: 'paimon' },
    { amount_expected: 0, currency: 'THB' },
    [{ quantity: 1, product_name_snapshot: '<One>' }, { quantity: 2, product_name_snapshot: 'Two' }],
    'created', 'https://paimonq.com/',
  );
  assert.match(email.html, /href="https:\/\/paimonq\.com\/paimon\/order\/OC-123"/);
  assert.match(email.html, /<li>1x &lt;One&gt;<\/li><li>2x Two<\/li>/);
  assert.match(email.html, /Shop &lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.text, /- 1x <One>\n- 2x Two/);
  assert.match(email.text, /0\.00/);
  assert.match(email.html, /รับคำสั่งซื้อแล้ว รอชำระเงิน/);
  assert.match(email.html, /Your order is reserved/);
});

test('confirmed payment email is bilingual and works for delivery orders', () => {
  const email = buildCampaignEmail({ pickup_code: 'OC-789', fulfillment_method: 'shipping' }, {}, { slug: 'shop' }, {}, [], 'confirmed', 'https://paimonq.com');
  assert.match(email.subject, /ยืนยันการชำระเงินแล้ว.*Payment confirmed/);
  assert.match(email.html, /Your payment is confirmed/);
  assert.match(email.html, /https:\/\/paimonq\.com\/shop\/order\/OC-789/);
});

test('rejection explains that the online order is cancelled', () => {
  const email = buildCampaignEmail({ pickup_code: 'OC-789' }, {}, { slug: 'shop' }, {}, [], 'payment_rejected', 'https://paimonq.com');
  assert.match(email.html, /คำสั่งซื้อนี้ถูกยกเลิกแล้ว/);
  assert.doesNotMatch(email.html, /ส่งหลักฐานใหม่/);
});

test('shipment notification includes tracking and leaves link out when site is absent', () => {
  const email = buildCampaignEmail({ pickup_code: 'OC-456', tracking_number: 'TRACK', shipping_carrier: 'Post' }, {}, {}, {}, [], 'shipped', '');
  assert.match(email.html, /TRACK/);
  assert.doesNotMatch(email.html, /Check order status<\/a>/);
});
