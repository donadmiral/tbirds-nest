import { PAYMENT_FIELDS, matchesReceipt, outcome, persistOutcome, recoverPayment, requestCrisp } from "./paymentRecovery.ts";
import type { Dependencies, Payment } from "./paymentRecovery.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const keyValid = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9:_-]{8,128}$/.test(value);
function sameIntent(prior: Payment, body: any) {
  return prior.recipient_id === body.recipient_id && prior.conversation_id === body.conversation_id &&
    Number(prior.amount) === Number(body.amount) && prior.currency === (body.currency ?? "USD") &&
    (prior.note ?? null) === (body.note ?? null) && (prior.listing_id ?? null) === (body.listing_id ?? null);
}
export function createBridgeHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    let inFlight: Payment | null = null;
    try {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!token) return json({ success: false, error: "Unauthorized" }, 401);
      const { data: authData, error: authErr } = await deps.db.auth.getUser(token);
      const user = authData?.user;
      if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "";
      if (req.method === "GET" && action === "payment-status") {
        const id = url.searchParams.get("payment_id");
        const key = url.searchParams.get("idempotency_key");
        if ((id && !uuid(id)) || (key && !keyValid(key)) || (!id && !key)) return json({ success: false, error: "Valid payment_id or idempotency_key required" }, 400);
        let query = deps.db.from("chat_payments").select(PAYMENT_FIELDS).eq("sender_id", user.id);
        if (id) query = query.eq("id", id);
        if (key) query = query.eq("idempotency_key", key);
        const { data, error } = await query.maybeSingle();
        if (error) return json({ success: false, code: "PAYMENT_STATUS_UNAVAILABLE", error: "Payment status unavailable" }, 503);
        if (!data) return json({ success: false, found: false, code: "PAYMENT_NOT_FOUND", error: "Payment not found" }, 404);
        const recovered = await recoverPayment(deps, data);
        return json(outcome(recovered.payment, recovered.persistenceError ? "RECEIPT_UPDATE_PENDING" : undefined));
      }
      if (req.method === "POST" && ["otp-send", "otp-verify", "link-signin"].includes(action)) {
        return json({ success: false, code: "IN_APP_LINK_APPROVAL_REQUIRED", error: "Approve Platinum Circles in IntoBank, then enter the linking code here." }, 410);
      }
      if (req.method === "GET" && ["balance", "status", "peer-status"].includes(action)) {
        let externalUser = user.id;
        if (action === "peer-status") {
          externalUser = url.searchParams.get("user") || "";
          if (!uuid(externalUser)) return json({ success: false, error: "Valid user required" }, 400);
          const { data, error } = await deps.db.from("conversations").select("id")
            .or(`and(user_1.eq.${user.id},user_2.eq.${externalUser}),and(user_2.eq.${user.id},user_1.eq.${externalUser})`).limit(1);
          if (error) return json({ success: false, error: "Conversation lookup unavailable" }, 503);
          if (!data?.length) return json({ success: false, error: "Conversation required" }, 403);
        }
        const params: Record<string, string> = { endpoint: action === "balance" ? "link-balance" : "link-status", external_user_id: externalUser };
        if (action === "balance") {
          params.currency = url.searchParams.get("currency") || "USD";
          if (!["USD", "ZWG"].includes(params.currency)) return json({ success: false, error: "Unsupported currency" }, 400);
        }
        const { data, response } = await requestCrisp(deps, params);
        if (action === "peer-status") return json({ linked: response.ok && data?.linked === true }, response.status);
        return json(data, response.status);
      }
      if (req.method === "POST" && ["link", "unlink"].includes(action)) {
        const body: Record<string, string> = { external_user_id: user.id };
        if (action === "link") {
          const input = await req.json();
          if (typeof input?.code !== "string" || !/^[A-F0-9]{8}$/i.test(input.code.trim())) return json({ success: false, error: "Valid 8-character approval code required" }, 400);
          body.code = input.code.trim().toUpperCase();
        }
        const { data, response } = await requestCrisp(deps, { endpoint: action === "link" ? "link" : "link-unlink" }, body);
        return json(data, response.status);
      }
      if (req.method !== "POST" || action !== "pay") return json({ success: false, error: "Unknown action" }, 404);
      const body = await req.json();
      if (!uuid(body?.recipient_id) || !uuid(body?.conversation_id) || !keyValid(body?.idempotency_key)) return json({ success: false, error: "Valid recipient, conversation and idempotency key required" }, 400);
      if (body.recipient_id === user.id) return json({ success: false, error: "Cannot send to yourself" }, 400);
      const amount = Number(body.amount);
      if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(body.amount)) || !(amount > 0 && amount <= 100000)) return json({ success: false, error: "Amount must be between 0.01 and 100,000 with at most two decimal places" }, 400);
      const currency = body.currency ?? "USD";
      if (!["USD", "ZWG"].includes(currency)) return json({ success: false, error: "Unsupported currency" }, 400);
      if ((body.note != null && (typeof body.note !== "string" || body.note.length > 500)) || (body.listing_id != null && !uuid(body.listing_id))) return json({ success: false, error: "Invalid payment details" }, 400);
      const conversation = await deps.db.from("conversations").select("id,user_1,user_2").eq("id", body.conversation_id).maybeSingle();
      if (conversation.error) return json({ success: false, error: "Conversation lookup unavailable" }, 503);
      if (!conversation.data) return json({ success: false, error: "Conversation not found" }, 404);
      if (![conversation.data.user_1, conversation.data.user_2].includes(user.id) || ![conversation.data.user_1, conversation.data.user_2].includes(body.recipient_id)) return json({ success: false, error: "Not a participant in this conversation" }, 403);
      const existing = async () => deps.db.from("chat_payments").select(PAYMENT_FIELDS).eq("sender_id", user.id).eq("idempotency_key", body.idempotency_key).maybeSingle();
      const prior = await existing();
      if (prior.error) return json({ success: false, error: "Payment lookup unavailable" }, 503);
      const returnPrior = async (payment: Payment) => {
        if (!sameIntent(payment, body)) return json({ success: false, code: "IDEMPOTENCY_CONFLICT", error: "This payment key belongs to different payment details" }, 409);
        const recovered = await recoverPayment(deps, payment);
        return json({ ...outcome(recovered.payment, recovered.persistenceError ? "RECEIPT_UPDATE_PENDING" : undefined), idempotent: true });
      };
      if (prior.data) return await returnPrior(prior.data);
      // Current Crisp P2P supports USD only. Existing records remain readable and
      // recoverable in their original denomination, without creating new ZWG work.
      if (currency !== "USD") return json({ success: false, submitted: false, code: "UNSUPPORTED_CHAT_CURRENCY", error: "Chat transfers currently support USD only" }, 400);
      if (!deps.crispKey || !deps.crispUrl) return json({ success: false, code: "CRISP_UNAVAILABLE", error: "Payment service unavailable" }, 503);
      const inserted = await deps.db.from("chat_payments").insert({
        conversation_id: body.conversation_id, sender_id: user.id, recipient_id: body.recipient_id,
        idempotency_key: body.idempotency_key, amount, currency, listing_id: body.listing_id ?? null,
        note: body.note ?? null, status: "pending",
      }).select(PAYMENT_FIELDS).single();
      if (inserted.error?.code === "23505") {
        const raced = await existing();
        if (!raced.error && raced.data) return await returnPrior(raced.data);
        return json({ success: true, status: "pending", pending: true, code: "PAYMENT_LOOKUP_PENDING" }, 202);
      }
      if (inserted.error || !inserted.data) return json({ success: false, error: "Could not record payment request" }, 503);
      inFlight = inserted.data;
      const { data, response } = await requestCrisp(deps, { endpoint: "p2p" }, {
        sender_external_id: user.id, recipient_external_id: body.recipient_id, amount, currency,
        partner_reference: inFlight!.id, note: body.note ?? "Platinum Circles",
      });
      if (response.ok && matchesReceipt(inFlight!, data)) {
        const updated = await persistOutcome(deps, inFlight!, { status: "completed", tx_id: data.tx_id, error: null });
        return json(outcome(updated.payment, updated.persistenceError ? "RECEIPT_UPDATE_PENDING" : undefined), updated.payment.status === "pending" ? 202 : 200);
      }
      // Only an explicit no-movement rejection is definitive. Generic RPC/HTTP errors
      // can follow a committed debit and remain pending until canonical recovery.
      if (response.status >= 400 && response.status < 500 && data?.success === false && data?.confirmed_not_sent === true) {
        const updated = await persistOutcome(deps, inFlight!, { status: "failed", tx_id: null, error: "Payment declined by the payment provider" });
        return json(outcome(updated.payment, updated.persistenceError ? "RECEIPT_UPDATE_PENDING" : undefined), updated.payment.status === "pending" ? 202 : 200);
      }
      return json(outcome(inFlight!, "PAYMENT_OUTCOME_UNCONFIRMED"), 202);
    } catch {
      if (inFlight) return json(outcome(inFlight, "PAYMENT_OUTCOME_UNCONFIRMED"), 202);
      return json({ success: false, code: "SERVICE_UNAVAILABLE", error: "Service temporarily unavailable" }, 503);
    }
  };
}
