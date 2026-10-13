import { expect, test } from '@playwright/test';
import { uiText } from '../i18n';

test('workspace setup and operational copy have Thai translations', () => {
  for (const english of ['First-run guide', 'One clear step at a time', 'Booth profile', 'Products and stock', 'Payment and fulfillment', 'Preview and publish', 'Not required for live-only sales', 'Event Catalog', 'Charge', 'Call Next', 'Photo set']) {
    expect(uiText('th', english), english).toMatch(/[ก-๙]/);
    expect(uiText('en', english)).toBe(english);
  }
});

test('UI templates preserve merchant names, quantities and currency across language changes', () => {
  expect(uiText('th', 'Edit Home')).toBe('แก้ไข Home');
  expect(uiText('en', 'แก้ไข Home')).toBe('Edit Home');
  expect(uiText('th', 'Only USD products are enabled now.')).toBe('เปิดขายเฉพาะสินค้าสกุลเงิน USD แล้ว');
  expect(uiText('en', 'เปิดขายเฉพาะสินค้าสกุลเงิน USD แล้ว')).toBe('Only USD products are enabled now.');
  expect(uiText('th', 'Queue #12')).toBe('คิว #12');
  expect(uiText('th', '  Continue setup  ')).toBe('  ตั้งค่าต่อ  ');
});
