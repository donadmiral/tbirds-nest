# Live caption executor

This package implements the AWS Transcribe executor for the private Live clip caption queue. It creates a **caption draft requiring creator review**, then the existing clip editor and renderer apply approved captions. It never publishes a post or silently replaces a creator's captions.

## Current acceptance status

The local executor, SDK command, audio conversion, authorization, durable budget and infrastructure tests pass. Actual AWS execution is **not accepted yet**: the owner's two controlled synthetic `StartTranscriptionJob` attempts returned an S3 write-access `BadRequestException`, and no provider job was created. The second attempt followed the separately reviewed HeadBucket/ListBucket correction. Successful AWS account reads and successful private audio upload do not establish transcription acceptance. Keep database admission, task execution and launcher ASR configuration disabled until the exact S3 permission issue is resolved and the real canary completes. Do not broaden the bucket or role from a guessed provider error.

## Execution contract

`node pull.mjs` is a serial, outbound-only task. It has no HTTP listener. The exact broker is `POST /functions/v1/live-transcription-worker` on one of the two configured project origins. Its worker credential is usable only there. The separate scheduler credential is never passed to the task.

The flow is:

1. Claim at most one two-minute work lease. Recheck the creator's active Auth session, source rights, clip revision, moderation/copyright state and current private object before reading media.
2. Inspect the deterministic AWS name `pc-live-caption-<job UUID without dashes>`. If it exists, verify source, language, role, format, sample rate and configuration tags before resuming.
3. Obtain a 120-second grant to the exact rendered MP4. Download without credentials or redirects; bound bytes and time. FFmpeg is forced to the MP4 demuxer and local-file protocols, strips video/metadata, and creates mono 16 kHz FLAC. FFprobe verifies the output and expected duration.
4. Upload only `transcription/<job UUID>/source.flac`, with AES256 encryption, expected bucket owner, SHA-256 metadata and `If-None-Match: *`. A lost PUT acknowledgement is accepted only after the fixed object matches the prepared audio.
5. Atomically reserve provider capacity and the UTC-day budget through `submit`, then recheck source rights immediately before Start. The request uses the exact input and `transcription/<job UUID>/result.json` output. AWS subtitle files are not requested; reviewed cues are derived from real word timestamps.
6. Reconcile an ambiguous Start by reading **the same job name**. Never create a substitute name. Pending jobs release their short polling lease but retain the durable provider reservation.
7. Read only the predetermined private result key, recheck rights, and send bounded AWS result JSON to the broker. The broker validates timing and records a review-required draft. Clean up the two scratch keys.

A worker drain lasts at most 85 seconds, with a short separate finish/defer allowance below the two-minute lease. Downloads have a 30-second limit; FFmpeg/FFprobe share 35 seconds; each broker/AWS call has an 8-second deadline. Source size is limited to 256 MiB, FLAC to 24 MB, result JSON to 2.5 MB, and clip duration to ten minutes. No AWS output URL is followed or logged.

## Durable budgets and revocation

`transcription_limits` starts with **two active provider reservations**, **12 new reservations per UTC day**, and **900,000 ms of reserved audio per UTC day**. Each reservation counts clip duration rounded up to seconds plus one extra second for encoder tolerance. This is a conservative admission rule, not an AWS invoice estimate. A terminal, deleted or revoked job still counts toward that day's starts and audio budget. Reservation rows have no account/clip cascade that could erase a running provider slot.

Pending provider work is reconciled even after admission is disabled or its creator/session/source is revoked. Such cleanup leases cannot fetch source media or create a caption draft. A missing provider job retains its slot for at least two minutes after the original reservation. `NOT_SUBMITTED` is used only by the process that made a fresh reservation and knows it has not attempted Start. A previous reservation or any attempted Start must be reconciled instead. Stale lease completions fail closed.

Private scratch objects have a one-day S3 expiration rule as a fallback for lost acknowledgements or failed deletion. Lifecycle expiration is asynchronous. A cleanup failure is reported as a bounded status; it is not presented as successful deletion. No task deletes Transcribe job metadata or cancels an in-progress provider job.

