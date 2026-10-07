// Shared by user status and the service-only worker. Recovery never sends money.
export type Payment = {
  id: string; sender_id: string; recipient_id: string; conversation_id: string;
  idempotency_key: string; amount: number | string; currency: string;
  listing_id: string | null; note: string | null;
  status: "pending" | "completed" | "failed"; tx_id: string | null; error: string | null;
};
export const PAYMENT_FIELDS = "id,sender_id,recipient_id,conversation_id,idempotency_key,amount,currency,listing_id,note,status,tx_id,error";
// SDK injection allows offline tests of the actual production handler.
export type Dependencies = {
  db: any; crispUrl: string; crispKey: string; fetcher: typeof fetch; now?: () => Date;
};
export function outcome(payment: Payment, code?: string) {
  return {
    success: true, found: true, status: payment.status, pending: payment.status === "pending",
    payment_id: payment.id, tx_id: payment.tx_id,
    ...(payment.status === "failed" ? { error: payment.error || "Payment declined" } : {}),
    ...(code ? { code } : {}),
  };
}
export class CrispHopError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "CrispHopError"; }
}
const isTimeout = (e: unknown) => { const n = (e as { name?: string } | null)?.name; return n === "TimeoutError" || n === "AbortError"; };
export async function requestCrisp(deps: Dependencies, params: Record<string, string>, body?: unknown) {
  // Every failure on the hop to IntoBank's payment service names itself, so an outage is never
  // mistaken for an unlinked account and the cause is readable in the logs and on the phone.
  if (!deps.crispKey || !deps.crispUrl) throw new CrispHopError("CRISP_NOT_CONFIGURED", "IntoBank's payment service is not configured on this server.");
  let url: URL;
  try { url = new URL(deps.crispUrl); } catch { throw new CrispHopError("CRISP_NOT_CONFIGURED", "IntoBank's payment service address is not valid on this server."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname))) throw new CrispHopError("CRISP_NOT_CONFIGURED", "IntoBank's payment service address is not secure.");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const isRead = body === undefined;
  const attempt = () => deps.fetcher(url, {
    method: isRead ? "GET" : "POST",
    headers: { Authorization: `Bearer ${deps.crispKey}`, "Content-Type": "application/json" },
    ...(isRead ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(isRead ? 12000 : 7000),
  });
  let response: Response;
  try {
    response = await attempt();
  } catch (first) {
    // A read is safe to ask again: a cold start on the IntoBank side can outlast the first deadline. A payment is not retried here.
    if (!isRead) throw new CrispHopError(isTimeout(first) ? "CRISP_TIMEOUT" : "CRISP_UNREACHABLE", "IntoBank's payment service did not answer.");
    try { response = await attempt(); }
    catch (second) { throw new CrispHopError(isTimeout(second) ? "CRISP_TIMEOUT" : "CRISP_UNREACHABLE", isTimeout(second) ? `IntoBank's payment service at ${url.host} did not answer in time.` : `IntoBank's payment service at ${url.host} could not be reached.`); }
  }
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new CrispHopError("CRISP_BAD_RESPONSE", `IntoBank's payment service at ${url.host} answered status ${response.status} without a readable body.`); }
  return { response, data: data as any };
}
export function matchesReceipt(payment: Payment, data: any): boolean {
  return data?.success === true && typeof data.tx_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.tx_id) &&
    data.partner_reference === payment.id && data.currency === payment.currency &&
    (typeof data.amount === "number" || typeof data.amount === "string") &&
    /^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(data.amount)) &&
    Number.isFinite(Number(data.amount)) && Number(data.amount) > 0 &&
    Number(data.amount) === Number(payment.amount);
}
export async function persistOutcome(deps: Dependencies, payment: Payment,
  next: { status: "completed" | "failed"; tx_id: string | null; error: string | null }) {
  const { data, error } = await deps.db.from("chat_payments").update({
    ...next, completed_at: next.status === "completed" ? (deps.now?.() || new Date()).toISOString() : null,
  }).eq("id", payment.id).eq("status", "pending").select(PAYMENT_FIELDS).maybeSingle();
  // An error or zero-row write cannot manufacture a completed local receipt.
  if (error) return { payment, persistenceError: true };
  if (data) return { payment: data as Payment, persistenceError: false };
  const latest = await deps.db.from("chat_payments").select(PAYMENT_FIELDS).eq("id", payment.id).maybeSingle();
  if (latest.error || !latest.data) return { payment, persistenceError: true };
  return { payment: latest.data as Payment, persistenceError: false };
}
export async function recoverPayment(deps: Dependencies, payment: Payment) {
  if (payment.status !== "pending") return { payment, persistenceError: false, lookupError: false };
  // Rotate old unresolved work fairly. Timestamp errors are reported, not ignored.
  const touched = await deps.db.from("chat_payments").update({
    last_status_check_at: (deps.now?.() || new Date()).toISOString(),
  }).eq("id", payment.id).eq("status", "pending");
  try {
    const { response, data } = await requestCrisp(deps, { endpoint: "p2p-status", partner_reference: payment.id });
    if (response.ok && data?.status === "completed" && matchesReceipt(payment, data)) {
      return await persistOutcome(deps, payment, { status: "completed", tx_id: data.tx_id, error: null });
    }
    // A missing transaction can be delayed or still in flight. It is not failure.
    return { payment, persistenceError: Boolean(touched.error), lookupError: !response.ok || data?.success !== true || data?.status !== "not_found" };
  } catch {
    return { payment, persistenceError: Boolean(touched.error), lookupError: true };
  }
}
