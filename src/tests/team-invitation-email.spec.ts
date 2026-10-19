import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { ensureOwnerArtistFixture } from './helpers/adminFixture';
import { resolveSupabaseTestEnv } from './helpers/localSupabaseEnv';

// Run with the local Edge Function configured to the same local Mailpit instance.
test('staff invitation email carries saved scope and signs in without granting access before acceptance', async ({ request }) => {
  const env = resolveSupabaseTestEnv();
  if (!['127.0.0.1', 'localhost'].includes(new URL(env.url).hostname) || !env.mailpitUrl) throw new Error('Disposable local Auth and Mailpit required');
  test.setTimeout(90_000);
  const suffix = randomUUID();
  const ownerEmail = `invite-owner-${suffix}@example.test`;
  const password = 'LocalInviteEmail123!';
  const { userId: artistId, service } = await ensureOwnerArtistFixture({ email: ownerEmail, password, slug: `invite-${suffix.slice(0, 8)}`, displayName: 'Invitation test shop' });
  const owner = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const signedIn = await owner.auth.signInWithPassword({ email: ownerEmail, password });
  if (signedIn.error) throw signedIn.error;
  const token = signedIn.data.session!.access_token;
  const eventIds = [randomUUID(), randomUUID()];
  const createdUsers: string[] = [];
  const messages: string[] = [];
  const must = (result: { error: unknown }) => { if (result.error) throw result.error; };
  try {
    must(await service.from('events').insert(eventIds.map((id, index) => ({ id, artist_id: artistId, event_name: `Invite Event ${index + 1}`, status: 'Confirmed', start_date: new Date().toISOString(), end_date: new Date(Date.now() + 86400000).toISOString() }))));
    for (const role of ['seller', 'queue_staff', 'manager'] as const) {
      const email = `invite-${role}-${suffix}@example.test`;
      if (role === 'queue_staff') {
        const existing = await service.auth.admin.createUser({ email, password, email_confirm: true });
        if (existing.error) throw existing.error;
        createdUsers.push(existing.data.user.id);
      }
      const invitation = await owner.rpc('invite_team_member', { p_artist_id: artistId, p_email: email, p_role: role, p_event_ids: role === 'manager' ? [] : eventIds });
      must(invitation);
      const invitationId = invitation.data.invitation_id as string;
      const endpoint = `${env.url}/functions/v1/notify-team-invitation`;
      const noAuth = await request.post(endpoint, { data: { invitation_id: invitationId } });
      expect(noAuth.status()).toBe(401);
      const sent = await request.post(endpoint, { headers: { Authorization: `Bearer ${token}`, apikey: env.anonKey }, data: { invitation_id: invitationId, role: 'owner', event_names: ['Untrusted event'] } });
      expect(sent.status(), 'local Edge email must be delivered to Mailpit').toBe(200);
      expect((await sent.json()).delivered).toBe(true);
      let messageId = '';
      await expect.poll(async () => {
        const response = await request.get(`${env.mailpitUrl}/api/v1/messages`);
        const inbox = await response.json() as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
        messageId = inbox.messages.find(message => message.To.some(to => to.Address === email))?.ID || '';
        return Boolean(messageId);
      }).toBe(true);
      messages.push(messageId);
      const message = await (await request.get(`${env.mailpitUrl}/api/v1/message/${messageId}`)).json() as { HTML: string; Text: string };
      expect(message.Text.includes(`Invited by: ${ownerEmail}`)).toBe(true);
      expect(message.Text.includes(role === 'manager' ? 'Role: Manager' : role === 'seller' ? 'Role: Seller / POS Staff' : 'Role: Queue Staff')).toBe(true);
      expect(message.Text.includes('Untrusted event')).toBe(false);
      if (role === 'manager') expect(message.Text.includes('Event access: All events')).toBe(true);
      else for (const name of ['Invite Event 1', 'Invite Event 2']) expect(message.Text.includes(name)).toBe(true);
      if (role === 'manager') {
        expect(message.HTML).toContain('/staff-signup?email=');
        expect(message.HTML).toContain('/manage-login?redirect=');
        continue;
      }
      const rawLink = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
      if (!rawLink) throw new Error('Invitation is missing a sign-in link');
      const link = new URL(rawLink);
      expect(link.origin).toBe(new URL(env.url).origin);
      expect(link.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5173/invitations');
      const invitee = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
      const linkType = link.searchParams.get('type');
      if (linkType !== 'magiclink' && linkType !== 'signup') throw new Error('Unexpected staff sign-in link type');
      const verified = await invitee.auth.verifyOtp({ type: linkType, token_hash: link.searchParams.get('token')! });
      must(verified);
      if (role === 'seller') createdUsers.push(verified.data.user!.id);
      const before = await service.from('artist_members').select('id').eq('artist_id', artistId).eq('member_email', email);
      must(before);
      expect(before.data).toHaveLength(0);
      const denied = await request.post(endpoint, { headers: { Authorization: `Bearer ${verified.data.session!.access_token}`, apikey: env.anonKey }, data: { invitation_id: invitationId } });
      expect(denied.status()).toBe(403);
      must(await invitee.rpc('accept_team_invitation', { p_invitation_id: invitationId }));
      const member = await service.from('artist_members').select('id,role').eq('artist_id', artistId).eq('member_email', email).single();
      must(member);
      expect(member.data!.role).toBe(role);
      const assignments = await service.from('event_member_assignments').select('event_id').eq('member_id', member.data!.id);
      must(assignments);
      expect(assignments.data!.map(row => row.event_id).sort()).toEqual([...eventIds].sort());
    }
  } finally {
    must(await service.from('artist_member_invitations').delete().eq('artist_id', artistId));
    must(await service.from('artist_members').delete().eq('artist_id', artistId));
    must(await service.from('events').delete().eq('artist_id', artistId));
    must(await service.from('artists').delete().eq('id', artistId));
    const users = await service.auth.admin.listUsers({ perPage: 1000 });
    must(users);
    for (const user of users.data.users) if (user.email?.startsWith('invite-') && user.email.endsWith(`${suffix}@example.test`) && user.id !== artistId && !createdUsers.includes(user.id)) createdUsers.push(user.id);
    for (const id of createdUsers) must(await service.auth.admin.deleteUser(id));
    must(await service.auth.admin.deleteUser(artistId));
    for (const id of messages) await request.delete(`${env.mailpitUrl}/api/v1/messages`, { data: { IDs: [id] } });
  }
});
