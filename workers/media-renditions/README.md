# Durable adaptive media v2

This package supplies the external FFmpeg worker. `../media-gateway` supplies a separate native Vercel Function for authorized HLS delivery with shared Runtime Cache. The existing Supabase `media-content` function handles HLS discovery and redirects only additive adaptive requests. Existing MP4 delivery and original uploaded objects remain intact.

## Delivered behavior

- A PostgreSQL job is keyed by the canonical Storage object ID, immutable source version and `hls-v2` profile. Only a currently published, owned, bound post/story source qualifies. Chat, view-once attachments and unbound uploads do not enter the queue.
- The worker claims one fenced, 15-minute lease. A database semaphore bounds concurrency across instances. Each attempt writes a different `owner/_renditions_v2/job/lease/` prefix in the private `adaptive-media` bucket.
- FFmpeg reads a locally admitted file, with external protocols disabled. It makes up to four H.264/AAC VOD renditions, aligned four-second segments, a master playlist and a progressive MP4 with faststart. Aspect ratio and rotation are respected, the ladder does not upscale, and frame rate is retained up to 60 fps. HDR input has a tone-map path to SDR. Originals are never overwritten.
- A complete asset manifest is registered before upload. The Storage trigger admits only its exact files under a live lease. Publication is atomic after every actual Storage record has the expected bytes, version, provenance and digest metadata. Late attempts cannot publish or recreate cleaned paths.
- Transient failures retry with bounded backoff and a shared provider cooldown; invalid input is a dead letter. Five attempts are available per retry cycle. The service-only `redrive_media_rendition_v2` explicitly starts another bounded cycle, retaining immutable attempt history. SIGTERM and deadlines settle a retry when possible; a killed process is recovered through lease expiry.
- Maintenance revalidates ready sources in bounded batches, seals failed/expired attempts, removes only registered Storage paths in batches of 100 and verifies physical removal. Failed/cancelled/blocked job records are pruned after 30 days only after cleanup succeeds. No Storage metadata-only delete substitutes for physical cleanup.

## Authorization and caching

The gateway evaluates the existing `resolve_media_delivery` access proof and current rendition publication when a playback authorization window begins. The shared regional Runtime Cache retains that decision for at most 30 seconds, with an absolute expiry that a hit never extends. Entries are encrypted and authenticated with a deployment secret and namespaced by Supabase origin; they contain no plaintext capabilities in a shared Hobby cache. No stale authorization is accepted after the deadline. An unavailable cache falls back to a new authorization, with bounded concurrent lookups and request deadlines.

The player keeps stable playlist URLs. Each child asset URL has an HMAC bound to the ticket, canonical source, immutable rendition lease, exact asset name, purpose and ticket expiry. A child cannot be substituted into another source. The original ticket expiry still applies. Existing authorized requests and already buffered bytes are not withdrawn; **new access decisions may retain revoked rights for up to 30 seconds**. This is deliberately different from the original gateway's per-request current-proof contract and must be accepted before adaptive delivery is activated. Disabling delivery or setting `emergency_revoke` takes effect for new authorization windows within the same bound. Rotate the capability secret for an immediate rejection of old child signatures when an emergency warrants interrupting playback.

Immutable asset metadata is shared across viewers. A private Storage signed URL is generated once and reused internally, with its actual expiry retained. This warms Supabase Smart CDN instead of producing a different origin cache key per viewer. The Storage token never enters player playlists, redirect headers or responses. The gateway streams segment bytes and progressive Range responses, verifies immutable ETags and sizes, propagates cancellation and rejects truncated or mismatched bodies. Public/browser response caching remains disabled. Runtime Cache holds metadata and authorization only, never video bodies.

Cold regional caches and cache eviction can cause extra database reads. Runtime Cache is not durable or globally shared across regions. Capacity tests must measure cold-cache bursts and cache-outage fallback, in addition to the warm-cache case. A warm shared window does not query rights for each HLS segment.

## Deployable components

