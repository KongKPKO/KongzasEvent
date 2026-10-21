import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { completeAdminMfa } from './helpers/adminMfa';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=', 'base64');

test('guest submits private screenshot; verified admin reads, annotates and resolves it', async ({ page }) => {
  test.setTimeout(90000);
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const suffix = randomUUID().slice(0, 8);
  const email = `feedback-admin-${suffix}@example.test`;
  const password = 'FeedbackAdmin123!';
  const subject = `Queue assistance ${suffix}`;
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `feedback-${suffix}`, displayName: 'Feedback administrator' });
  let ticketId: string | undefined;
  try {
    await page.addInitScript(() => localStorage.setItem('nireq-language', 'en'));
    await page.goto('/help?token=never-store-this');
    await page.getByLabel(/^Subject/).fill(subject);
    await page.getByLabel(/^Details/).fill('<script>window.feedbackExecuted=true</script> The queue failed to load.');
    await page.getByLabel('Contact details (optional)').fill(`guest-${suffix}@example.test`);
    await page.locator('input[type=file]').setInputFiles({ name: 'queue.png', mimeType: 'image/png', buffer: png });
    const submissionRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/functions/v1/feedback-submit'));
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await submissionRequest).headers().authorization || '').toBe('');
    await expect(page.getByRole('status')).toContainText('Sent successfully');
    const ticket = await service.from('feedback_tickets').select('id,reference,has_attachment').eq('subject', subject).single().throwOnError();
    ticketId = ticket.data!.id;
    expect(ticket.data!.has_attachment).toBe(true);
    const metadata = await service.from('feedback_ticket_metadata').select('current_url,abuse_key_hash').eq('ticket_id', ticketId).single().throwOnError();
    expect(metadata.data!.current_url).not.toContain('never-store-this');
    const attachment = await service.from('feedback_attachments').select('object_path').eq('ticket_id', ticketId).single().throwOnError();
    const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    expect((await anon.storage.from('feedback-screenshots').download(attachment.data!.object_path)).error).toBeTruthy();
    const forbidden = await anon.functions.invoke('feedback-admin', { body: { action: 'list' } });
    expect(forbidden.error).toBeTruthy();
    await service.from('platform_admins').insert({ admin_email: email, auth_user_id: userId }).throwOnError();
    await page.goto('/manage-login?redirect=/admin/feedback');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByTestId('creator-login-submit').click();
    await completeAdminMfa(page);
    await expect(page.getByRole('heading', { name: 'Feedback inbox', exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: new RegExp(ticket.data!.reference) }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(subject);
    expect(await page.evaluate(() => 'feedbackExecuted' in window)).toBe(false);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('textbox', { name: 'Internal note', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'View image', exact: true }).click();
    const image = dialog.getByRole('img', { name: 'User-submitted screenshot' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    let lostResponse = false;
    const noteRequests: string[] = [];
    await page.route('**/functions/v1/feedback-admin', async route => {
      const body = route.request().postDataJSON() as { action: string; note?: string; request_id?: string };
      if (body.action === 'update' && body.note) {
        noteRequests.push(body.request_id!);
        if (!lostResponse) { lostResponse = true; await route.fetch(); await route.abort('failed'); return; }
      }
      await route.continue();
    });
    await dialog.getByPlaceholder('Add context for the support team…').fill('Private support investigation');
    await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Could not save or load the attachment.');
    await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(dialog.locator('li').getByText('Private support investigation', { exact: true })).toBeVisible();
    expect(noteRequests).toHaveLength(2); expect(noteRequests[0]).toBe(noteRequests[1]);
    const notes = await service.from('feedback_internal_notes').select('id').eq('ticket_id', ticketId!).throwOnError();
    expect(notes.data).toHaveLength(1);
    await dialog.getByRole('combobox').selectOption('resolved', { timeout: 10000 });
    await expect(dialog.getByRole('button', { name: 'Save status', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Save status', exact: true }).click();
    await expect.poll(async () => (await service.from('feedback_tickets').select('status').eq('id', ticketId!).single()).data?.status).toBe('resolved');
    await expect(dialog.getByRole('button', { name: 'Save status', exact: true })).toBeVisible();
    await dialog.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `output/playwright/phase234/feedback-admin-${test.info().project.name}.png`, fullPage: true, animations: 'disabled', timeout: 10000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } finally {
    if (ticketId) {
      const metadata = await service.from('feedback_ticket_metadata').select('abuse_key_hash').eq('ticket_id', ticketId).maybeSingle();
      if (metadata.data) await service.from('feedback_rate_events').delete().eq('scope_hash', metadata.data.abuse_key_hash).throwOnError();
      const attachment = await service.from('feedback_attachments').select('object_path').eq('ticket_id', ticketId).maybeSingle();
      if (attachment.data) await service.storage.from('feedback-screenshots').remove([attachment.data.object_path]);
      await service.from('feedback_tickets').delete().eq('id', ticketId).throwOnError();
    }
    await service.from('platform_admins').delete().eq('auth_user_id', userId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
});

test('feedback intake rejects forged files and authenticates reporter visibility', async () => {
  const env = resolveSupabaseTestEnv();
  const suffix = randomUUID().slice(0, 8);
  const email = `feedback-reporter-${suffix}@example.test`, password = 'FeedbackReporter123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `reporter-${suffix}`, displayName: 'Reporter' });
  const user = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const guest = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  let ticketId: string | undefined;
  const requestId = randomUUID();
  const form = (attachment = false) => {
    const result = new FormData();
    result.set('category', 'suggestion'); result.set('subject', `Reporter suggestion ${suffix}`);
    result.set('details', 'Make the queue easier to follow'); result.set('client_request_id', requestId);
    if (attachment) result.set('attachment', new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }), 'forged.png');
    return result;
  };
  try {
    const signed = await user.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    expect((await user.functions.invoke('feedback-submit', { body: form(true) })).error).toBeTruthy();
    const submitted = await user.functions.invoke('feedback-submit', { body: form() });
    expect(submitted.error).toBeNull();
    expect(submitted.data).toMatchObject({ ok: true, duplicate: false });
    const duplicate = await user.functions.invoke('feedback-submit', { body: form() });
    expect(duplicate.data).toMatchObject({ reference: submitted.data.reference, duplicate: true });
    const own = await user.from('feedback_tickets').select('id,reference,status');
    expect(own.error).toBeNull(); expect(own.data).toHaveLength(1); ticketId = own.data![0].id;
    expect((await guest.from('feedback_tickets').select('reference')).error).toBeTruthy();
    expect((await user.from('feedback_internal_notes').select('*')).error).toBeTruthy();
    expect((await user.functions.invoke('feedback-admin', { body: { action: 'list' } })).error).toBeTruthy();
    expect((await user.rpc('feedback_admin_detail', { p_ticket_id: ticketId })).error).toBeTruthy();
  } finally {
    if (ticketId) await service.from('feedback_tickets').delete().eq('id', ticketId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId); if (removed.error) throw removed.error;
  }
});


test('feedback retry completes metadata after a successful upload with a lost DB response', async () => {
  const env = resolveSupabaseTestEnv();
  expect(new URL(env.url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  const suffix = randomUUID().slice(0, 8);
  const email = `feedback-retry-${suffix}@example.test`, password = 'FeedbackRetry123!';
  const { userId, service } = await ensureOwnerArtistFixture({ email, password, slug: `retry-${suffix}`, displayName: 'Retry reporter' });
  const caller = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const requestId = randomUUID();
  const subject = `Interrupted upload ${suffix}`, details = 'An upload succeeded before the connection dropped.';
  const sha = createHash('sha256').update(png).digest('hex');
  let ticketId: string | undefined;
  let path: string | undefined;
  try {
    const signed = await caller.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error;
    const intake = await service.rpc('feedback_intake', {
      p_user_id: userId, p_category: 'bug', p_subject: subject, p_details: details,
      p_module: null, p_guest_contact: null, p_current_url: null, p_app_version: null,
      p_browser_device: null, p_context: {}, p_client_request_id: requestId,
      p_abuse_scope_hashes: [createHash('sha256').update(`user:${userId}`).digest('hex')],
      p_rate_limit: 20, p_rate_window_seconds: 3600, p_attachment_sha256: sha,
    });
    if (intake.error) throw intake.error;
    ticketId = intake.data.id; path = `${ticketId}/screenshot.png`;
    const uploaded = await service.storage.from('feedback-screenshots').upload(path, png, { contentType: 'image/png' });
    if (uploaded.error) throw uploaded.error;
    const form = () => {
      const data = new FormData(); data.set('category', 'bug'); data.set('subject', subject);
      data.set('details', details); data.set('client_request_id', requestId);
      data.set('attachment', new Blob([png], { type: 'image/png' }), 'retry.png'); return data;
    };
    const recovered = await caller.functions.invoke('feedback-submit', { body: form() });
    expect(recovered.error).toBeNull(); expect(recovered.data).toMatchObject({ ok: true, duplicate: true });
    const duplicate = await caller.functions.invoke('feedback-submit', { body: form() });
    expect(duplicate.data).toMatchObject({ ok: true, duplicate: true, reference: recovered.data.reference });
    const marked = await service.from('feedback_tickets').select('has_attachment').eq('id', ticketId!).single().throwOnError();
    expect(marked.data!.has_attachment).toBe(true);
    const attachments = await service.from('feedback_attachments').select('id').eq('ticket_id', ticketId!).throwOnError();
    expect(attachments.data).toHaveLength(1);
    const bytes = await service.storage.from('feedback-screenshots').download(path);
    expect(bytes.error).toBeNull(); expect(Buffer.from(await bytes.data!.arrayBuffer())).toEqual(png);
  } finally {
    if (path) await service.storage.from('feedback-screenshots').remove([path]);
    if (ticketId) await service.from('feedback_tickets').delete().eq('id', ticketId).throwOnError();
    await service.from('artists').delete().eq('id', userId).throwOnError();
    const removed = await service.auth.admin.deleteUser(userId); if (removed.error) throw removed.error;
  }
});
