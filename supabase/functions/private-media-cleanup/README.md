# Private media cleanup worker

This worker accepts a dedicated Vault-generated bearer credential, not user JWTs or the Supabase service key. The checked-in function configuration disables gateway JWT verification because the handler validates the scoped credential through a service-only hashed-verifier RPC.

The entire private cutover remains held until a compatible new native binary is ready: private SQL, session endpoint, signer, faststart exclusion, cleanup credentials and schedule. Common web, memory-book, story and Discover updates may ship with `NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED` unset or `false`; this preserves the existing “Open in phone app” fallback and does not activate this worker.

Do not deploy/enable cleanup independently of the coordinated client, private-media-session, signer and database cutover. See `docs/quality/PRIVATE_MEDIA_20261028.md` for prerequisites, safe deployment order, limits and acceptance tests. During that later cutover, stop and drain old faststart jobs for chat buckets before scheduling erasure.

The worker claims at most 25 objects, rechecks live-reference safety, deletes exact approved paths in groups of five, and records completion only for its own unexpired lease. Failures remain retryable. It never sweeps historical Storage objects and never exposes the invocation secret or service key in responses.
