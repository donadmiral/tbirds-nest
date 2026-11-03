# Live transcription deployment

This unit separates private storage from an optional, on-demand compute task. It is gated until real AWS transcription has completed successfully. It starts no broadcast and changes no social account or native distribution setting.

## Templates

| File | Resources and effects |
| --- | --- |
| `storage-cloudformation.json` | Dedicated private AES256 S3 bucket, HTTPS-only bucket policy and Transcribe data role. All public access is blocked. Object access is restricted to `transcription/*/source.flac` and `transcription/*/result.json`. Scratch expires after one day. Creates no job or worker. |
| `task-cloudformation.json` | Fargate task definition, task/execution roles, cluster, no-ingress security group, logs and alarms. **No ECS service, schedule or RunTask invocation.** Execution is disabled by default. |

Both templates are generated from the adjacent `.mjs` files; regeneration is local only. Deploy to `us-east-2`. The ECR image is referenced by repository plus an immutable SHA-256 digest. The task is Linux x86-64, 1 vCPU / 2 GiB, non-root, read-only root filesystem, `/scratch` mount, dropped Linux capabilities, no ports and no ECS Exec. HTTPS is the only egress port. Use existing verified Internet Gateway subnets; this template creates no NAT gateway or load balancer.

The data role trusts only Transcribe, the current AWS account and the expected `pc-live-caption-*` transcription-job ARN scope. Its bucket-level ListBucket permission is needed by documented HeadBucket validation, which does not send an `s3:prefix`; object actions remain narrowly scoped. Do not add a guessed output-test filename or broaden the trust to work around a generic provider rejection.

The ECS task role can Start/Get only the deterministic caption-job namespace, pass only the exact reviewed data role to Transcribe, and read/write/delete only the two scratch object names. Its execution role alone retrieves the exact dedicated broker secret. The task does not receive a Supabase service-role key, queue-check secret, OAuth tokens, creator JWTs or static AWS credentials.

## Image build and acceptance gate

The broad Bookworm FFmpeg package recipe was replaced after the renderer image scan identified vulnerabilities in that component family. The ASR recipe now resolves the official Node 24.22.2 / Alpine 3.24 image to an immutable AMD64 digest and builds FFmpeg 9.0.2 only after checking its release signing key, signature, exact SHA-256 and version. It includes MOV/FLAC demuxers, AAC/FLAC decoders and FLAC/PCM output only. Video codecs and networking are disabled. FFmpeg's required built-in graph filters are allowlisted explicitly; their presence does not enable a video decoder. The container removes package managers and build tools.

A policy gate checks the actual compiled components and emits a source/binary/package inventory. Source-built libraries may be absent from an OS scanner, so both the immutable image scan **and** source-component vulnerability review are required. AAC and MOV parsing remain reachable; this is not a vulnerability-free claim. The image has not been built or scanned in this local implementation phase.

From the repository root, on the reviewed build host:

```bash
export ASR_NODE_IMAGE="$(node infrastructure/live-transcription/resolve-base.mjs)"
docker build --pull --platform linux/amd64 --build-arg "ASR_NODE_IMAGE=$ASR_NODE_IMAGE" -f workers/live-transcription/Dockerfile -t platinum-live-transcription:review .
docker run --rm --network none --cpus=1 --memory=2g --read-only --cap-drop ALL --security-opt no-new-privileges platinum-live-transcription:review node workers/live-transcription/encoder-policy.mjs
docker run --rm --network none --cpus=1 --memory=2g --pids-limit=128 --read-only --tmpfs /scratch:rw,nosuid,nodev,size=512m,uid=1000,gid=1000 --cap-drop ALL --security-opt no-new-privileges platinum-live-transcription:review node workers/live-transcription/acceptance.mjs
```

The final command extracts FLAC from the bundled, SHA-256-bound two-second H264/AAC fixture, verifies mono 16 kHz output, and decodes the FLAC. It needs no credentials or network and does not start a transcription job. The production encoder deliberately does not include local fixture-generation codecs or the `flite` speech synthesizer; those run only on the operator's separate test host. Review the actual image digest and scan before any push/deployment. The stack then refers to that immutable ECR digest.

## Shared CodeBuild source bundle

Use `python3 infrastructure/live-transcription/package-source.py --directory /absolute/private/scratch` to create the exact allowlisted source ZIP and manifest receipt. It includes no repository configuration, environment file, credential or `node_modules`. The verifier rejects missing, altered, added or symlinked files and is run before base-image resolution.

The existing project `Builder-UhwmorEgFfEf` can build this unit without a new build stack. After the renderer build has downloaded its own source, upload the ASR ZIP as a **new version** of the already-authorized key `source/renderer-source.zip` in the existing private source bucket. Bind `StartBuild.sourceVersion` to that exact S3 version, set `buildspecOverride` to `infrastructure/live-transcription/buildspec.yml`, and supply the receipt's nonsecret `EXPECTED_MANIFEST_SHA256` override. Do not change the project source setting or overwrite an active renderer build's source without that version binding.

The dedicated buildspec aliases the existing repository environment variable and uses the distinct immutable tag `asr-source-<first 32 manifest-hash characters>`. It runs the real container inventory, 26 focused container tests and offline audio extraction/decoding under 1 vCPU / 2 GiB. The full host suite has additional fixture-generation/runtime tests that require a broader local test FFmpeg; those codecs are intentionally absent from production.

Only a succeeding build with verified base/inventory/audio receipts may push. The post-build event reports the actual ECR digest, source hash, installed package/binary inventory, and synthetic audio acceptance. It explicitly reports provider transcription unaccepted and scan still required. This source/build path creates no task, secret, gate or new AWS infrastructure; production ASR still needs its own worker/queue Secrets Manager secrets before task/launcher provisioning.

