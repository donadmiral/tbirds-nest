// Platinum Circles -> Crisp bridge.
// The sender is ALWAYS taken from the verified JWT, never from the request body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRISP_URL = "https://owvusgpsfcrqrytocajo.functions.supabase.co/crisp-api";
const CRISP_KEY = Deno.env.get("CRISP_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (d: any, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";

    if (req.method === "GET" && action === "balance") {
      const cur = url.searchParams.get("currency") || "USD";
      const r = await fetch(CRISP_URL + "?endpoint=link-balance&external_user_id=" + user.id + "&currency=" + cur, {
        headers: { Authorization: "Bearer " + CRISP_KEY },
      });
      return json(await r.json(), r.status);
    }
    if (req.method === "GET" && action === "status") {
      const r = await fetch(CRISP_URL + "?endpoint=link-status&external_user_id=" + user.id, {
        headers: { Authorization: "Bearer " + CRISP_KEY },
      });
      return json(await r.json(), r.status);
    }

    if (req.method === "GET" && action === "peer-status") {
      const peer = url.searchParams.get("user") || "";
      if (!peer) return json({ linked: false });
      const r = await fetch(CRISP_URL + "?endpoint=link-status&external_user_id=" + peer, {
        headers: { Authorization: "Bearer " + CRISP_KEY },
      });
      return json(await r.json(), r.status);
    }

    if (req.method === "POST" && action === "unlink") {
      const r = await fetch(CRISP_URL + "?endpoint=link-unlink", { method: "POST", headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ external_user_id: user.id }) });
      return json(await r.json(), r.status);
    }

    if (req.method === "POST" && action === "otp-send") {
      const { email } = await req.json();
      if (!email) return json({ success: false, error: "Email required" }, 400);
      const r = await fetch(CRISP_URL + "?endpoint=link-otp-send", {
        method: "POST",
        headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return json(await r.json(), r.status);
    }

    if (req.method === "POST" && action === "otp-verify") {
      const { email, token } = await req.json();
      if (!email || !token) return json({ success: false, error: "Email and code required" }, 400);
      const r = await fetch(CRISP_URL + "?endpoint=link-otp-verify", {
        method: "POST",
        headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, external_user_id: user.id }),
      });
      return json(await r.json(), r.status);
    }
    if (req.method === "POST" && action === "link-signin") {
      const { email, password } = await req.json();
      if (!email || !password) return json({ success: false, error: "Email and password required" }, 400);
      const r = await fetch(CRISP_URL + "?endpoint=link-signin", {
        method: "POST",
        headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, external_user_id: user.id }),
      });
      return json(await r.json(), r.status);
    }
    if (req.method === "POST" && action === "link") {
      const { code } = await req.json();
      if (!code) return json({ success: false, error: "Code required" }, 400);
      const r = await fetch(CRISP_URL + "?endpoint=link", {
        method: "POST",
        headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ code: String(code).toUpperCase(), external_user_id: user.id }),
      });
      return json(await r.json(), r.status);
    }

    if (req.method === "POST" && action === "pay") {
      const body = await req.json();
      const { recipient_id, amount, currency = "USD", conversation_id, note, idempotency_key } = body;
      if (!recipient_id || !amount || !conversation_id) {
        return json({ success: false, error: "Missing recipient_id, amount or conversation_id" }, 400);
      }
      if (recipient_id === user.id) return json({ success: false, error: "Cannot send to yourself" }, 400);

      // Sender must actually be in this conversation
      const { data: conv } = await supabase.from("conversations")
        .select("id, user_1, user_2").eq("id", conversation_id).maybeSingle();
      if (!conv) return json({ success: false, error: "Conversation not found" }, 404);
      const parties = [conv.user_1, conv.user_2];
      if (!parties.includes(user.id) || !parties.includes(recipient_id)) {
        return json({ success: false, error: "Not a participant in this conversation" }, 403);
      }

      if (!(Number(amount) > 0) || Number(amount) > 100000) {
        return json({ success: false, error: "Amount must be greater than zero and under 100,000" }, 400);
      }
      if (!["USD", "ZWG"].includes(currency)) {
        return json({ success: false, error: "Unsupported currency" }, 400);
      }
      if (!idempotency_key || String(idempotency_key).length < 8) {
        return json({ success: false, error: "Missing idempotency key" }, 400);
      }

      // A repeat of the same intent must never charge again. Return what
      // happened the first time instead.
      const { data: prior } = await supabase.from("chat_payments")
        .select("id, status, tx_id, error")
        .eq("sender_id", user.id).eq("idempotency_key", idempotency_key).maybeSingle();
      if (prior) {
        if (prior.status === "pending") {
          return json({ success: false, pending: true, payment_id: prior.id,
            error: "That payment is still going through. Check your history before sending again." }, 409);
        }
        return json({ success: prior.status === "completed", tx_id: prior.tx_id,
          error: prior.error, payment_id: prior.id, idempotent: true },
          prior.status === "completed" ? 200 : 400);
      }

      // The row is created before the charge, so a crash mid-flight leaves a
      // pending record rather than a silent debit.
      const { data: pay, error: payErr } = await supabase.from("chat_payments").insert({
        listing_id: body?.listing_id ?? null,
        conversation_id, sender_id: user.id, recipient_id, idempotency_key,
        amount, currency, status: "pending", note: note ?? null,
      }).select("id").single();
      if (payErr) {
        // 23505 is a unique violation: two requests raced with the same key.
        if (payErr.code === "23505") {
          return json({ success: false, pending: true,
            error: "That payment is already going through." }, 409);
        }
        return json({ success: false, error: payErr.message }, 500);
      }
      if (!pay) return json({ success: false, error: "Could not start payment" }, 500);

      const r = await fetch(CRISP_URL + "?endpoint=p2p", {
        method: "POST",
        headers: { Authorization: "Bearer " + CRISP_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_external_id: user.id,
          recipient_external_id: recipient_id,
          amount: Number(amount),
          currency,
          partner_reference: pay.id,
          note: note ?? "Platinum Circles",
        }),
      });
      const result = await r.json();

      await supabase.from("chat_payments").update({
        status: result?.success ? "completed" : "failed",
        tx_id: result?.tx_id ?? null,
        error: result?.success ? null : (result?.error ?? "Unknown error"),
        completed_at: result?.success ? new Date().toISOString() : null,
      }).eq("id", pay.id);

      return json({ ...result, payment_id: pay.id }, result?.success ? 200 : 400);
    }

    return json({ success: false, error: "Unknown action" }, 404);
  } catch (e: any) {
    return json({ success: false, error: e.message }, 500);
  }
});