## Environment

| Name | Meaning |
| --- | --- |
| `SUPABASE_URL` | Exact QA or production project origin; paths and foreign origins are refused. |
| `LIVE_TRANSCRIPTION_WORKER_SECRET` | Dedicated 32–200 character base64url broker credential, injected by ECS from its exact Secrets Manager ARN. Never put it in CLI arguments, logs or the repository. |
| `LIVE_TRANSCRIPTION_BUCKET` | Dedicated private scratch bucket. |
| `LIVE_TRANSCRIPTION_DATA_ROLE_ARN` | Exact same-account Transcribe data role. |
| `AWS_ACCOUNT_ID`, `AWS_REGION` | Expected owner and `us-east-2`. |
| `TRANSCRIPTION_DEPLOYMENT` | Bounded nonsecret CloudWatch dimension. |
| `LIVE_TRANSCRIPTION_EXECUTION_ENABLED` | Only literal `true` runs the executor; default disabled. Database admission is separate. |
| `LIVE_TRANSCRIPTION_IDLE_MS` | Default 60 seconds; 10–300 seconds, with bounded failure backoff. |
| `LIVE_TRANSCRIPTION_TASK_DEADLINE_MS` | Launcher-supplied absolute epoch milliseconds. May not extend startup by more than 240 seconds. An expired deadline exits before credentials, broker calls or filesystem work. |
| `TMPDIR` | Private writable scratch mount; production `/scratch`. |

ECS supplies `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`. The executor selects the ECS task-role provider explicitly and rejects static AWS keys, shared profiles, web identity files, arbitrary metadata URLs and custom AWS endpoints. Do not manually inject a credential chain.

Every task stops at the earlier of its absolute deadline or four minutes after startup, with at most 25 seconds of abort grace. Empty/disabled queues and daily-budget exhaustion exit immediately. The scheduler has no overlapping drains. The shared on-demand launcher reserves 360 task-seconds at 1 vCPU before RunTask and caps combined renderer/caption compute. Installing this package or its task template starts no paid work.

## Local verification

From the repository root:

```bash
npm ci --prefix workers/live-transcription --ignore-scripts --no-audit --no-fund
npm test --prefix workers/live-transcription
node --test infrastructure/live-transcription/test/*.test.mjs
node --test supabase/tests/rpc-authorization/test-live-transcription-reservations.mjs
node --test supabase/tests/live-transcription-reservation-handler.test.cjs
```

Node 24 and FFmpeg/FFprobe are required. The tests use fake broker/SDK responses and a real local synthetic MP4-to-FLAC conversion. They make no hosted requests, load no provider credentials and do not establish AWS service acceptance.

Generate a short synthetic speech fixture locally:

```bash
node workers/live-transcription/fixture.mjs --directory /absolute/private/scratch-directory
```

This requires FFmpeg's `flite` filter. It writes a unique private directory containing reference text, FLAC, a nonsecret metadata receipt, exact S3 keys and a deterministic job name. It does not upload, Start, enable a queue or fabricate a user broadcast. A synthetic AWS canary is separate from the later ordinary creator → queue → draft → reviewed clip acceptance.

## Logs and failure handling

Only fixed status/error enums, counts, elapsed time and the deployment label enter logs/CloudWatch. Never emit job IDs, clip IDs, signed URLs, raw provider responses, transcripts, exception messages or secrets. Failed drafts remain visible through the existing creator status flow; retries reuse deterministic identity. Access errors and explicit provider rejection stay visible as sanitized codes. No task changes permissions, connects social accounts or upgrades AWS plans.

See [the infrastructure runbook](../../infrastructure/live-transcription/README.md) for deployment and operator acceptance. The current SDK dependencies are pinned in this package's isolated lockfile. The production Docker recipe uses a separately verified minimal audio FFmpeg build, with an immutable Node base, component inventory and offline bundled-media acceptance. Actual image build/scan acceptance is still required.
