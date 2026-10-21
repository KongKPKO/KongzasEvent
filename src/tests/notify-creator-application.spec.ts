import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';
import { totpCode } from './helpers/adminMfa';

// MFA setup responses contain a secret; capture only explicit post-verification screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const { url, anonKey, serviceKey } = resolveSupabaseTestEnv();
const isLocal = ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = 'LocalOnlyNotification123!';
const suffix = randomUUID().slice(0, 8);
const adminEmail = `notification-admin-${suffix}@example.com`;
const creatorEmail = `notification-creator-${suffix}@example.com`;

let applicationId = '';
let adminUserId = '';
let creatorUserId = '';
let adminAal1Token = '';
let adminAal2Token = '';
let creatorToken = '';

const createUser = async (email: string) => {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error(`Could not create ${email}`);
  return data.user.id;
};

const signIn = async (email: string) => {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error || new Error(`Could not sign in ${email}`);
  return { client, token: data.session.access_token };
};

const invoke = async (body: Record<string, unknown>, token?: string, useServiceKey = false) => {
  const response = await fetch(`${url}/functions/v1/notify-creator-application`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: useServiceKey ? serviceKey : anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

test.describe.serial('notify-creator-application authorization', () => {
  test.skip(!isLocal, 'Notification delivery security tests run only against local Supabase');

  test.beforeAll(async () => {
    if (!serviceKey || !anonKey) throw new Error('Local Supabase keys are required');

    adminUserId = await createUser(adminEmail);
    creatorUserId = await createUser(creatorEmail);
    const { error: adminError } = await service.from('platform_admins').insert({
      admin_email: adminEmail,
      auth_user_id: adminUserId,
    });
    if (adminError) throw adminError;

    const { data: application, error: applicationError } = await service
      .from('creator_applications')
      .insert({
        auth_user_id: creatorUserId,
        email: creatorEmail,
        contact_name: 'Notification Creator',
        creator_name: 'Notification Test Shop',
        desired_slug: `notification-${suffix}`,
        primary_social_url: 'https://example.com/notification-creator',
        application_note: 'Synthetic local notification authorization fixture.',
        status: 'auto_approved',
      })
      .select('id')
      .single();
    if (applicationError || !application) throw applicationError || new Error('Could not create application');
    applicationId = application.id;

    const creatorSignIn = await signIn(creatorEmail);
    creatorToken = creatorSignIn.token;

    const adminSignIn = await signIn(adminEmail);
    adminAal1Token = adminSignIn.token;
    const enrollment = await adminSignIn.client.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollment.error) throw enrollment.error;
    const verification = await adminSignIn.client.auth.mfa.challengeAndVerify({
      factorId: enrollment.data.id,
      code: totpCode(enrollment.data.totp.secret),
    });
    if (verification.error) throw verification.error;
    adminAal2Token = verification.data.access_token;
  });

  test.afterAll(async () => {
    if (applicationId) await service.from('creator_applications').delete().eq('id', applicationId);
    if (creatorUserId) {
      await service.from('artist_members').delete().eq('artist_id', creatorUserId);
      await service.from('artists').delete().eq('id', creatorUserId);
    }
    if (adminUserId) await service.from('platform_admins').delete().eq('auth_user_id', adminUserId);
    if (creatorUserId) await service.auth.admin.deleteUser(creatorUserId);
    if (adminUserId) await service.auth.admin.deleteUser(adminUserId);
  });

  test('rejects anonymous and non-admin callers before delivery', async () => {
    expect(await invoke({ applicationId, event: 'auto_approved' })).toMatchObject({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(await invoke({ applicationId, event: 'auto_approved' }, creatorToken)).toMatchObject({
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  test('requires an AAL2 platform-admin session', async () => {
    expect(await invoke({ applicationId, event: 'auto_approved' }, adminAal1Token)).toMatchObject({
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  test('derives self-serve notification type from stored state for a trusted service caller', async () => {
    const result = await invoke({ applicationId }, undefined, true);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, event: 'auto_approved' });
  });

  test('rejects a forged decision and sends only the real stored decision', async () => {
    const { error } = await service.from('creator_applications').update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminUserId,
    }).eq('id', applicationId);
    if (error) throw error;

    expect(await invoke({ applicationId, event: 'rejected' }, adminAal2Token)).toMatchObject({
      status: 409,
      body: { error: 'Application state does not match the requested event' },
    });

    const result = await invoke({ applicationId, event: 'approved' }, adminAal2Token);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, event: 'approved' });
  });
});
