import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {status,headers});
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers});
  if (req.method !== 'POST') return reply({error:'method_not_allowed'},405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const authorization = req.headers.get('Authorization') || '';
  const caller = createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
  const {data:user,error:authError} = await caller.auth.getUser();
  if (authError || !user.user) return reply({error:'unauthorized'},401);
  const {data:admin,error:roleError} = await caller.rpc('is_platform_admin');
  if (roleError || !admin) return reply({error:'forbidden'},403);
  const input = await req.json().catch(()=>null);
  if (!input || !uuid(input.order_id) || !uuid(input.request_id) || typeof input.reason !== 'string' || input.reason.trim().length<5 || input.reason.trim().length>500) return reply({error:'invalid_request'},400);
  const site = Deno.env.get('PUBLIC_SITE_URL');
  if (!site || !/^https?:\/\//.test(site)) return reply({error:'site_not_configured'},503);
  const service = createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:order,error:orderError} = await service.from('orders').select('id,event_id,campaign_id,pickup_code,customer_email').eq('id',input.order_id).single();
  if (orderError || !order) return reply({error:'order_not_found'},404);
  const {data:channel} = await service.from(order.campaign_id ? 'online_campaigns' : 'events').select('artist_id').eq('id',order.campaign_id || order.event_id).single();
  const {data:store} = channel ? await service.from('artists').select('slug').eq('id',channel.artist_id).single() : {data:null};
  if (!store?.slug) return reply({error:'order_not_found'},404);
  const {data:claim,error:claimError} = await caller.rpc('admin_order_email_claim',{p_order_id:input.order_id,p_request_id:input.request_id,p_reason:input.reason});
  if (claimError) {
    const code = ['forbidden','cooldown','invalid_request','request_conflict','unsupported_order','missing_email_or_code','order_not_found'].find(code=>claimError.message.includes(code)) || 'request_failed';
    return reply({error:code},code==='forbidden'?403:409);
  }
  if (!claim.send) return reply({status:claim.status,duplicate:true});
  const orderLink = `${site.replace(/\/$/,'')}/${encodeURIComponent(store.slug)}/order/${encodeURIComponent(order.pickup_code)}`;
  const subject = `ลิงก์สถานะคำสั่งซื้อ / Order status: ${order.pickup_code}`;
  const text = `ทีมช่วยเหลือ NireQ ส่งลิงก์สถานะคำสั่งซื้อให้คุณอีกครั้งตามคำขอ\nNireQ support has resent your order status link on request.\n\n${orderLink}\n\nเปิดลิงก์เพื่อดูสถานะล่าสุด อีเมลนี้ไม่ใช่การยืนยันชำระเงินหรือคำขอให้โอนเงินเพิ่ม\nOpen the link for the latest status. This email is not a payment confirmation or a request for another payment.`;
  let status = 'unknown';
  try {
    const key = Deno.env.get('RESEND_API_KEY');
    // Each explicit resend has its own identity; transport retries must reuse it.
    const response = key ? await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`admin-order-link/${input.request_id}`},
      body:JSON.stringify({from:Deno.env.get('PREORDER_EMAIL_FROM') || Deno.env.get('APPLICATION_EMAIL_FROM') || 'NireQ <orders@resend.dev>',to:[order.customer_email],subject,text}),
    }) : await fetch(Deno.env.get('MAILPIT_API_URL') || 'http://host.docker.internal:54324/api/v1/send',{
      method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},
      body:JSON.stringify({From:{Email:'support@nireq.local',Name:'NireQ'},To:[{Email:order.customer_email}],Subject:subject,Text:text}),
    });
    status = response.ok ? 'accepted' : response.status>=500 ? 'unknown' : 'failed';
    await response.body?.cancel();
  } catch { /* Provider outcome may be unknown; never automatically send again. */ }
  const {error:finishError} = await service.from('admin_order_email_resends').update({status,finished_at:new Date().toISOString()}).eq('id',input.request_id).eq('status','sending');
  return reply({status:finishError?'unknown':status});
});
