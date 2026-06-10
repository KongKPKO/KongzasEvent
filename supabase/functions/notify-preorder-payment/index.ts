import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NotificationEvent = "submitted" | "confirmed" | "rejected";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { order_id, pickup_code, event = "submitted" } = await req.json();
    if (!isUuid(order_id)) {
      return json({ error: "order_id must be a valid UUID" }, 400);
    }
    if (!["submitted", "confirmed", "rejected"].includes(event)) {
      return json({ error: "event must be submitted, confirmed, or rejected" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server is missing Supabase service configuration" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id,
        event_id,
        order_type,
        pickup_code,
        customer_name,
        customer_email,
        total_price,
        currency,
        pickup_instructions,
        events (
          id,
          artist_id,
          event_name,
          start_date,
          location,
          booth_detail,
          artists (display_name, slug)
        )
      `)
      .eq("id", order_id)
      .single();

    if (orderError || !order || order.order_type !== "preorder") {
      return json({ error: "Pre-order not found" }, 404);
    }

    const payment = await fetchPayment(supabase, order_id);
    if (!payment) {
      return json({ error: "Payment record not found" }, 404);
    }

    if (event === "submitted") {
      if (String(order.pickup_code || "").toUpperCase() !== String(pickup_code || "").trim().toUpperCase()) {
        return json({ error: "Pre-order not found" }, 404);
      }
      if (payment.payment_status !== "payment_submitted") {
        return json({ error: "Payment is not submitted" }, 409);
      }
    } else {
      if (!anonKey) {
        return json({ error: "Server is missing auth configuration" }, 500);
      }
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return json({ error: "Missing or invalid authorization header" }, 401);
      }
      const callerToken = authHeader.slice(7);
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${callerToken}` } },
      });
      const { data: caller, error: callerError } = await callerClient.auth.getUser();
      if (callerError || !caller.user) {
        return json({ error: "Missing or invalid authorization header" }, 401);
      }
      const { data: roleCheck } = await callerClient.rpc("has_event_role", {
        p_event_id: order.event_id,
        p_allowed_roles: ["owner", "manager", "seller"],
      });
      if (!roleCheck) {
        return json({ error: "permission denied" }, 403);
      }

      if (event === "confirmed" && payment.payment_status !== "payment_confirmed") {
        return json({ error: "Payment is not confirmed" }, 409);
      }
      if (event === "rejected" && payment.payment_status !== "payment_rejected") {
        return json({ error: "Payment is not rejected" }, 409);
      }
    }

    const customerEmail = String(order.customer_email || "").trim();
    if (!customerEmail) {
      return json({ error: "Customer email is missing" }, 422);
    }

    const items = await fetchItems(supabase, order_id);
    const message = buildPreorderEmail(order, payment, items, event as NotificationEvent);
    const delivery = await deliverEmail(customerEmail, String(order.customer_name || customerEmail), message);
    return json({ ok: true, delivered: true, ...delivery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

async function fetchPayment(supabase: ReturnType<typeof createClient>, orderId: string) {
  const { data, error } = await supabase
    .from("order_payments")
    .select("payment_status, amount_expected, currency, submitted_at, confirmed_at, rejected_at, review_note")
    .eq("order_id", orderId)
    .single();

  if (error) return null;
  return data;
}

async function fetchItems(supabase: ReturnType<typeof createClient>, orderId: string) {
  const { data } = await supabase
    .from("order_items")
    .select("quantity, price_per_unit, currency, products(name)")
    .eq("order_id", orderId);

  return Array.isArray(data) ? data : [];
}

async function deliverEmail(
  to: string,
  toName: string,
  message: { subject: string; html: string; text: string },
) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    const mailpitApiUrl = Deno.env.get("MAILPIT_API_URL") || "http://host.docker.internal:54324/api/v1/send";
    const response = await fetch(mailpitApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: "preorders@nireq.local", Name: "NireQ" },
        To: [{ Email: to, Name: toName }],
        Subject: message.subject,
        HTML: message.html,
        Text: message.text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[notify-preorder-payment] Mailpit failed:", detail);
      throw new Error("Email delivery failed");
    }

    const result = await response.json().catch(() => null);
    return { provider: "mailpit", result };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("PREORDER_EMAIL_FROM") || Deno.env.get("APPLICATION_EMAIL_FROM") || "NireQ <preorders@resend.dev>",
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[notify-preorder-payment] Resend failed:", detail);
    throw new Error("Email provider failed");
  }

  return { provider: "resend" };
}

