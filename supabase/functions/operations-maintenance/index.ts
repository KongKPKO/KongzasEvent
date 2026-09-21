import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-maintenance-token' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = Deno.env.get('MAINTENANCE_TOKEN');
    const maintenance = Boolean(token && req.headers.get('x-maintenance-token') === token);
    let reportId: string | null = null;
    if (!maintenance) {
      const input = await req.json();
      reportId = typeof input.reportId === 'string' ? input.reportId : null;
      if (!reportId || !/^[0-9a-f-]{36}$/i.test(reportId)) return json({ error: 'not_found' }, 404);
      const result = await service.from('order_problem_reports').select('order_id,artist_id').eq('id', reportId).maybeSingle();
      if (result.error) return json({ error: 'unavailable' }, 503);
      if (!result.data) return json({ error: 'not_found' }, 404);
      const order = await service.from('orders').select('pickup_code').eq('id', result.data.order_id).single();
      const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      if (!code || code !== order.data?.pickup_code?.toUpperCase()) {
        const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
        const allowed = await caller.rpc('has_artist_role', { p_artist_id: result.data.artist_id, p_allowed_roles: ['owner','manager'] });
        if (allowed.error || !allowed.data) return json({ error: 'not_found' }, 404);
      }
    }
    const claimed = await service.rpc('claim_problem_notifications', { p_report_id: reportId });
    if (claimed.error) return json({ error: 'queue_unavailable' }, 503);
    let sent = 0, failed = 0;
    for (const report of claimed.data || []) {
      try {
        let to = report.notification_to;
        let link = report.notification_url;
        if (!to || !link) {
          const owner = await service.auth.admin.getUserById(report.artist_id);
          if (owner.error || !owner.data.user.email) throw new Error('owner_email_unavailable');
          to = owner.data.user.email;
          const site = Deno.env.get('PUBLIC_SITE_URL') || (new URL(url).protocol === 'http:' ? 'http://localhost:5173' : '');
          if (!site) throw new Error('site_configuration_missing');
          link = `${site.replace(/\/$/, '')}/manage-order-problems`;
          const snapshot = await service.from('order_problem_reports').update({ notification_to: to, notification_url: link }).eq('id', report.id);
          if (snapshot.error) throw new Error('notification_snapshot_failed');
        }
        const subject = 'NireQ: มีปัญหาออเดอร์ใหม่ / New order problem';
        const text = `มีรายการแจ้งปัญหาใหม่ กรุณาเข้าสู่ระบบเพื่อดูรายละเอียดและติดต่อผู้ซื้อ\nA new order problem needs your attention. Sign in to review it and contact the buyer.\n${link}`;
        const key = Deno.env.get('RESEND_API_KEY');
        let response: Response;
        if (key) {
          response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `order-problem/${report.id}` },
            body: JSON.stringify({ from: Deno.env.get('PREORDER_EMAIL_FROM') || Deno.env.get('APPLICATION_EMAIL_FROM') || 'NireQ <preorders@resend.dev>', to: [to], subject, text }) });
        } else if (new URL(url).protocol === 'http:') {
          response = await fetch(Deno.env.get('MAILPIT_API_URL') || 'http://host.docker.internal:54324/api/v1/send', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ From: { Email: 'problems@nireq.local', Name: 'NireQ' }, To: [{ Email: to }], Subject: subject, Text: text }) });
        } else throw new Error('email_configuration_missing');
        if (!response.ok) throw new Error('email_provider_failed');
        const saved = await service.from('order_problem_reports').update({ notification_status: 'sent', notification_sent_at: new Date().toISOString() }).eq('id', report.id);
        if (saved.error) throw new Error('notification_status_failed');
        sent++;
      } catch {
        failed++;
        const marked = await service.from('order_problem_reports').update({ notification_status: 'failed' }).eq('id', report.id);
        console.error(marked.error ? '[maintenance] Could not persist notification failure' : '[maintenance] Notification failed; report retained');
      }
    }
    let purged = 0, deleted = 0;
    if (maintenance && Deno.env.get('ENABLE_RETENTION') === 'true') {
      const prepared = await service.rpc('prepare_order_retention');
      if (prepared.error) throw new Error('retention_preparation_failed');
      purged = prepared.data;
      const files = await service.rpc('claim_retention_files');
      if (files.error) throw new Error('retention_claim_failed');
      for (const file of files.data || []) {
        const removed = await service.storage.from(file.bucket).remove([file.path]);
        if (removed.error) { console.error('[maintenance] Storage deletion failed; retained for retry'); continue; }
        const finished = await service.rpc('finish_retention_file', { p_bucket: file.bucket, p_path: file.path });
        if (finished.error) { console.error('[maintenance] Deletion status failed; retained for retry'); continue; }
        deleted++;
      }
    }
    return json({ sent, failed, purged, deleted });
  } catch {
    console.error('[maintenance] Operation failed');
    return json({ error: 'maintenance_unavailable' }, 503);
  }
});
