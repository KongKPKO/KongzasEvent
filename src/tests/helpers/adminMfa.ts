import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

// RFC 6238, SHA-1 / six digits, used only with disposable local test accounts.
export function totpCode(secret: string, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error('Invalid synthetic TOTP secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const hash = createHmac('sha1', bytes).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

export async function completeAdminMfa(page: Page, existingSecret?: string) {
  let secret = existingSecret;
  await expect(page.getByRole('heading', { name: 'Admin verification', exact: true })).toBeVisible();
  if (!secret) {
    const enrollment = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/v1/factors') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
    const response = await enrollment;
    if (!response.ok()) throw new Error('Synthetic MFA enrollment failed');
    const data = await response.json() as { totp: { secret: string } };
    secret = data.totp.secret;
    await expect(page.getByRole('img', { name: 'Private authenticator setup QR' })).toBeVisible();
    await expect.poll(() => page.getByRole('img', { name: 'Private authenticator setup QR' }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  }
  await page.getByLabel('Six-digit code', { exact: true }).fill(totpCode(secret));
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Admin verification', exact: true })).toBeHidden();
  return secret;
}

export async function verifyAdminMfaClient(client: SupabaseClient, secret: string) {
  const factors = await client.auth.mfa.listFactors();
  if (factors.error || !factors.data.totp[0]) throw new Error('Synthetic MFA factor unavailable');
  const result = await client.auth.mfa.challengeAndVerify({ factorId: factors.data.totp[0].id, code: totpCode(secret) });
  if (result.error) throw new Error('Synthetic MFA verification failed');
}

export async function resetSyntheticAdminMfa(service: SupabaseClient, userId: string) {
  const env = await import('./localSupabaseEnv');
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.resolveSupabaseTestEnv().url).hostname)) throw new Error('MFA fixture cleanup requires local Supabase');
  const listed = await service.auth.admin.mfa.listFactors({ userId });
  if (listed.error) throw listed.error;
  for (const factor of listed.data.factors) {
    const removed = await service.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (removed.error) throw removed.error;
  }
}
