import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const bucket = "feedback-screenshots";
const maxAttachmentBytes = 5 * 1024 * 1024;
const allowedTypes = new Map([
  ["image/jpeg", { extension: "jpg", magic: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ["image/png", { extension: "png", magic: (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a }],
  ["image/webp", { extension: "webp", magic: (bytes: Uint8Array) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" }],
]);

type IntakeResult = {
  id: string;
  reference: string;
  status: string;
  created: boolean;
  has_attachment: boolean;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxAttachmentBytes + 1024 * 1024) {
    return json({ error: "request_too_large" }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "server_configuration" }, 500);

  try {
    const form = await boundedForm(req);
    const input = parseInput(form);
    if ("error" in input) return json({ error: input.error }, 400);
    const attachmentCheck = await validateAttachment(input.attachment);
    if ("error" in attachmentCheck) return json({ error: attachmentCheck.error }, 400);

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const auth = await resolveCaller(req, supabaseUrl, anonKey);
    if (auth.error) return json({ error: auth.error }, 401);
    if (auth.userId) {
      const caller = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      });
      const active = await caller.rpc("is_account_active");
      if (active.error || active.data !== true) return json({ error: "account_inactive" }, 403);
    }

    const abuseScopeHashes = await abuseScopes(req, auth.userId, input.guestContact);
    const { data, error } = await service.rpc("feedback_intake", {
      p_user_id: auth.userId,
      p_category: input.category,
      p_subject: input.subject,
      p_details: input.details,
      p_module: input.module,
      p_guest_contact: input.guestContact,
      p_current_url: sanitizePageUrl(input.currentUrl),
      p_app_version: input.appVersion,
      p_browser_device: input.browserDevice,
      p_context: input.context,
      p_client_request_id: input.clientRequestId,
      p_abuse_scope_hashes: abuseScopeHashes,
      p_rate_limit: auth.userId ? 20 : 5,
      p_rate_window_seconds: 3600,
      p_global_scope_hash: auth.userId ? null : await sha256('nireq-feedback-global-guest-v1'),
      p_global_rate_limit: auth.userId ? null : 200,
      p_attachment_sha256: attachmentCheck.file?.sha256 || null,
    });
    if (error) {
      if (error.message.includes("rate_limited")) return json({ error: "rate_limited" }, 429);
      if (error.message.includes("request_conflict")) return json({ error: "request_conflict" }, 409);
      console.error("[feedback-submit] intake failed", error.code);
      return json({ error: "submission_failed" }, 500);
    }

    const ticket = data as IntakeResult;
    if (!attachmentCheck.file || ticket.has_attachment) {
      return json({ ok: true, reference: ticket.reference, status: ticket.status, duplicate: !ticket.created });
    }

    const file = attachmentCheck.file;
    const objectPath = `${ticket.id}/screenshot.${file.extension}`;
    let failureStage = 'storage_upload';
    try {
      const upload = await service.storage.from(bucket).upload(objectPath, file.bytes, {
        contentType: file.contentType,
        cacheControl: "3600",
        upsert: false,
      });
      if (upload.error) {
        if (ticket.created || !upload.error.message.toLowerCase().includes("exist")) throw upload.error;
        // A prior request may have uploaded successfully before its DB response
        // was lost. Reuse only the same immutable bytes, then finish metadata.
        const existing = await service.storage.from(bucket).download(objectPath);
        if (existing.error || !existing.data || await sha256(new Uint8Array(await existing.data.arrayBuffer())) !== file.sha256) {
          return json({ error: 'attachment_processing' }, 409);
        }
      }
      failureStage = 'attachment_metadata';
      const marked = await service.rpc("feedback_mark_attachment", {
        p_ticket_id: ticket.id,
        p_object_path: objectPath,
        p_original_name: file.originalName,
        p_content_type: file.contentType,
        p_size_bytes: file.bytes.byteLength,
        p_sha256: file.sha256,
      });
      if (marked.error) throw marked.error;
    } catch {
      // Keep validated bytes and the ticket for retries. A timed-out DB write may
      // still commit, so deleting the file here could break a committed attachment.
      console.error("[feedback-submit] attachment failed", failureStage);
      return json({ error: "attachment_failed" }, 500);
    }

    return json({ ok: true, reference: ticket.reference, status: ticket.status, duplicate: !ticket.created });
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") return json({ error: "request_too_large" }, 413);
    console.error("[feedback-submit] unexpected failure");
    return json({ error: "submission_failed" }, 500);
  }
});

function parseInput(form: FormData) {
  const value = (name: string, max: number) => String(form.get(name) || "").replaceAll("\0", "").trim().slice(0, max + 1);
  const category = value("category", 20);
  const subject = value("subject", 160);
  const details = value("details", 5000);
  const module = value("module", 80) || null;
  const guestContact = value("guest_contact", 255) || null;
  const currentUrl = value("current_url", 800) || null;
  const appVersion = value("app_version", 100) || null;
  const browserDevice = value("browser_device", 200) || null;
  const clientRequestId = value("client_request_id", 36);
  const rawContext = value("context", 2000) || "{}";
  let context: Record<string, string> = {};
  try {
    const parsed = JSON.parse(rawContext);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    context = Object.fromEntries(Object.entries(parsed)
      .filter(([key, item]) => ["workspace_type", "workspace_id"].includes(key) && typeof item === "string")
      .map(([key, item]) => [key, String(item).slice(0, 100)]));
  } catch { return { error: "invalid_context" } as const; }
  if (!["bug", "support", "suggestion"].includes(category)) return { error: "invalid_category" } as const;
  if (subject.length < 5 || subject.length > 160) return { error: "invalid_subject" } as const;
  if (details.length < 10 || details.length > 5000) return { error: "invalid_details" } as const;
  if (module && module.length > 80) return { error: "invalid_module" } as const;
  if (guestContact && (guestContact.length < 3 || guestContact.length > 255)) return { error: "invalid_contact" } as const;
  if ((currentUrl && currentUrl.length > 800) || (appVersion && appVersion.length > 100) || (browserDevice && browserDevice.length > 200)) return { error: 'invalid_context' } as const;
  if (Array.from(form.values()).filter(value => value instanceof File && value.size > 0).length > 1) return { error: 'attachment_count' } as const;
  if (!isUuid(clientRequestId)) return { error: "invalid_request_id" } as const;
  const attachmentValue = form.get("attachment");
  const attachment = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;
  return { category, subject, details, module, guestContact, currentUrl, appVersion, browserDevice, clientRequestId, context, attachment };
}

async function validateAttachment(attachment: File | null) {
  if (!attachment) return { file: null };
  if (attachment.size > maxAttachmentBytes) return { error: "attachment_too_large" } as const;
  const rule = allowedTypes.get(attachment.type.toLowerCase());
  if (!rule) return { error: "attachment_type" } as const;
  const bytes = new Uint8Array(await attachment.arrayBuffer());
  if (bytes.byteLength < 12 || !rule.magic(bytes)) return { error: "attachment_content" } as const;
  return {
    file: {
      bytes,
      contentType: attachment.type.toLowerCase(),
      extension: rule.extension,
      originalName: safeFilename(attachment.name),
      sha256: await sha256(bytes),
    },
  };
}

async function resolveCaller(req: Request, supabaseUrl: string, anonKey: string) {
  const header = req.headers.get("Authorization");
  if (!header) return { userId: null as string | null };
  if (!header.startsWith("Bearer ")) return { userId: null, error: 'invalid_authorization' };
  const token = header.slice(7);
  if (token === anonKey) return { userId: null as string | null };
  const caller = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await caller.auth.getUser(token);
  if (error || !data.user) return { userId: null, error: "invalid_authorization" };
  return { userId: data.user.id };
}

async function abuseScopes(req: Request, userId: string | null, contact: string | null) {
  if (userId) return [await sha256(`user:${userId}`)];
  // Proxy data contributes only to throttling at the Supabase edge boundary. It is never
  // an identity or authorization signal, and contact/fingerprint scopes limit spoofing.
  const forwardedChain = req.headers.get("x-forwarded-for")?.split(",").map(value => value.trim()).filter(Boolean) || [];
  const forwarded = forwardedChain[forwardedChain.length - 1]
    || "missing-ip";
  const agent = (req.headers.get("user-agent") || "missing-agent").slice(0, 200);
  const scopes = [await sha256(`guest-ip:${forwarded}`), await sha256(`guest-fingerprint:${forwarded}|${agent}`)];
  if (contact) scopes.push(await sha256(`guest-contact:${contact.toLowerCase()}`));
  return scopes;
}

function sanitizePageUrl(raw: string | null) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return `${url.origin}${url.pathname.replace(/(\/order\/)[^/]+/gi, "$1[redacted]")}`.slice(0, 500);
  } catch { return null; }
}

function safeFilename(name: string) {
  const cleaned = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "screenshot";
  return cleaned.slice(0, 180) || "screenshot";
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function boundedForm(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('missing_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxAttachmentBytes + 1024 * 1024) { await reader.cancel(); throw new Error('request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(req.url, { method: 'POST', headers: { 'Content-Type': req.headers.get('Content-Type') || '' }, body: bytes }).formData();
}
