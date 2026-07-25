// supabase/functions/create-business/index.ts
//
// Creates a business as its own profiles row, backed by a shadow auth user that
// nobody ever signs into. The caller becomes its owner in business_members.
//
// Why an Edge Function: creating an auth user requires the service role, which
// must never reach the client. The caller's own JWT is verified first so a
// business can only be created by a real signed-in person.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SB_URL || !SB_SERVICE || !SB_ANON) {
    console.error("Missing env vars");
    return json(500, { error: "Server not configured" });
  }

  // 1. Who is asking. The caller's JWT, not the service role.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(SB_URL, SB_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: me, error: meErr } = await asCaller.auth.getUser();
  if (meErr || !me?.user) return json(401, { error: "Not authenticated" });
  const ownerId = me.user.id;

  // 2. Validate input.
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }

  const name = String(body?.name ?? "").trim();
  const username = String(body?.username ?? "").trim().toLowerCase();
  const category = String(body?.category ?? "").trim();

  if (name.length < 2) return json(400, { error: "Business name is too short" });
  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return json(400, { error: "Username must be 3 to 30 characters, lowercase letters, numbers or underscores" });
  }

  const admin = createClient(SB_URL, SB_SERVICE);

  // 3. Username must be free. Checked server side, not just in the UI.
  const { data: available, error: availErr } = await admin
    .rpc("is_username_available", { p_username: username });
  if (availErr) return json(500, { error: availErr.message });
  if (!available) return json(409, { error: "That username is taken" });

  // 4. Mint the shadow user. A long random password nobody keeps, and the email
  //    confirmed immediately since the address does not receive mail.
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const email = `biz-${crypto.randomUUID()}@biz.platinumcircles.app`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: secret,
    email_confirm: true,
    user_metadata: { full_name: name, is_business: true, created_by: ownerId },
  });
  if (createErr || !created?.user) {
    console.error("createUser failed:", createErr?.message);
    return json(500, { error: createErr?.message ?? "Could not create the business account" });
  }
  const businessId = created.user.id;

  // 5. Stamp the profile, create the extension row, make the caller owner.
  const { data: finalised, error: finErr } = await admin.rpc("finalise_business", {
    p_business_id: businessId,
    p_name: name,
    p_username: username,
    p_category: category,
    p_owner_id: ownerId,
  });

  if (finErr) {
    // Do not leave an orphaned auth user behind.
    console.error("finalise_business failed, rolling back auth user:", finErr.message);
    await admin.auth.admin.deleteUser(businessId).catch(() => {});
    return json(500, { error: finErr.message });
  }

  return json(200, { business: finalised });
});