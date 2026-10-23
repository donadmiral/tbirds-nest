// One caller-bound database snapshot. Partial archives never return success.
type User = { id: string };
type SnapshotResult = { data: unknown; error: { message?: string; code?: string } | null };
type Dependencies = {
  authenticate: (authorization: string, signal: AbortSignal) => Promise<User | null>;
  snapshot: (authorization: string, signal: AbortSignal) => Promise<SnapshotResult>;
  maxBytes?: number;
  timeoutMs?: number;
};
export const EXPORT_COLLECTIONS = [
  "posts", "post_media", "comments", "likes", "saved", "reposts", "following", "followers",
  "stories", "story_views_given", "messages_sent", "listings", "job_applications", "support_tickets", "blocked", "push_devices",
] as const;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const headers = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function validSnapshot(value: unknown, owner: string): value is Record<string, unknown> {
  if (!object(value) || value.schema_version !== 2 || value.export_status !== "complete" ||
    !object(value.account) || value.account.id !== owner ||
    !(value.profile === null || (object(value.profile) && value.profile.id === owner)) ||
    !object(value.collection_counts) ||
    Object.keys(value.collection_counts).length !== EXPORT_COLLECTIONS.length) return false;
  if (typeof value.exported_at !== "string" || !Number.isFinite(Date.parse(value.exported_at)) ||
    value.records_through !== value.exported_at) return false;
  let total = 0;
  for (const name of EXPORT_COLLECTIONS) {
    const rows = value[name];
    if (!Array.isArray(rows) || value.collection_counts[name] !== rows.length) return false;
    total += rows.length;
  }
  return total <= 50000;
}
function failure(code: string, error: string, status = 503) {
  return Response.json({ export_status: "incomplete", code, error }, { status, headers });
}
export function createExportHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return failure("METHOD_NOT_ALLOWED", "POST required", 405);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("EXPORT_TIMEOUT"));
      }, deps.timeoutMs ?? 25000);
    });
    try {
      const authorization = req.headers.get("authorization") || "";
      if (!/^Bearer\s+\S+$/i.test(authorization)) return failure("AUTH_REQUIRED", "Sign in first", 401);
      const user = await Promise.race([deps.authenticate(authorization, controller.signal), deadline]);
      if (!user) return failure("AUTH_REQUIRED", "Sign in first", 401);
      const result = await Promise.race([deps.snapshot(authorization, controller.signal), deadline]);
      if (result.error) {
        if (result.error.message === "EXPORT_TOO_LARGE") return failure("EXPORT_TOO_LARGE", "Your archive is too large for an immediate download. Contact support to request a complete archive.", 413);
        if (result.error.code === "28000") return failure("AUTH_REQUIRED", "Sign in again to download your data.", 401);
        return failure("EXPORT_READ_FAILED", "Your archive could not be prepared. No partial archive was downloaded. Please retry.");
      }
      if (!validSnapshot(result.data, user.id)) return failure("EXPORT_INCOMPLETE", "A complete archive for your account could not be confirmed. Please retry.");
      const encoded = JSON.stringify(result.data);
      if (new TextEncoder().encode(encoded).byteLength > (deps.maxBytes ?? 16 * 1024 * 1024)) return failure("EXPORT_TOO_LARGE", "Your archive is too large for an immediate download. Contact support to request a complete archive.", 413);
      return new Response(encoded, { status: 200, headers });
    } catch {
      return failure("EXPORT_UNAVAILABLE", "Your archive could not be prepared. Please retry.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
