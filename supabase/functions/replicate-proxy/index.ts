// supabase/functions/replicate-proxy/index.ts
//
// The Replicate token used to be compiled into the app bundle as
// EXPO_PUBLIC_REPLICATE_API_TOKEN, which meant anyone who installed the app
// could extract it and spend the owner's money. It now lives here.
//
// This is deliberately NOT a general proxy. A pass-through would move the
// problem rather than fix it: anyone could run any model on the account. Only
// three operations are allowed, and creating a prediction is restricted to an
// allowlist of model versions.
//
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const REPLICATE = "https://api.replicate.com/v1";

// Versions the app is allowed to run. Set REPLICATE_ALLOWED_VERSIONS as a
// comma-separated list to add more without redeploying code.
const DEFAULT_ALLOWED = [
  "78f2bab438ab0ffc85a68cdfd316a2ecd3994b5dd26aa6b3d203357b45e5eb1b",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY");
  if (!TOKEN || !SB_URL || !SB_ANON) {
    console.error("Missing env vars");
    return json(500, { error: "Server not configured" });
  }

  // Only signed-in users. Without this the proxy is as open as the old token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me, error: meErr } = await asCaller.auth.getUser();
  if (meErr || !me?.user) return json(401, { error: "Not authenticated" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }

  const op = String(body?.op ?? "");

  // ── poll an existing prediction ───────────────────────────────────────────
  if (op === "get") {
    const id = String(body?.id ?? "");
    if (!/^[a-zA-Z0-9]+$/.test(id)) return json(400, { error: "Bad prediction id" });
    const r = await fetch(`${REPLICATE}/predictions/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    return json(r.status, await r.json());
  }

  // ── availability check ────────────────────────────────────────────────────
  if (op === "ping") {
    const r = await fetch(`${REPLICATE}/models`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    return json(r.ok ? 200 : r.status, { ok: r.ok });
  }

  // ── create a prediction, allowlisted ──────────────────────────────────────
  if (op === "create") {
    const version = String(body?.version ?? "");
    const extra = (Deno.env.get("REPLICATE_ALLOWED_VERSIONS") ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const allowed = new Set([...DEFAULT_ALLOWED, ...extra]);

    if (!allowed.has(version)) {
      console.warn("Blocked version:", version, "by", me.user.id);
      return json(403, { error: "That model is not permitted" });
    }

    const r = await fetch(`${REPLICATE}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, input: body?.input ?? {} }),
    });
    return json(r.status, await r.json());
  }

  return json(400, { error: "Unknown op" });
});