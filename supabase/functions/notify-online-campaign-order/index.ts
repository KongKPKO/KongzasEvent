import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NotificationEvent = "created" | "ready_for_pickup" | "shipped" | "payment_rejected" | "refund_required";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { order_id, order_code, event } = await req.json();
    if (!isUuid(order_id)) return json({ error: "order_id must be a valid UUID" }, 400);
    if (!["created", "ready_for_pickup", "shipped", "payment_rejected", "refund_required"].includes(event)) {
      return json({ error: "invalid notification event" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server is missing Supabase service configuration" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id, order_type, pickup_code, customer_name, customer_email,
        subtotal_price, shipping_fee, total_price, currency,
        fulfillment_method, pickup_status, pickup_point_snapshot,
        shipping_carrier, tracking_number,
        online_campaigns!inner (
          id, name, slug, artist_id,
          artists!inner (display_name, slug)
        )
      `)
      .eq("id", order_id)
      .single();

    if (orderError && orderError.code !== "PGRST116") {
      console.error("[notify-online-campaign-order] Order lookup failed:", orderError);
      throw new Error("Failed to load order");
    }
    if (!order || order.order_type !== "online_sale") return json({ error: "Order not found" }, 404);

    const campaign = one(order.online_campaigns);
    const artist = one(campaign?.artists);
    if (!campaign || !artist) return json({ error: "Order not found" }, 404);

    if (event === "created") {
      if (String(order.pickup_code || "").toUpperCase() !== String(order_code || "").trim().toUpperCase()) {
        return json({ error: "Order not found" }, 404);
      }
    } else {
      if (!anonKey) return json({ error: "Server is missing auth configuration" }, 500);
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing or invalid authorization header" }, 401);
      const callerToken = authHeader.slice(7);
      const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${callerToken}` } } });
      const { data: caller, error: callerError } = await callerClient.auth.getUser();
      if (callerError || !caller.user) return json({ error: "Missing or invalid authorization header" }, 401);
      const { data: allowed } = await callerClient.rpc("has_artist_role", {
        p_artist_id: campaign.artist_id,
        p_allowed_roles: ["owner", "manager", "seller"],
      });
      if (!allowed) return json({ error: "permission denied" }, 403);
    }

    const { data: payment } = await supabase
      .from("order_payments")
      .select("payment_status, amount_expected, currency, review_note")
      .eq("order_id", order_id)
      .single();
    if (!payment || !stateMatches(event, order, payment)) return json({ error: "Order state does not match notification" }, 409);

    const customerEmail = String(order.customer_email || "").trim();
    if (!customerEmail) return json({ error: "Customer email is missing" }, 422);

    const claim = await claimDelivery(supabase, order_id, `campaign:${event}`, event);
    if (!claim.shouldDeliver) return json({ ok: true, delivered: false, duplicate: true, status: claim.status });

    try {
      const { data: items } = await supabase
        .from("order_items")
        .select("quantity, price_per_unit, product_name_snapshot, products(name)")
        .eq("order_id", order_id);
      const message = buildEmail(order, campaign, artist, payment, Array.isArray(items) ? items : [], event);
      const delivery = await deliverEmail(customerEmail, String(order.customer_name || customerEmail), message);
      await finishDelivery(supabase, claim.id, "delivered");
      return json({ ok: true, delivered: true, ...delivery });
    } catch (deliveryError) {
      const detail = deliveryError instanceof Error ? deliveryError.message : "Email delivery failed";
      await finishDelivery(supabase, claim.id, "failed", detail);
      throw deliveryError;
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});

function stateMatches(event: NotificationEvent, order: Record<string, unknown>, payment: Record<string, unknown>) {
  if (event === "created") return payment.payment_status === "awaiting_payment";
  if (event === "ready_for_pickup") return payment.payment_status === "payment_confirmed" && order.fulfillment_method === "pickup" && order.pickup_status === "awaiting_pickup";
  if (event === "shipped") return payment.payment_status === "payment_confirmed" && order.fulfillment_method === "shipping" && order.pickup_status === "shipped" && Boolean(order.tracking_number);
  if (event === "payment_rejected") return payment.payment_status === "payment_rejected";
  return payment.payment_status === "refund_pending";
}

async function claimDelivery(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  deliveryKey: string,
  event: NotificationEvent,
): Promise<{ id: string; shouldDeliver: boolean; status: string }> {
  const now = new Date();
  const { data: inserted, error: insertError } = await supabase.from("preorder_notification_deliveries").insert({
    order_id: orderId,
    delivery_key: deliveryKey,
    notification_event: event,
    status: "sending",
    attempts: 1,
    claimed_at: now.toISOString(),
    updated_at: now.toISOString(),
  }).select("id, status").single();
  if (!insertError && inserted) return { id: inserted.id, shouldDeliver: true, status: inserted.status };
  if (insertError?.code !== "23505") throw insertError;

  const { data: existing, error: existingError } = await supabase.from("preorder_notification_deliveries")
    .select("id, status, attempts, claimed_at").eq("order_id", orderId).eq("delivery_key", deliveryKey).single();
  if (existingError || !existing) throw existingError || new Error("Notification delivery claim is missing");
  const claimIsFresh = now.getTime() - new Date(existing.claimed_at).getTime() < 2 * 60 * 1000;
  if (existing.status === "delivered" || (existing.status === "sending" && claimIsFresh)) {
    return { id: existing.id, shouldDeliver: false, status: existing.status };
  }

  const { data: reclaimed, error: reclaimError } = await supabase.from("preorder_notification_deliveries").update({
    status: "sending",
    attempts: Number(existing.attempts || 0) + 1,
    claimed_at: now.toISOString(),
    updated_at: now.toISOString(),
    last_error: null,
  }).eq("id", existing.id).eq("claimed_at", existing.claimed_at).select("id, status").maybeSingle();
  if (reclaimError) throw reclaimError;
  return reclaimed
    ? { id: reclaimed.id, shouldDeliver: true, status: reclaimed.status }
    : { id: existing.id, shouldDeliver: false, status: "sending" };
}