| Component | Project root | Runtime | Required server environment |
| --- | --- | --- | --- |
| Rendition worker | `workers/media-renditions` | OCI container, Node 24, FFmpeg, one encoder per instance | `SUPABASE_URL`, `MEDIA_BROKER_URL`, worker-scoped `MEDIA_BROKER_KEY`, `CRON_SECRET` (at least 32 characters) |
| Delivery gateway | `workers/media-gateway` | Native Vercel Node 24 Function, `@vercel/functions` 3.10.3 | `SUPABASE_URL`, `MEDIA_BROKER_URL`, gateway-scoped `MEDIA_BROKER_KEY`, `MEDIA_CAPABILITY_SECRET` (at least 32 random characters), `MEDIA_PUBLIC_ORIGIN` (its canonical HTTPS origin) |
| Supabase relay | Existing `media-content` function | Supabase Edge | Existing service credentials stay within Edge; service-only `media_adaptive_gateway_origin_v2()` supplies the configured origin, or `MEDIA_ADAPTIVE_GATEWAY_ORIGIN` may override it |
| Browser player | Existing web app | React/hls.js 1.7.4 or native HLS | Build-time `NEXT_PUBLIC_ADAPTIVE_MEDIA=true` after rollout checks |
| Native player | Existing app | Expo Video native HLS | Build-time `EXPO_PUBLIC_ADAPTIVE_MEDIA=true` after rollout checks |

Enable access to source files outside the Root Directory for the gateway's monorepo build; its explicit imports trace the sibling gateway/core modules. Do not deploy the gateway inside the generic FFmpeg HTTP container: a native Vercel Function supplies the supported Runtime Cache request context. The two projects have independent scaling so encoding cannot occupy playback instances. No client receives a broker credential, service key, cron secret or capability-signing secret. The Supabase service key stays inside the existing Edge runtime.

### Scoped service credentials

`media-broker` accepts separate worker and gateway credentials in the form `key UUID.random 256-bit hex secret`. Only the SHA-256 hash is registered in the private database. Authentication compares every hash byte, checks expiry and revocation on each operation, enforces bounded 64-shard rate counters, and rejects reused request IDs or timestamps outside 60 seconds. A bounded indexed prune runs every five seconds so replay-state retention can drain faster than the normal worker/gateway key budgets, including rotation overlap. Keys expire after 90 days by default. Rotate by registering a new role-specific key, updating the corresponding protected server environment, deploying and verifying that host, then disabling the old key. No raw key belongs in source control, client environment, command-line arguments, or logs.

The broker accepts fixed media actions. It does not accept an arbitrary RPC, SQL, fetch URL or Storage path. Worker downloads and signed uploads come only from live, canonical lease descriptors and registered asset names. The Storage trigger still fences expired leases even though signed upload capabilities have a provider-defined lifetime. Physical cleanup requires the separate cleanup lease and exact registered names. Gateway signing rechecks the existing viewer ticket and current published rendition. Worker credentials cannot resolve viewer tickets and gateway credentials cannot claim or finish encode jobs. Public and authenticated database roles cannot read the key registry or call the broker helper functions. The direct service-key adapter remains available for an independently provisioned private host, but it is not required for this deployment.

The worker `GET /drain` or `POST /drain` requires `Authorization: Bearer <CRON_SECRET>`, stays inside the request until completion and accepts no arbitrary download URL. The disabled-by-default `20261102101149_media_worker_dispatch_v2.sql` dispatcher uses the existing Supabase `pg_cron` and `pg_net` services, once a minute, with its scoped cron secret in Vault. Vercel Hobby permits only daily Vercel cron schedules, so this package does not declare an invalid minute schedule. The dispatcher calls only the operator-configured HTTPS origin plus `/drain`, fences duplicate invocations for 55 seconds, and uses a 250-second request timeout. Duplicate cron deliveries are safe. Concurrent, authenticated drain requests can add throughput up to the database semaphore. The scheduler interval, concurrency and worker duration must be chosen from measured encode time and the approved operating budget.

`GET /health` returns only process health and busy state. Authenticated `GET /metrics` returns `media_processing_status_v1()`. That service-only RPC exposes capped queue counts, capped flags, oldest pending age, expired leases, cleanup backlog, worker last-seen time and the prior faststart queue count. It is suitable for the allowlisted capacity monitor.

### Compute and disk admission

The source profile ceiling is 512 MiB, output ceiling 768 MiB and duration ceiling 600 seconds. Those are bounds, not a promise that every hosting plan can process the full profile.

