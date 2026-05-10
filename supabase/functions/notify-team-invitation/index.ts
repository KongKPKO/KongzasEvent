// supabase/functions/notify-team-invitation/index.ts
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
    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return json({ error: "invitation_id is required" }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitation_id)) {
      return json({ error: "invitation_id must be a valid UUID" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Server is missing Supabase service configuration" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch invitation + artist name
    const { data: invitation, error: invError } = await supabase
      .from("artist_member_invitations")
      .select("id, invited_email, role, status, artist_id, artists(display_name)")
      .eq("id", invitation_id)
      .single();

    if (invError || !invitation) {
      return json({ error: "Invitation not found" }, 404);
    }

    // Only send for pending invitations — safe no-op otherwise
    if (invitation.status !== "pending") {
      return json({ ok: true, skipped: true, reason: "invitation is not pending" });
    }

    // Verify caller is owner or manager of this artist
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const callerToken = authHeader.slice(7);
      const callerClient = createClient(supabaseUrl, callerToken);
      const { data: roleCheck } = await callerClient.rpc("has_artist_role", {
        p_artist_id: invitation.artist_id,
        p_allowed_roles: ["owner", "manager"],
      });
      if (!roleCheck) {
        return json({ error: "permission denied" }, 403);
      }
    }
    // Note: if no Authorization header, allow (called internally without user context)

    const artistName = (invitation.artists as { display_name?: string } | null)?.display_name || "a booth";
    const roleLabel = getRoleLabel(invitation.role);

    const subject = `You've been invited to join ${artistName} on NireQ`;
    const html = buildInviteHtml(artistName, roleLabel);
    const text = buildInviteText(artistName, roleLabel);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      // Local dev: Mailpit HTTP API
      const mailpitApiUrl =
        Deno.env.get("MAILPIT_API_URL") || "http://host.docker.internal:54324/api/v1/send";

      const mailpitResponse = await fetch(mailpitApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "invites@nireq.local", Name: "NireQ" },
          To: [{ Email: invitation.invited_email, Name: invitation.invited_email }],
          Subject: subject,
          HTML: html,
          Text: text,
        }),
      });

      if (!mailpitResponse.ok) {
        const detail = await mailpitResponse.text();
        console.error("[notify-team-invitation] Mailpit failed:", detail);
        return json({ error: "Email delivery failed", detail }, 502);
      }

      const result = await mailpitResponse.json().catch(() => null);
      return json({ ok: true, delivered: true, provider: "mailpit", result });
    }

    // Production: Resend
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("APPLICATION_EMAIL_FROM") || "NireQ <invites@resend.dev>",
        to: [invitation.invited_email],
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[notify-team-invitation] Resend failed:", detail);
      return json({ error: "Email provider failed", detail }, 502);
    }

    return json({ ok: true, delivered: true, provider: "resend" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    manager: "Manager",
    seller: "Seller / POS Staff",
    queue_staff: "Queue Staff",
  };
  return labels[role] ?? role;
}

function escapeHtml(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildInviteHtml(artistName: string, roleLabel: string): string {
  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:520px">
  <h1 style="font-size:20px;margin:0 0 12px">
    You've been invited to join ${escapeHtml(artistName)} on NireQ
  </h1>
  <p>You have been invited as <strong>${escapeHtml(roleLabel)}</strong>.</p>
  <p>
    To accept this invitation, sign up or log in using
    <strong>this exact email address</strong>.
    Once logged in, you will see a prompt to accept the invitation.
  </p>
  <p style="color:#6b7280;font-size:13px">
    If you did not expect this invitation, you can ignore this email.
  </p>
</div>`;
}

function buildInviteText(artistName: string, roleLabel: string): string {
  return [
    `You've been invited to join ${artistName} on NireQ`,
    "",
    `Role: ${roleLabel}`,
    "",
    "To accept this invitation, sign up or log in using this exact email address.",
    "Once logged in, you will see a prompt to accept the invitation.",
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ].join("\n");
}
