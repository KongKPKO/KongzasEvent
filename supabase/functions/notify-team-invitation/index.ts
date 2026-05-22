// supabase/functions/notify-team-invitation/index.ts
//
// Manual test examples (requires supabase functions serve running):
//
// 1. Missing auth → 401:
//    curl -s -X POST http://127.0.0.1:54321/functions/v1/notify-team-invitation \
//      -H 'Content-Type: application/json' \
//      -d '{"invitation_id":"<uuid>"}'
//    Expected: {"error":"Missing or invalid authorization header"}
//
// 2. Unauthorized staff → 403:
//    curl -s -X POST http://127.0.0.1:54321/functions/v1/notify-team-invitation \
//      -H 'Authorization: Bearer <staff_jwt>' \
//      -H 'Content-Type: application/json' \
//      -d '{"invitation_id":"<uuid>"}'
//    Expected: {"error":"permission denied"}
//
// 3. Authorized owner → email delivered:
//    curl -s -X POST http://127.0.0.1:54321/functions/v1/notify-team-invitation \
//      -H 'Authorization: Bearer <owner_jwt>' \
//      -H 'Content-Type: application/json' \
//      -d '{"invitation_id":"<uuid>"}'
//    Expected: {"ok":true,"delivered":true,"provider":"mailpit",...}
//
// 4. Invite creates pending row even when email fails:
//    The invite_team_member RPC inserts artist_member_invitations before
//    the edge function is called. Email failure (502) does NOT rollback the
//    invitation row. ManageTeam.tsx catches the notifyError and shows
//    "Invitation created, but the notification email failed to send." while
//    the pending row still appears in the Pending Invitations section.

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
    // Authorization is required — no anonymous or unauthenticated calls allowed
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid authorization header" }, 401);
    }
    const callerToken = authHeader.slice(7);

    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return json({ error: "invitation_id is required" }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitation_id)) {
      return json({ error: "invitation_id must be a valid UUID" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: "Server is missing Supabase service configuration" }, 500);
    }

    // Service role client — used only for trusted DB reads
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Caller client — uses anon key with the caller's JWT as Authorization header,
    // which is the correct pattern for scoped RPC calls with user context
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    const { data: caller, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller.user) {
      return json({ error: "Missing or invalid authorization header" }, 401);
    }

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

    // Verify caller is owner of this invitation's artist.
    // Team/invite management is owner-only; managers can operate events but
    // cannot resend or manage workspace invitations.
    const { data: roleCheck } = await callerClient.rpc("has_artist_role", {
      p_artist_id: invitation.artist_id,
      p_allowed_roles: ["owner"],
    });
    if (!roleCheck) {
      return json({ error: "permission denied" }, 403);
    }

    const artistName = (invitation.artists as { display_name?: string } | null)?.display_name || "a booth";
    const roleLabel = getRoleLabel(invitation.role);

    const appUrl = Deno.env.get("APPLICATION_SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") || "http://localhost:5174";
    const inviteUrl = `${appUrl.replace(/\/$/, "")}/staff-signup?email=${encodeURIComponent(invitation.invited_email)}&workspace=${encodeURIComponent(artistName)}`;
    const subject = `You've been invited to join ${artistName} on NireQ`;
    const html = buildInviteHtml(artistName, roleLabel, inviteUrl);
    const text = buildInviteText(artistName, roleLabel, inviteUrl);

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

function buildInviteHtml(artistName: string, roleLabel: string, inviteUrl: string): string {
  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:520px">
  <h1 style="font-size:20px;margin:0 0 12px">
    You've been invited to join ${escapeHtml(artistName)} on NireQ
  </h1>
  <p>You have been invited as <strong>${escapeHtml(roleLabel)}</strong>.</p>
  <p>
    To accept this invitation, create a team account or log in using
    <strong>this exact email address</strong>. This will not create a creator page.
  </p>
  <p>
    <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#db2777;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700">
      Open team invitation
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px">
    If you did not expect this invitation, you can ignore this email.
  </p>
</div>`;
}

function buildInviteText(artistName: string, roleLabel: string, inviteUrl: string): string {
  return [
    `You've been invited to join ${artistName} on NireQ`,
    "",
    `Role: ${roleLabel}`,
    "",
    "To accept this invitation, create a team account or log in using this exact email address.",
    "This will not create a creator page.",
    inviteUrl,
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ].join("\n");
}