`MEDIA_WORKER_DEADLINE_MS` defaults to 240000 and is capped at 720000; the platform request duration must exceed it by at least 10 seconds. `MEDIA_WORKER_THREADS` defaults to 2 and is capped at 4. The worker uses actual free-space checks and a configured scratch ceiling. On Vercel it defaults to 450 MiB scratch and 128 MiB maximum input; other containers default to 2 GiB scratch and 512 MiB maximum input. Configure `MEDIA_WORKER_DISK_BYTES` and `MEDIA_WORKER_MAX_INPUT_BYTES` to the verified host allocation. Claims include the host input limit, so a smaller worker leaves larger jobs available for an appropriately sized worker. Output watchdogs and a faststart peak-space reservation prevent unchecked scratch growth.

Full-profile workers need at least 2 GiB usable scratch and enough measured CPU/request duration. Current Vercel runtime documentation describes roughly 500 MB writable `/tmp`; do not advertise full 512 MiB input support on that allocation. The same Dockerfile can run on a separately approved container host with larger scratch. No such host is silently provisioned by this change. A job beyond a host's capability retains its original playback and remains visible in queue monitoring.

### Installation and activation sequence

1. Apply `20261102090521_adaptive_media_renditions_v2.sql` after the v1 durable-media and media-delivery migrations, followed by `20261102100428_media_broker_scoped_credentials_v2.sql` and `20261102101149_media_worker_dispatch_v2.sql`. The migration is inert: all new gates are false and it performs no downloads, provider calls or cron activation.
2. Deploy the authenticated `media-broker` Edge Function. Register separate scoped key hashes, configure protected server environments on the private worker and native gateway, then deploy those hosts and the updated Supabase relay. Verify the worker schedule/duration/disk entitlement and gateway Runtime Cache on the actual plan.
3. On QA only, enable admission, worker and maintenance gates, publish a small synthetic owned post/story, and verify immutable job/asset publication, source preservation and cleanup. Test original, native HLS and hls.js playback, seeking, account change, expired ticket and a failure fallback through the actual hosted gateway. These steps use fictional media, not member uploads.
4. Enable the delivery gate for the reviewed QA flow, then build clients with their additive adaptive flag. The browser keeps its existing video element and controls. The native shared pool keeps canonical source identity and its three-player ceiling. A late readiness lookup never replaces running playback. Unsupported/unready adaptive delivery retains the original, and a decoder failure falls back once to the original with position/intent preserved.
5. Roll production gates and client builds only after the preceding checks. Admission enrolls new canonical bindings and source replacements. Existing uploads can be enrolled in small, explicitly selected batches through `enqueue_media_rendition_v2(object_id,version)`; the migration deliberately does not crawl all media.

The custom story/memory compositing/export engines continue to use their existing canonical sources. They are not silently switched to a transport that may change native composition support. Core web post playback, the native shared feed pool, fullscreen and Expo-video post viewers have additive HLS hooks. Physical iOS/Android and hosted browser playback remain a release check for any activated client build.

For rollback, first disable `admission_enabled` and `worker_enabled`; keep maintenance enabled until retired/failed attempts drain. Disable the adaptive delivery/client flag to return new playback to original delivery. Original objects, canonical content documents and v1 paths do not need restoration. Do not delete a published derivative merely to roll back an application; let bounded authorization expire and the cleanup queue retire it safely.

## Local verification

```sh
node workers/media-renditions/test/broker.test.mjs
node workers/media-renditions/test/gateway.test.mjs
node workers/media-renditions/test/worker.test.mjs
node workers/media-renditions/test/transcode.test.mjs
node tests/adaptive-media.test.cjs
node tests/video-readiness.test.cjs
node tests/media-delivery.test.cjs
node tests/media-processing.test.cjs
```

`supabase/tests/media-renditions-db.test.cjs` additionally runs real PostgreSQL transactions, independent competing connections and Storage guard fixtures. It requires `PC_TEST_PSQL`, a Unix-socket `PGHOST` and exactly `PGDATABASE=pc_scale_media_v2`; it rejects hosted connections. The FFmpeg test generates and decodes synthetic H.264/AAC media, verifies multiple renditions and faststart output, checks original hashes and tests real process cancellation. These are functional and recovery checks, not hosted throughput or regional playback measurements.

## Primary references checked

- [Supabase Smart CDN, including signed URL cache keys and invalidation](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase changelog](https://supabase.com/changelog)
- [Vercel container runtime](https://vercel.com/docs/functions/runtimes/container)
- [Vercel Runtime Cache API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Vercel runtime filesystem and limits](https://vercel.com/docs/functions/runtimes)
- [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)

No measured capacity or unlimited-user guarantee is implied by these implementations.
