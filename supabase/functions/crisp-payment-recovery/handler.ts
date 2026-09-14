import { PAYMENT_FIELDS, recoverPayment } from "../crisp-bridge/paymentRecovery.ts";
import type { Dependencies } from "../crisp-bridge/paymentRecovery.ts";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
async function matchesSecret(actual: string, expected: string) {
  if (!actual || expected.length < 32) return false;
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function createRecoveryHandler(deps: Dependencies & { serviceKey: string }) {
  return async (req: Request) => {
    if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);
    // Legacy project service-role JWT only. Keep the platform JWT check enabled.
    // Never accept a signed-in user or a caller-supplied role claim.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!await matchesSecret(token, deps.serviceKey)) return json({ success: false, error: "Service authentication required" }, 401);
    if (!deps.crispKey || !deps.crispUrl) return json({ success: false, code: "CRISP_UNAVAILABLE" }, 503);
    try {
      const limitText = new URL(req.url).searchParams.get("limit") || "20";
      if (!/^\d+$/.test(limitText)) return json({ success: false, error: "Invalid limit" }, 400);
      const limit = Math.min(50, Math.max(1, Number(limitText)));
      const now = deps.now?.() || new Date();
      const cutoff = new Date(now.getTime() - 60000).toISOString();
      const { data, error } = await deps.db.from("chat_payments").select(PAYMENT_FIELDS)
        .eq("status", "pending").lte("created_at", cutoff)
        .or(`last_status_check_at.is.null,last_status_check_at.lte.${cutoff}`)
        .order("last_status_check_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).limit(limit);
      if (error) return json({ success: false, code: "RECOVERY_QUERY_UNAVAILABLE" }, 503);
      let checked = 0, completed = 0, pending = 0, errors = 0;
      const deadline = Date.now() + 20000;
      for (const payment of data || []) {
        if (Date.now() >= deadline) break;
        const result = await recoverPayment(deps, payment);
        checked++;
        if (result.payment.status === "completed") completed++;
        if (result.payment.status === "pending") pending++;
        if (result.persistenceError || ("lookupError" in result && result.lookupError)) errors++;
      }
      // Aggregate outcomes only. Never disclose users or raw provider responses.
      return json({ success: errors === 0, checked, completed, pending, errors, remaining_in_batch: (data?.length || 0) - checked }, errors ? 503 : 200);
    } catch {
      return json({ success: false, code: "RECOVERY_UNAVAILABLE" }, 503);
    }
  };
}
