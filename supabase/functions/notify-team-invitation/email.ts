export interface TeamInvitationEmailInput {
  artistName: string;
  inviterEmail: string;
  role: "manager" | "seller" | "queue_staff";
  roleLabel: string;
  eventNames: string[];
  accessUrl: string;
  managerSignupUrl?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eventAccessLabel(eventNames: string[]): string {
  return eventNames.length > 0 ? eventNames.join(", ") : "All events";
}

export function buildInviteHtml(input: TeamInvitationEmailInput): string {
  const eventItems = input.eventNames.length > 0
    ? `<ul style="margin:6px 0 0;padding-left:20px">${input.eventNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`
    : "<strong>All events</strong>";
  const primaryLabel = input.role === "manager" ? "Create manager account" : "Sign in and review invitation";
  const existingManagerLink = input.role === "manager"
    ? `<p style="margin:10px 0 0;font-size:14px">Already have a Paimon account? <a href="${escapeHtml(input.accessUrl)}">Sign in to review the invitation</a>.</p>`
    : "";

  return `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202641;max-width:560px;border-top:4px solid #3A7EBC;padding-top:16px">
  <h1 style="font-size:20px;margin:0 0 12px">
    You've been invited to join ${escapeHtml(input.artistName)} on Paimon
  </h1>
  <p><strong>Invited by:</strong> ${escapeHtml(input.inviterEmail)}</p>
  <p><strong>Role:</strong> ${escapeHtml(input.roleLabel)}</p>
  <div><strong>Event access:</strong>${input.eventNames.length > 0 ? "" : " "}${eventItems}</div>
  <p>
    Use <strong>this exact email address</strong> to sign in and accept the pending invitation.
    Access is granted from the saved Paimon invitation only after you accept it.
  </p>
  <p>
    <a href="${escapeHtml(input.managerSignupUrl ?? input.accessUrl)}" style="display:inline-block;background:#202641;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700">
      ${primaryLabel}
    </a>
  </p>
  ${existingManagerLink}
  <p style="color:#202641;font-size:13px">
    If you did not expect this invitation, you can ignore this email.
  </p>
</div>`;
}

export function buildInviteText(input: TeamInvitationEmailInput): string {
  const lines = [
    `You've been invited to join ${input.artistName} on Paimon`,
    "",
    `Invited by: ${input.inviterEmail}`,
    `Role: ${input.roleLabel}`,
    `Event access: ${eventAccessLabel(input.eventNames)}`,
    "",
    "Use this exact email address to sign in and accept the pending invitation.",
    "Access is granted from the saved Paimon invitation only after you accept it.",
    input.role === "manager" ? `Create manager account: ${input.managerSignupUrl}` : input.accessUrl,
  ];

  if (input.role === "manager") {
    lines.push(`Already have a Paimon account? Sign in: ${input.accessUrl}`);
  }

  lines.push("", "If you did not expect this invitation, you can ignore this email.");
  return lines.join("\n");
}