function buildPreorderEmail(
  order: Record<string, unknown>,
  payment: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  event: NotificationEvent,
) {
  const eventInfo = getEventInfo(order);
  const artistName = eventInfo.artistName || "NireQ creator";
  const eventName = eventInfo.eventName || "your event";
  const pickupCode = String(order.pickup_code || "");
  const amount = formatPrice(Number(payment.amount_expected || order.total_price || 0), String(payment.currency || order.currency || "THB"));
  const itemLines = items.map((item) => {
    const product = item.products as { name?: string } | { name?: string }[] | null;
    const productName = Array.isArray(product) ? product[0]?.name : product?.name;
    return `${Number(item.quantity || 0)}x ${productName || "Item"}`;
  });
  const locationLine = [eventInfo.location, eventInfo.boothDetail].filter(Boolean).join(" · ");
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "").replace(/\/$/, "");
  const orderUrl = siteUrl && eventInfo.artistSlug && pickupCode
    ? `${siteUrl}/${eventInfo.artistSlug}/order/${encodeURIComponent(pickupCode)}`
    : "";

  if (event === "confirmed") {
    return renderMessage({
      subject: `Payment confirmed: ${pickupCode}`,
      heading: "Payment confirmed",
      intro: `${artistName} confirmed your pre-order payment. Show this pickup code at the booth.`,
      status: "Ready for pickup",
      eventName,
      pickupCode,
      amount,
      locationLine,
      itemLines,
      orderUrl,
      note: String(order.pickup_instructions || "Show your pickup code to the booth staff."),
    });
  }

  if (event === "rejected") {
    return renderMessage({
      subject: `Payment needs attention: ${pickupCode}`,
      heading: "Payment was rejected",
      intro: `${artistName} could not confirm your transfer. Reserved stock has been released.`,
      status: "Rejected",
      eventName,
      pickupCode,
      amount,
      locationLine,
      itemLines,
      orderUrl,
      note: String(payment.review_note || "Please contact the seller before placing a new pre-order."),
    });
  }

  return renderMessage({
    subject: `Pre-order submitted: ${pickupCode}`,
    heading: "Pre-order submitted",
    intro: `${artistName} received your payment evidence. Your items are reserved while the seller checks the transfer.`,
    status: "Waiting for seller confirmation",
    eventName,
    pickupCode,
    amount,
    locationLine,
    itemLines,
    orderUrl,
    note: "We will email you again after the seller confirms or rejects the payment.",
  });
}

function renderMessage(input: {
  subject: string;
  heading: string;
  intro: string;
  status: string;
  eventName: string;
  pickupCode: string;
  amount: string;
  locationLine: string;
  itemLines: string[];
  orderUrl?: string;
  note: string;
}) {
  const itemsHtml = input.itemLines.length
    ? `<ul>${input.itemLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "<p>-</p>";
  const text = [
    input.heading,
    "",
    input.intro,
    "",
    `Status: ${input.status}`,
    `Event: ${input.eventName}`,
    `Pickup code: ${input.pickupCode}`,
    `Amount: ${input.amount}`,
    input.locationLine ? `Location: ${input.locationLine}` : "",
    input.orderUrl ? `Track your order: ${input.orderUrl}` : "",
    "",
    "Items:",
    ...(input.itemLines.length ? input.itemLines.map((line) => `- ${line}`) : ["-"]),
    "",
    input.note,
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(input.heading)}</h1>
      <p>${escapeHtml(input.intro)}</p>
      <div style="border:1px solid #f3d1e2;background:#fff7fb;border-radius:14px;padding:14px;margin:16px 0">
        <p style="margin:0 0 8px"><strong>Status:</strong> ${escapeHtml(input.status)}</p>
        <p style="margin:0 0 8px"><strong>Event:</strong> ${escapeHtml(input.eventName)}</p>
        <p style="margin:0 0 8px"><strong>Pickup code:</strong> <span style="font-family:monospace;font-size:20px;letter-spacing:3px">${escapeHtml(input.pickupCode)}</span></p>
        <p style="margin:0"><strong>Amount:</strong> ${escapeHtml(input.amount)}</p>
      </div>
      ${input.locationLine ? `<p><strong>Location:</strong> ${escapeHtml(input.locationLine)}</p>` : ""}
      ${input.orderUrl ? `<p style="margin:16px 0"><a href="${escapeHtml(input.orderUrl)}" style="display:inline-block;background:#db2777;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">Track your order</a></p>` : ""}
      <h2 style="font-size:14px;margin:18px 0 8px">Items</h2>
      ${itemsHtml}
      <p style="white-space:pre-wrap;color:#4b5563">${escapeHtml(input.note)}</p>
    </div>
  `;

  return { subject: input.subject, html, text };
}

function getEventInfo(order: Record<string, unknown>) {
  const event = order.events as Record<string, unknown> | Record<string, unknown>[] | null;
  const value = Array.isArray(event) ? event[0] : event;
  const artist = value?.artists as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const artistValue = Array.isArray(artist) ? artist[0] : artist;
  return {
    eventName: String(value?.event_name || ""),
    location: String(value?.location || ""),
    boothDetail: String(value?.booth_detail || ""),
    artistName: String(artistValue?.display_name || ""),
    artistSlug: String(artistValue?.slug || ""),
  };
}

function formatPrice(amount: number, currency: string) {
  if (currency === "THB") return `฿${amount.toLocaleString("th-TH")}`;
  return `${amount.toLocaleString()} ${currency}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
