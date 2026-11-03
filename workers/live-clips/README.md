# Live clip renderer

This worker exports exact ranges from Daily's retained HLS event/replay timeline.
The actual encoder test creates HLS footage, renders both orientations with
captions and a chosen thumbnail, then decodes and probes the outputs.

## Execution and access

The production entrypoint `pull.mjs` performs bounded publication/cleanup
maintenance and awaits one leased render job, with no HTTP listener. Idle polls
run every 60 seconds; errors use bounded backoff. Each process admits one render
at a time. Database admission
bounds the whole fleet; the initial configured limit is two active jobs. A lost
lease, revoked creator session, changed copyright decision or removed clipping
permission prevents completion. Temporary video is removed after the job; a
filesystem cleanup error fails the drain without leaving the process locked busy.
Only a database-confirmed `ready` response is reported as a completed render.

The worker holds a scoped broker secret. It never holds the Supabase service
role key. `live-clip-worker` can claim/check jobs, grant access to the exact source,
sign exact output paths, verify completion and remove leased cleanup objects.
Ordinary app tokens cannot call the worker broker.

The source downloader accepts only HTTPS assets below the authorized stream
prefix, denies redirects/encryption/byte-range playlists and materializes local
segments. FFmpeg receives no network URLs. A nonzero HLS media sequence is
rejected because a sliding live window cannot establish an absolute clip time.
Daily `save_hls_recording=true` retains an EVENT playlist during the broadcast
and converts it to VOD afterward.

Defaults: 1 second to 10 minutes per clip, 512 MiB download budget, 512 MiB
combined output budget, 600 selected segments and a four-minute job deadline.
Outputs are H.264/AAC fast-start MP4 at 1280×720 and/or 720×1280, a JPEG cover,
and optional WebVTT. Vertical export fits the original frame with padding so it
does not silently crop an interview or screen presentation.

## Configuration

| Runtime | Variable | Purpose |
|---|---|---|
| Worker | `SUPABASE_URL` | Exact project origin |
| Worker and Edge broker | `LIVE_CLIP_WORKER_SECRET` | Separate random broker credential, at least 32 characters |
| Legacy HTTP mode only | `LIVE_CLIP_CRON_SECRET` | Separate credential for optional `/drain` requests; not used by the production pull service |
| Worker and Edge broker | `LIVE_HLS_CDN_ORIGIN` | Authorized HLS CDN origin |
| Edge broker | `LIVE_PLAYBACK_SIGNER_URL` | Server-to-server `live-sign` endpoint |
| Edge broker | `LIVE_PLAYBACK_SIGNER_SECRET` | Credential accepted by that signer |

The Edge functions receive their managed Supabase service credential from their
runtime. Never copy it into the encoder container. Do not commit actual secrets.

Build from the repository root:

```sh
RENDERER_NODE_IMAGE=$(node infrastructure/live-clips/resolve-base.mjs)
docker build --build-arg "RENDERER_NODE_IMAGE=$RENDERER_NODE_IMAGE" -f workers/live-clips/Dockerfile -t platinum-live-clips .
```

The [AWS deployment package](../../infrastructure/live-clips/README.md) supplies
the image builder, one-task initial Fargate service, private pull scheduler,
local health check, redacted metrics/alarms and exact-image acceptance workflow.
Production uses a pinned image digest, two vCPUs, 4 GiB RAM and a writable
`/scratch` volume beneath a read-only root. The process handles SIGTERM and
waits for cancellation/cleanup. Hosted deployment and timing results belong in
the release receipts; source files alone do not establish readiness.

The existing `server.mjs` remains an explicitly selected compatibility mode
(`npm run serve`). Its authenticated `POST /drain` awaits one job; an external
HTTP scheduler must retain that request for the entire job. The production
Docker entrypoint and ECS task use the private pull scheduler instead.

After a real provider/source/upload/publication acceptance run, the operator
may call service-only `live_clip_configure(project_origin,true,2)`. Runtime
admission defaults off. Increase it only with queue-age, encoder, storage and
budget evidence. The registered user count is not an encoder concurrency limit.

Internal posts are idempotent and scheduled jobs recheck the actor session,
source rights and destination permissions. X/Facebook intents and device video
exports do not claim a confirmed platform publication. Direct automated social
posting requires each platform's approved app and account connection.

## Verification

Run each test file directly to see all assertion counts in this environment:

```sh
node workers/live-clips/test/source.test.mjs
node workers/live-clips/test/render.test.mjs
node workers/live-clips/test/worker.test.mjs
node workers/live-clips/test/backend.test.mjs
node workers/live-clips/test/server.test.mjs
node supabase/tests/live-clips-edge.test.cjs
```

The HTTP/startup tests use only loopback and synthetic credentials. They start
the actual Node entrypoint with only the documented worker variables, verify
authenticated single-job admission and SIGTERM cancellation, and require an
environment that permits local listening. The Docker image still requires a
separate build and deployment acceptance run.

Database tests additionally prove private Storage ownership, stale-lease
fencing, publication provenance, copyright/membership revocation and account
cascade cleanup. They use disposable PGlite fixtures, never customer data.
