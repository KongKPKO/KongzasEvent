import { expect, test } from '@playwright/test';

test('stored image paths and legacy proxy links resolve directly to Supabase', async ({ page }) => {
  const proxyRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'ik.imagekit.io') proxyRequests.push(request.url());
  });
  await page.goto('/cookies');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/utils/imageUtils.ts';
    const avatarPath = '/src/utils/avatarUrl.ts';
    const { getMenuImageUrl } = await import(modulePath);
    const { resolveAvatarUrl } = await import(avatarPath);
    const direct = getMenuImageUrl('public/test.webp');
    return {
      direct,
      absolute: getMenuImageUrl(direct),
      legacy: getMenuImageUrl('https://ik.imagekit.io/kongzas/Menu/public/test.webp?tr=w-520,q-80'),
      legacyPathTransform: getMenuImageUrl('https://ik.imagekit.io/kongzas/tr:w-300/Menu/public/test.webp'),
      avatar: resolveAvatarUrl('https://ik.imagekit.io/kongzas/Avatar/creator/avatar.webp?tr=w-400'),
      empty: getMenuImageUrl(''),
    };
  });
  expect(result.direct).toContain('/storage/v1/object/public/Menu/public/test.webp');
  expect(result.absolute).toBe(result.direct);
  expect(result.legacy).toBe(result.direct);
  expect(result.legacyPathTransform).toBe(result.direct);
  expect(result.avatar).toContain('/storage/v1/object/public/Avatar/creator/avatar.webp');
  expect(result.avatar).not.toContain('imagekit');
  expect(result.empty).toBe('');
  expect(proxyRequests).toEqual([]);
});