async function finishDelivery(
  supabase: ReturnType<typeof createClient>,
  id: string,
  status: "delivered" | "failed",
  lastError?: string,
) {
  const { error } = await supabase.from("preorder_notification_deliveries").update({
    status,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
    last_error: lastError || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

function buildEmail(
  order: Record<string, unknown>,
  campaign: Record<string, unknown>,
  artist: Record<string, unknown>,
  payment: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  event: NotificationEvent,
) {
  const orderCode = String(order.pickup_code || "");
  const artistName = String(artist.display_name || "NireQ creator");
  const campaignName = String(campaign.name || "Online campaign");
  const siteUrl = String(Deno.env.get("PUBLIC_SITE_URL") || "").replace(/\/$/, "");
  const orderUrl = siteUrl && artist.slug ? `${siteUrl}/${artist.slug}/order/${encodeURIComponent(orderCode)}` : "";
  const itemLines = items.map((item) => {
    const product = one(item.products);
    return `${Number(item.quantity || 0)}x ${String(item.product_name_snapshot || product?.name || "Item")}`;
  });
  const amount = formatPrice(Number(payment.amount_expected || order.total_price || 0), String(payment.currency || order.currency || "THB"));
  const content = eventContent(event, order, payment, artistName);
  const tracking = event === "shipped"
    ? `\nCarrier: ${String(order.shipping_carrier || "-")}\nTracking number: ${String(order.tracking_number || "")}`
    : "";
  const text = `${content.heading}\n\n${content.intro}\n\nCampaign: ${campaignName}\nOrder: ${orderCode}\nItems: ${itemLines.join(", ")}\nTotal: ${amount}${tracking}${orderUrl ? `\n\nCheck status: ${orderUrl}` : ""}`;
  const html = `<h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.intro)}</p><p><strong>Campaign:</strong> ${escapeHtml(campaignName)}<br><strong>Order:</strong> ${escapeHtml(orderCode)}<br><strong>Items:</strong> ${escapeHtml(itemLines.join(", "))}<br><strong>Total:</strong> ${escapeHtml(amount)}</p>${event === "shipped" ? `<p><strong>Carrier:</strong> ${escapeHtml(String(order.shipping_carrier || "-"))}<br><strong>Tracking number:</strong> ${escapeHtml(String(order.tracking_number || ""))}</p>` : ""}${orderUrl ? `<p><a href="${escapeHtml(orderUrl)}">Check order status</a></p>` : ""}`;
  return { subject: `${content.subject}: ${orderCode}`, text, html };
}

function eventContent(event: NotificationEvent, order: Record<string, unknown>, payment: Record<string, unknown>, artistName: string) {
  if (event === "created") return { subject: "Order received", heading: "Your order is reserved", intro: `${artistName} received your order. Complete payment before the countdown ends.` };
  if (event === "ready_for_pickup") return { subject: "Ready for pickup", heading: "Your order is ready for pickup", intro: `${artistName} confirmed your payment. Follow the pickup details on your order status page.` };
  if (event === "shipped") return { subject: "Order shipped", heading: "Your order has shipped", intro: `${artistName} shipped your order.` };
  if (event === "payment_rejected") return { subject: "Payment needs attention", heading: "Payment was not accepted", intro: String(payment.review_note || "Open your order status page for details.") };
  return { subject: "Refund required", heading: "The seller will arrange a refund", intro: String(payment.review_note || "Open your order status page for details.") };
}

async function deliverEmail(to: string, toName: string, message: { subject: string; html: string; text: string }) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    const response = await fetch(Deno.env.get("MAILPIT_API_URL") || "http://host.docker.internal:54324/api/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: "orders@nireq.local", Name: "NireQ" },
        To: [{ Email: to, Name: toName }],
        Subject: message.subject,
        HTML: message.html,
        Text: message.text,
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
    return { provider: "mailpit" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("PREORDER_EMAIL_FROM") || Deno.env.get("APPLICATION_EMAIL_FROM") || "NireQ <orders@resend.dev>",
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!response.ok) {
    console.error("[notify-online-campaign-order] Resend failed:", await response.text());
    throw new Error("Email provider failed");
  }
  return { provider: "resend" };
}

function one<T extends Record<string, unknown>>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