## Queue-driven invocation

The shared launcher under `infrastructure/live-clips` consumes these task outputs:

- `ClusterArn`, `TaskDefinitionArn`, `TaskRoleArn`, `TaskExecutionRoleArn`
- `SecurityGroupId`, comma-separated `SubnetIds`, `ContainerName` (`transcription`)
- `QueuePeekUrl`

Configure ASR in that launcher only after code review and real-provider acceptance. It uses a **different** Secrets Manager secret whose value matches Supabase `LIVE_TRANSCRIPTION_QUEUE_SECRET`. The task's `BrokerSecretArn` instead matches `LIVE_TRANSCRIPTION_WORKER_SECRET`. Reusing these two credentials is rejected.

The read-only queue contract is:

```text
POST https://<configured-project>.supabase.co/functions/v1/live-transcription-worker
Authorization: Bearer <dedicated queue credential>
Content-Type: application/json

{"action":"peek"}
```

The response is only `{"enabled":true|false,"due":true|false,"active":0|1|2}` with `Cache-Control: private, no-store`. It contains no actor, job, clip, source, lease or provider identifier. The queue credential cannot claim work or receive media. The task credential cannot use this queue-only action.

`enabled` can be true for due cleanup of existing provider reservations while new-job admission is off. `due` respects active leases, the two-provider-job cap and the daily starts/audio budget; it also wakes the existing cleanup path for expired or revoked unreserved jobs. The launcher must require both `enabled` and `due`, keep its shared active-compute fence, and not interpret this read as permission to widen admission.

Before RunTask, the launcher reserves **360 task-seconds at 1 vCPU** (180 seconds in its two-vCPU-equivalent budget), within the shared 7,200 equivalent-second UTC-day ceiling. It supplies `LIVE_TRANSCRIPTION_TASK_DEADLINE_MS` as an absolute deadline no more than 240 seconds ahead. The worker exits before any work if startup was delayed beyond that deadline; it cannot receive a fresh lifetime from delayed Fargate scheduling. The worker also exits early when idle. Its fixed four-minute runtime plus at most 25 seconds abort grace fits inside the reserved execution window; ECS `StopTimeout` is 30 seconds. The launcher's independent task watchdog handles delayed starts/stops and reserved capacity. These are conservative admission limits, not a guaranteed total AWS bill or enforcement of the owner's entire project spend limit.

## Deployment sequence

1. Review the storage change set and its exact roles/bucket. Keep the existing private resources and strict object scope while investigating provider denial.
2. Build `workers/live-transcription/Dockerfile` from the repository root, scan the result, push the reviewed image and obtain its immutable ECR digest. This local implementation phase did not perform that hosted build or task rollout.
3. Install distinct protected worker and queue credentials through the approved secret-management path; do not put values in a template, command argument, artifact or chat. Pass only secret ARNs to task/launcher templates.
4. Deploy the task template with `ExecutionEnabled=false`. Applying the SQL foundation and broker also leaves transcription admission off. No task is launched by either template.
5. Resolve the actual S3-write denial, run the bounded synthetic acceptance below, then enable a reviewed pilot deliberately. Set the task execution flag, configure the budgeted launcher and enable database transcription admission only as an explicit coordinated rollout. Leave the initial 15-minute daily audio and two-active-job limits intact.
6. Complete the ordinary creator flow: consent to caption a ready private clip; observe one deterministic provider job; receive real word-timed draft cues; review/edit explicitly; render captions through the existing clip pipeline. Revoke source access during another queued job and prove no new grant/draft is delivered. This is separate from physical-device Live acceptance.

## Current provider blocker and acceptance

The owner successfully created the private storage stack and uploaded a short synthetic FLAC. Two actual Start requests returned the same S3 write-access `BadRequestException`; the second followed the narrow HeadBucket policy correction. No AWS job was created. This remains unresolved; a successful `ListTranscriptionJobs` response or S3 PUT is not a successful transcription.

Use only the package-generated synthetic fixture for the next controlled provider probe. Preserve its deterministic job name and exact private `source.flac` / `result.json` keys. Include both `AllowDeferredExecution:false` and the exact `DataAccessRoleArn`; request no AWS subtitle files. Do not create a new job name after an ambiguous response: Get the existing deterministic name and compare its source/configuration first.

Acceptance requires the real job to reach COMPLETED, the result to exist only at the expected private key, real word timestamps to fit the fixture duration, and its text to substantially match the supplied reference. Download/read results through authenticated S3 APIs, never an arbitrary transcript URL. Record only statuses, object sizes/digests and sanitized configuration metadata. Delete the two exact scratch objects after inspection and verify their absence. Preserve failure evidence without copying raw provider payloads into public logs.

## Current primary references

- [StartTranscriptionJob API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html): exact input/output arguments, deterministic name conflict and S3 output requirements.
- [GetTranscriptionJob API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_GetTranscriptionJob.html): job status and readback configuration.
- [JobExecutionSettings](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_JobExecutionSettings.html): supplying both the data role and deferred-execution setting.
- [Transcribe IAM policy examples](https://docs.aws.amazon.com/transcribe/latest/dg/security_iam_id-based-policy-examples.html): service trust and scoped S3 permissions.
- [S3 HeadBucket](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html): bucket-level ListBucket requirement.
- [AWS SDK credential providers](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html): explicit ECS container credential provider.
- [Current Transcribe pricing guidance](https://docs.aws.amazon.com/transcribe/latest/dg/what-is.html): precise one-second usage; the code's extra-second reservation is an independent admission margin. Consult the current regional price list before estimating spend.

- [FFmpeg official source releases and signature verification](https://ffmpeg.org/download.html): the fixed 9.0.2 release and pinned release signing key used by the image build.
