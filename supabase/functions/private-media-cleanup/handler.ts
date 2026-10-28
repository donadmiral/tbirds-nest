type Job = {
  id: string;
  bucket: string;
  path: string;
  lease_token: string;
};
type Client = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: any;
    error: unknown;
  }>;
};
type Dependencies = {
  env(name: string): string | undefined;
  client(url: string, key: string): Client;
  fetch: typeof fetch;
  uuid(): string;
};
const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createPrivateMediaCleanup(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST")
      return json(405, { error: "Method not allowed" });
    const service = deps.env("SUPABASE_SERVICE_ROLE_KEY"),
      base = deps.env("SUPABASE_URL");
    if (!service || !base) return json(503, { error: "Cleanup unavailable" });
    const header = request.headers.get("Authorization") || "",
      token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token.length < 32 || token.length > 512 || token === service)
      return json(401, { error: "Unauthorized" });
    try {
      const client = deps.client(base, service),
        worker = deps.uuid();
      const auth = await client.rpc("validate_private_media_cleanup_token", {
        p_token: token,
      });
      if (auth.error)
        return json(503, { error: "Worker authentication unavailable" });
      if (auth.data !== true) return json(401, { error: "Unauthorized" });
      const claim = await client.rpc("claim_private_media_cleanup", {
        p_worker: worker,
        p_limit: 25,
      });
      if (claim.error || !Array.isArray(claim.data))
        return json(503, { error: "Queue unavailable" });
      let completed = 0;
      for (let at = 0; at < claim.data.length; at += 5)
        await Promise.all(
          claim.data.slice(at, at + 5).map(async (job: Job) => {
            if (
              !UUID.test(job?.id) ||
              job.lease_token !== worker ||
              !["chat-media", "chat-files"].includes(job.bucket) ||
              typeof job.path !== "string" ||
              !UUID.test(job.path.split("/")[0]) ||
              job.path.includes("%") ||
              job.path.includes("\\") ||
              job.path.split("/").some((p) => !p || p === "." || p === "..")
            )
              return;
            let success = false;
            try {
              const check = await client.rpc("private_media_erasure_safe", {
                p_locator: `${job.bucket}/${job.path}`,
              });
              if (!check.error && check.data === true) {
                const response = await deps.fetch(
                  `${base}/storage/v1/object/${job.bucket}`,
                  {
                    method: "DELETE",
                    headers: {
                      Authorization: `Bearer ${service}`,
                      apikey: service,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ prefixes: [job.path] }),
                    redirect: "error",
                    signal: AbortSignal.timeout(10000),
                  },
                );
                success = response.ok || response.status === 404;
                await response.body?.cancel();
              }
            } catch {}
            const finish = await client.rpc("finish_private_media_cleanup", {
              p_id: job.id,
              p_worker: worker,
              p_success: success,
            });
            if (success && !finish.error && finish.data === true) completed++;
          }),
        );
      return json(200, { processed: claim.data.length, completed });
    } catch {
      return json(503, { error: "Cleanup unavailable" });
    }
  };
}
