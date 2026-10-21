import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, X-Feedback-Content-Type",
};
const bucket = "feedback-screenshots";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "server_configuration" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const userResult = await caller.auth.getUser(authHeader.slice(7));
  if (userResult.error || !userResult.data.user) return json({ error: "unauthorized" }, 401);
  const admin = await caller.rpc("is_platform_admin");
  if (admin.error || admin.data !== true) return json({ error: "forbidden" }, 403);

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (["list", "detail", "attachment"].includes(action)) {
      const target = action === 'list' ? null : String(body.ticket_id || '');
      if (target !== null && !isUuid(target)) return json({ error: 'invalid_ticket' }, 400);
      const audit = await service.rpc('record_feedback_admin_access', { p_actor_id: userResult.data.user.id, p_action: action, p_ticket_id: target });
      if (audit.error) throw audit.error;
    }
    if (action === "list") {
      const page = integer(body.page, 1);
      const pageSize = integer(body.page_size, 20);
      const query = optional(body.query, 160);
      const status = enumValue(body.status, ["new", "in_progress", "resolved", "closed"]);
      const category = enumValue(body.category, ["bug", "support", "suggestion"]);
      if (!page || !pageSize || pageSize > 50 || (body.query && !query) || (body.status && !status) || (body.category && !category)) {
        return json({ error: "invalid_filter" }, 400);
      }
      const result = await service.rpc("feedback_admin_list", {
        p_query: query,
        p_status: status,
        p_category: category,
        p_page: page,
        p_page_size: pageSize,
      });
      if (result.error) throw result.error;
      return json({ ok: true, ...result.data });
    }

    const ticketId = String(body?.ticket_id || "");
    if (!isUuid(ticketId)) return json({ error: "invalid_ticket" }, 400);
    if (action === "detail") {
      const result = await service.rpc("feedback_admin_detail", { p_ticket_id: ticketId });
      if (result.error) throw result.error;
      if (!result.data) return json({ error: "not_found" }, 404);
      return json({ ok: true, ...result.data });
    }
    if (action === "update") {
      const status = enumValue(body.status, ["new", "in_progress", "resolved", "closed"]);
      const note = optional(body.note, 3000);
      const expectedStatus = enumValue(body.expected_status, ["new", "in_progress", "resolved", "closed"]);
      if (!isUuid(String(body.request_id || "")) || (status && !expectedStatus)) return json({ error: "invalid_action" }, 400);
      if ((body.status && !status) || (body.note && !note) || (!status && !note)) return json({ error: "invalid_action" }, 400);
      const result = await service.rpc("feedback_admin_action", {
        p_ticket_id: ticketId,
        p_actor_id: userResult.data.user.id,
        p_status: status,
        p_note: note,
        p_expected_status: expectedStatus,
        p_request_id: body.request_id,
      });
      if (result.error) throw result.error;
      if (!result.data) return json({ error: "not_found" }, 404);
      return json({ ok: true, ...result.data });
    }
    if (action === "attachment") {
      const attachment = await service.from("feedback_attachments")
        .select("object_path, original_name, content_type")
        .eq("ticket_id", ticketId).maybeSingle();
      if (attachment.error) throw attachment.error;
      if (!attachment.data) return json({ error: "not_found" }, 404);
      const download = await service.storage.from(bucket).download(attachment.data.object_path);
      if (download.error || !download.data) return json({ error: "not_found" }, 404);
      return new Response(download.data, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/octet-stream",
          "X-Feedback-Content-Type": attachment.data.content_type,
          "Cache-Control": "private, no-store",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(safeFilename(attachment.data.original_name))}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return json({ error: "invalid_action" }, 400);
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
    if (['status_conflict', 'request_conflict'].includes(message)) return json({ error: message }, 409);
    console.error("[feedback-admin] request failed");
    return json({ error: "request_failed" }, 500);
  }
});

function optional(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replaceAll("\0", "").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function enumValue(value: unknown, allowed: string[]) {
  const normalized = optional(value, 40);
  return normalized && allowed.includes(normalized) ? normalized : null;
}

function integer(value: unknown, fallback: number) {
  const parsed = value === null || value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeFilename(name: string) {
  return name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "screenshot";
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
