// health-check: the synthetic user. Signs in as a dedicated test account and
// walks the journeys that matter, timing each. A step that ERRORS is an
// incident at once. A step that is merely SLOW is recorded and only becomes an
// incident when it stays slow across three consecutive runs, and the same
// incident is not raised again within an hour. Recovery is announced once.
// Meant to run on a schedule every ten minutes.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

// Per-step budgets in milliseconds. Sign-in and the two feed reads warm up on the first request after idle.
const BUDGET_MS: Record<string, number> = {
  sign_in: 4000, feed: 3500, notifications: 3500, profile: 2500,
  post_write: 3000, post_read: 2500, post_delete: 2500,
  storage_asset: 2500, push_function: 2500, realtime_endpoint: 2500,
};
const SUSTAINED_RUNS = 3;      // slow in this many consecutive runs before it counts
const REPEAT_QUIET_MIN = 60;   // the same incident is not re-raised inside this window

type Step = { name: string; ok: boolean; slow: boolean; ms: number; detail?: string };

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
    try {
      const d = await fn(); const ms = Date.now() - t0; const slow = ms > (BUDGET_MS[name] ?? 2500);
      steps.push({ name, ok: true, slow, ms, detail: slow ? "slow" : (d || undefined) });
    } catch (e) { steps.push({ name, ok: false, slow: false, ms: Date.now() - t0, detail: (e as Error)?.message || String(e) }); }
  };

  let uid: string | null = null;
  await run("sign_in", async () => { const { data, error } = await user.auth.signInWithPassword({ email, password }); if (error || !data.session) throw error || new Error("no session"); uid = data.user.id; });
  await run("feed", async () => { const { data, error } = await user.rpc("get_feed", { p_mode: "latest", p_limit: 5 }); if (error) throw error; return "rows " + ((data as unknown[]) || []).length; });
  await run("notifications", async () => { const { error } = await user.rpc("get_notifications", { p_limit: 5 }); if (error) throw error; });
  await run("profile", async () => { if (!uid) throw new Error("no user"); const { data, error } = await user.from("profiles").select("id, username").eq("id", uid).maybeSingle(); if (error || !data) throw error || new Error("no profile"); });
  let postId: string | null = null;
  await run("post_write", async () => { const { data, error } = await user.from("posts").insert({ user_id: uid, content: "health check " + new Date().toISOString(), audience: "everyone" }).select("id").single(); if (error) throw error; postId = (data as { id: string }).id; });
  await run("post_read", async () => { if (!postId) throw new Error("no post"); const { data, error } = await user.from("posts").select("id").eq("id", postId).maybeSingle(); if (error || !data) throw error || new Error("post not readable"); });
  await run("post_delete", async () => { if (!postId) throw new Error("no post"); const { error } = await user.from("posts").delete().eq("id", postId); if (error) throw error; });
  await run("storage_asset", async () => { const r = await fetch(url + "/storage/v1/object/public/post-media/", { method: "HEAD" }); if (r.status >= 500) throw new Error("storage " + r.status); return "status " + r.status; });
  await run("push_function", async () => { const r = await fetch(url + "/functions/v1/send-push-notification", { method: "OPTIONS" }); if (!r.ok) throw new Error("status " + r.status); });
  await run("realtime_endpoint", async () => { const r = await fetch(url + "/realtime/v1/", { method: "GET" }); if (r.status >= 500) throw new Error("realtime " + r.status); });
  try { await user.auth.signOut({ scope: "local" }); } catch {}

  const failed = steps.filter((s) => !s.ok);
  const slowNow = steps.filter((s) => s.ok && s.slow).map((s) => s.name);
  const totalMs = steps.reduce((a, s) => a + s.ms, 0);

  // What came before: the previous run's verdict (for the recovery notice) and the two before it (for sustained slowness).
  let prevRuns: { healthy: boolean; steps: Step[] }[] = [];
  try {
    const { data } = await admin.from("health_runs").select("healthy, steps").order("created_at", { ascending: false }).limit(SUSTAINED_RUNS - 1);
    prevRuns = ((data || []) as { healthy: boolean; steps: Step[] }[]);
  } catch { prevRuns = []; }
  const sustained = prevRuns.length >= SUSTAINED_RUNS - 1
    ? slowNow.filter((n) => prevRuns.every((r) => (r.steps || []).some((s) => s.name === n && (s.slow || s.detail === "slow"))))
    : [];

  const healthy = failed.length === 0 && sustained.length === 0;
  await admin.from("health_runs").insert({ healthy, total_ms: totalMs, steps }).then(() => {}, () => {});

  if (!healthy) {
    const summary = [
      ...failed.map((s) => s.name + (s.detail ? " (" + s.detail + ")" : "")),
      ...sustained.map((n) => n + " (slow for " + (SUSTAINED_RUNS * 10) + " minutes)"),
    ].join(", ");
    await admin.from("health_incidents").insert({ summary, steps }).then(() => {}, () => {});
    // The same incident does not ring again inside the quiet window.
    let recent = false;
    try {
      const since = new Date(Date.now() - REPEAT_QUIET_MIN * 60 * 1000).toISOString();
      const { data } = await admin.from("notifications").select("id").eq("type", "system").eq("message", "Health check failed: " + summary).gte("created_at", since).limit(1);
      recent = ((data || []) as unknown[]).length > 0;
    } catch { recent = false; }
    if (alertTo && !recent) {
      await admin.from("notifications").insert({ recipient_id: alertTo, actor_id: null, type: "system", message: "Health check failed: " + summary, data: { kind: "health", title: "System alert", steps: [...failed, ...steps.filter((s) => sustained.includes(s.name))] } }).then(() => {}, () => {});
    }
  } else if (alertTo && prevRuns.length > 0 && prevRuns[0].healthy === false) {
    await admin.from("notifications").insert({ recipient_id: alertTo, actor_id: null, type: "system", message: "Health check recovered: every step is back within budget", data: { kind: "health", title: "System alert", recovered: true } }).then(() => {}, () => {});
  }
  return json(healthy ? 200 : 503, { healthy, total_ms: totalMs, slow: slowNow, sustained, steps });
});
