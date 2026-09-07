// health-check: the synthetic user. Signs in as a dedicated test account and
// walks the journeys that matter, timing each. Any failure or slow step is
// written to health_incidents and pushed to the person on call through the
// app's own notifications. Meant to run on a schedule every ten minutes.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const SLOW_MS = 2500;

type Step = { name: string; ok: boolean; ms: number; detail?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const email = Deno.env.get("HEALTH_EMAIL"); const password = Deno.env.get("HEALTH_PASSWORD");
  const alertTo = Deno.env.get("HEALTH_ALERT_USER_ID");
  if (!email || !password) return json(500, { error: "HEALTH_EMAIL and HEALTH_PASSWORD are not set" });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = createClient(url, anon);
  const steps: Step[] = [];
  const run = async (name: string, fn: () => Promise<string | void>) => {
    const t0 = Date.now();
    try { const d = await fn(); const ms = Date.now() - t0; steps.push({ name, ok: ms <= SLOW_MS, ms, detail: ms > SLOW_MS ? "slow" : (d || undefined) }); }
    catch (e) { steps.push({ name, ok: false, ms: Date.now() - t0, detail: (e as Error)?.message || String(e) }); }
  };

  let uid: string | null = null;
  await run("sign_in", async () => { const { data, error } = await user.auth.signInWithPassword({ email, password }); if (error || !data.session) throw error || new Error("no session"); uid = data.user.id; });
  await run("feed", async () => { const { data, error } = await user.rpc("get_feed", { p_mode: "latest", p_limit: 5 }); if (error) throw error; return "rows " + ((data as unknown[]) || []).length; });
  await run("notifications", async () => { const { error } = await user.rpc("get_notifications", { p_limit: 5 }); if (error) throw error; });
  await run("profile", async () => { if (!uid) throw new Error("no user"); const { data, error } = await user.from("profiles").select("id, username").eq("id", uid).maybeSingle(); if (error || !data) throw error || new Error("no profile"); });
  let postId: string | null = null;
  await run("post_write", async () => { const { data, error } = await user.from("posts").insert({ user_id: uid, content: "health check " + new Date().toISOString(), audience: "everyone" }).select("id").single(); if (error) throw error; postId = data.id; });
  await run("post_read", async () => { if (!postId) throw new Error("no post"); const { data, error } = await user.from("posts").select("id").eq("id", postId).maybeSingle(); if (error || !data) throw error || new Error("post not readable"); });
  await run("post_delete", async () => { if (!postId) throw new Error("no post"); const { error } = await user.from("posts").delete().eq("id", postId); if (error) throw error; });
  await run("storage_asset", async () => { const r = await fetch(url + "/storage/v1/object/public/post-media/", { method: "HEAD" }); if (r.status >= 500) throw new Error("storage " + r.status); return "status " + r.status; });
  await run("push_function", async () => { const r = await fetch(url + "/functions/v1/send-push-notification", { method: "OPTIONS" }); if (!r.ok) throw new Error("status " + r.status); });
  await run("realtime_endpoint", async () => { const r = await fetch(url.replace("https://", "https://") + "/realtime/v1/", { method: "GET" }); if (r.status >= 500) throw new Error("realtime " + r.status); });
  try { await user.auth.signOut({ scope: "local" }); } catch {}

  const failed = steps.filter((s) => !s.ok);
  const healthy = failed.length === 0;
  const totalMs = steps.reduce((a, s) => a + s.ms, 0);
  await admin.from("health_runs").insert({ healthy, total_ms: totalMs, steps }).then(() => {}, () => {});
  if (!healthy) {
    const summary = failed.map((s) => s.name + (s.detail ? " (" + s.detail + ")" : "")).join(", ");
    await admin.from("health_incidents").insert({ summary, steps }).then(() => {}, () => {});
    if (alertTo) {
      await admin.from("notifications").insert({ recipient_id: alertTo, actor_id: null, type: "system", message: "Health check failed: " + summary, data: { kind: "health", steps: failed } }).then(() => {}, () => {});
    }
  }
  return json(healthy ? 200 : 503, { healthy, total_ms: totalMs, steps });
});