import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Evidence-Content-Type",
  "Cache-Control": "private, no-store",
};
const json = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json("method_not_allowed", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !secret) return json("server_configuration", 500);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json("unauthorized", 401);
  const caller = createClient(url, anon, {
    auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
  });
  try {
    const user = await caller.auth.getUser(authorization.slice(7));
    if (user.error || !user.data.user) return json("unauthorized", 401);
    const active = await caller.rpc("is_account_management_active");
    if (active.error || active.data !== true) return json("forbidden", 403);

    // Bound the stream as well as Content-Length, which clients can omit.
    if (Number(req.headers.get("content-length")) > 4096) return json("invalid_request", 400);
    const reader = req.body?.getReader();
    if (!reader) return json("invalid_request", 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel(); return json("invalid_request", 400); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json("invalid_request", 400); }
    const path = body && typeof body === "object" && "path" in body ? body.path : null;
    if (typeof path !== "string" || !path || path.length > 1024 || /[\u0000-\u001f]/.test(path)) return json("invalid_request", 400);

    // Query with the caller's JWT: existing payment RLS enforces the shop and staff role.
    const payment = await caller.from("order_payments").select("order_id").eq("slip_url", path).limit(1);
    if (payment.error) return json("authorization_unavailable", 503);
    if (!payment.data?.length) return json("not_found", 404);
    const service = createClient(url, secret, { auth: { persistSession: false } });
    const file = await service.storage.from("PaymentEvidence").download(path);
    if (file.error || !file.data) return json("not_found", 404);
    const type = file.data.type;
    if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(type)) return json("unsupported_evidence", 415);
    return new Response(file.data, { headers: {
      ...cors,
      "Content-Type": "application/octet-stream",
      "X-Evidence-Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return json("evidence_unavailable", 500);
  }
});
