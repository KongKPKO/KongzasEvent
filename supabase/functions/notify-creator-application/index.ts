import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { applicationId, event = "submitted" } = await req.json();
    if (!applicationId) {
      return json({ error: "applicationId is required" }, 400);
    }

    if (!["submitted", "approved", "rejected"].includes(event)) {
      return json({ error: "event must be submitted, approved, or rejected" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server is missing Supabase service configuration" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: application, error } = await supabase
      .from("creator_applications")
      .select("*")
      .eq("id", applicationId)
      .single();

    if (error || !application) {
      return json({ error: error?.message || "Application not found" }, 404);
    }

    const adminEmail = Deno.env.get("ADMIN_APPLICATION_EMAIL") || "konglnwzas@gmail.com";
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const message = buildEmailMessage(application, event, adminEmail);

    if (!resendApiKey) {
      const mailpitApiUrl = Deno.env.get("MAILPIT_API_URL") || "http://host.docker.internal:54324/api/v1/send";
      const mailpitResponse = await fetch(mailpitApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "onboarding@nireq.local", Name: "Nireq" },
          To: [{ Email: message.to, Name: message.toName }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
        }),
      });

      if (!mailpitResponse.ok) {
        const detail = await mailpitResponse.text();
        console.error("[notify-creator-application] Mailpit failed:", detail);
        return json({ error: "Local Mailpit delivery failed", detail }, 502);
      }

      const mailpitResult = await mailpitResponse.json().catch(() => null);
      return json({ ok: true, delivered: true, provider: "mailpit", result: mailpitResult });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("APPLICATION_EMAIL_FROM") || "Nireq <onboarding@resend.dev>",
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[notify-creator-application] Resend failed:", detail);
      return json({ error: "Email provider failed", detail }, 502);
    }

    return json({ ok: true, delivered: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLink(url: unknown) {
  const value = String(url ?? "").trim();
  if (!value) return "-";
  return `<a href="${escapeHtml(value)}">${escapeHtml(value)}</a>`;
}

function buildEmailMessage(application: Record<string, unknown>, event: string, adminEmail: string) {
  if (event === "approved") {
    const to = String(application.email ?? "");
    return {
      to,
      toName: String(application.contact_name ?? "Creator"),
      subject: `Creator workspace approved: ${String(application.creator_name ?? "")}`,
      html: renderApprovedEmail(application),
      text: renderApprovedText(application),
    };
  }

  if (event === "rejected") {
    const to = String(application.email ?? "");
    return {
      to,
      toName: String(application.contact_name ?? "Creator"),
      subject: `Creator application update: ${String(application.creator_name ?? "")}`,
      html: renderRejectedEmail(application),
      text: renderRejectedText(application),
    };
  }

  return {
    to: adminEmail,
    toName: "Nireq Admin",
    subject: `New creator application: ${String(application.creator_name ?? "")}`,
    html: renderApplicationEmail(application),
    text: renderApplicationText(application),
  };
}

function appUrl(path: string) {
  const baseUrl = Deno.env.get("APP_SITE_URL") || "http://localhost:5173";
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function renderApplicationText(application: Record<string, unknown>) {
  return [
    "New creator application",
    `Status: ${String(application.status ?? "")}`,
    `Review page: ${appUrl("/admin/applications")}`,
    `Creator: ${String(application.creator_name ?? "")}`,
    `Contact: ${String(application.contact_name ?? "")} <${String(application.email ?? "")}>`,
    `Desired slug: ${String(application.desired_slug ?? "")}`,
    `Primary social: ${String(application.primary_social_url ?? "")}`,
    `Website: ${String(application.website_url ?? "")}`,
    `Instagram: ${String(application.instagram_url ?? "")}`,
    `X: ${String(application.x_url ?? "")}`,
    `Facebook: ${String(application.facebook_url ?? "")}`,
    `TikTok: ${String(application.tiktok_url ?? "")}`,
    "",
    String(application.application_note ?? ""),
  ].join("\n");
}

function renderApplicationEmail(application: Record<string, unknown>) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h1 style="font-size:20px;margin:0 0 12px">New creator application</h1>
      <p><a href="${escapeHtml(appUrl("/admin/applications"))}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700">Review application</a></p>
      <p><strong>Status:</strong> ${escapeHtml(application.status)}</p>
      <p><strong>Creator:</strong> ${escapeHtml(application.creator_name)}</p>
      <p><strong>Contact:</strong> ${escapeHtml(application.contact_name)} &lt;${escapeHtml(application.email)}&gt;</p>
      <p><strong>Desired slug:</strong> ${escapeHtml(application.desired_slug)}</p>
      <p><strong>Primary social:</strong> ${renderLink(application.primary_social_url)}</p>
      <p><strong>Website:</strong> ${renderLink(application.website_url)}</p>
      <p><strong>Instagram:</strong> ${renderLink(application.instagram_url)}</p>
      <p><strong>X:</strong> ${renderLink(application.x_url)}</p>
      <p><strong>Facebook:</strong> ${renderLink(application.facebook_url)}</p>
      <p><strong>TikTok:</strong> ${renderLink(application.tiktok_url)}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
      <p style="white-space:pre-wrap">${escapeHtml(application.application_note)}</p>
    </div>
  `;
}

function renderApprovedText(application: Record<string, unknown>) {
  return [
    "Your creator workspace has been approved",
    `Creator: ${String(application.creator_name ?? "")}`,
    `Workspace URL: ${appUrl(`/${String(application.desired_slug ?? "")}/home`)}`,
    `Creator login: ${appUrl("/manage-login")}`,
    "",
    "Use the email and password you created when you applied. We do not send or store your password in emails.",
  ].join("\n");
}

function renderApprovedEmail(application: Record<string, unknown>) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h1 style="font-size:20px;margin:0 0 12px">Your creator workspace is approved</h1>
      <p><strong>${escapeHtml(application.creator_name)}</strong> is ready to use.</p>
      <p>Sign in with the email and password you created when you applied. We do not send passwords by email.</p>
      <p><a href="${escapeHtml(appUrl("/manage-login"))}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700">Open creator login</a></p>
      <p style="color:#4b5563"><strong>Public page:</strong> <a href="${escapeHtml(appUrl(`/${String(application.desired_slug ?? "")}/home`))}">${escapeHtml(appUrl(`/${String(application.desired_slug ?? "")}/home`))}</a></p>
    </div>
  `;
}

function renderRejectedText(application: Record<string, unknown>) {
  return [
    "Creator application update",
    `Creator: ${String(application.creator_name ?? "")}`,
    "",
    "Review note:",
    String(application.review_note ?? "Your application was not approved at this time."),
    "",
    "You can reply to the platform owner if you need help updating your application details.",
  ].join("\n");
}

function renderRejectedEmail(application: Record<string, unknown>) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h1 style="font-size:20px;margin:0 0 12px">Creator application update</h1>
      <p>Your application for <strong>${escapeHtml(application.creator_name)}</strong> was not approved at this time.</p>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin:16px 0">
        <strong>Review note</strong>
        <p style="white-space:pre-wrap;margin:8px 0 0">${escapeHtml(application.review_note || "Your application was not approved at this time.")}</p>
      </div>
    </div>
  `;
}
