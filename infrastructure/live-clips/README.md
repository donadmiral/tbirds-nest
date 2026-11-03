# Production Live clip renderer

This package deploys an outbound-only ECS Fargate renderer in **us-east-2**. The service stays at **zero tasks**; a budgeted launcher starts one finite **2-vCPU/4-GiB** task only when due work exists. The renderer has no HTTP listener, inbound security-group rules, load balancer, NAT gateway or AWS task-role credentials. The database independently limits active clip jobs to two. Creating this infrastructure does not enable clip or broadcast admission. The [launcher runbook](launcher-runbook.md) covers the shared renderer/transcription runtime budget and deployment sequence.

## Verified inputs and service eligibility

[production-network.json](production-network.json) contains the default VPC and two public subnets verified by the operator, their effective Internet Gateway route, and the selected region. [production-bootstrap.json](production-bootstrap.json) contains the actual `CREATE_COMPLETE` bootstrap outputs. These files contain identifiers only.

The operator verified a 30-vCPU Fargate On-Demand quota and an active Free plan with USD 100 remaining during preflight. AWS's current [new-experience service list](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) includes ECS, ECR, CodeBuild, CloudWatch, VPC, KMS and Secrets Manager in the Free-plan set. This list does not override the account's actual policies or quotas. The [Free-plan documentation](https://docs.aws.amazon.com/accounts/latest/reference/bcm-lite-free-tier.html) says the plan ends when its credits are exhausted or after six months, whichever comes first. No account upgrade or organization-policy change is part of this package.

The existing Daily cross-account denial is a separate provider blocker. This renderer uses the application's scoped Supabase broker and authenticated CDN; its task needs no S3, STS, Transcribe or other AWS API permission. Automatic transcription is a separate integration; Amazon Transcribe is listed under the new-experience Paid Plan.

## Package and deploy

### 1. Bootstrap, without running compute

Generate and review [bootstrap-cloudformation.json](bootstrap-cloudformation.json) with:

```sh
node infrastructure/live-clips/bootstrap-template.mjs
```

The operator deployed this template as `platinum-live-clips-build-production`. It creates a private versioned source bucket, immutable ECR repository, a CodeBuild project limited to one build and 30 minutes, build logs, a dedicated rotating KMS key and a generated broker credential. The builder cannot read the broker secret, change IAM, deploy ECS or write source objects. Its privileged Docker mode is confined to image building. Secret and repository resources are retained on stack deletion.

The renderer uses **`LIVE_CLIP_WORKER_SECRET`**. The exact generated Secrets Manager value must also be installed in the production Supabase broker. Verify the private transfer by digest and broker authentication; do not print the value. The worker has no Supabase service key and needs no `LIVE_CLIP_CRON_SECRET`. Its execution role retrieves only this secret at container startup; the application receives no AWS role credentials. The separate launcher uses **`LIVE_CLIP_QUEUE_SECRET`**, which can read only a three-field due-work signal and cannot perform worker actions.

### 2. Build the exact reviewed source

```sh
python3 infrastructure/live-clips/package-source.py
```

The packager includes 25 explicit code/test files and a per-file SHA-256 manifest, excluding credentials, dependencies and repository history. It returns archive and manifest hashes. Upload the archive only to the bootstrap `SourceBucket` output at `source/renderer-source.zip`, retaining its S3 `VersionId`.

Call CodeBuild `StartBuild` with the bootstrap `BuildProjectName`, `sourceVersion` equal to that exact version, and the nonsecret `EXPECTED_MANIFEST_SHA256` environment override. The source verifier rejects altered files, additional files, symlinks and a mismatched manifest. No build is automatically triggered by an upload.

[buildspec.yml](buildspec.yml) resolves the official Node 24.22.2/Alpine 3.24 image to an immutable Linux/AMD64 digest before either Docker stage uses it. The encoder is built from FFmpeg 9.0.2 only after its upstream release signature, pinned signing-key fingerprint, expected source SHA-256 and version all pass. Explicit component allowlists exclude networking and unused codecs. Direct runtime dependency versions are locked to the builder; complete installed versions and binary/source hashes remain in the image inventory. See [security-review.md](security-review.md) for the rejected initial image, supported-source evidence and remaining reachable H.264 risk.

The build checks actual encoder capabilities, runs worker tests with no network, two CPUs, 4 GiB RAM and a read-only root, then executes a real offline FFmpeg encode/decode acceptance. Only success can push the immutable `source-<manifest-hash-prefix>` tag. The final event records the verified ECR image and base-image digests. Inspect the image scan, source component inventory and residual-risk review before deployment. A scanner can miss source-built FFmpeg; no clean OS-package scan substitutes for that review.

### 3. Deploy the paused service and finite-task launcher

Generate [service-cloudformation.json](service-cloudformation.json):

```sh
node infrastructure/live-clips/service-template.mjs
```

Use `prepare-service.mjs --image-digest <verified-sha256-digest> --desired-count 0 --output <parameters-file>` to combine the exact image with the verified network and bootstrap identifiers. Submit the generated parameters and service template through a reviewed CloudFormation change set with `CAPABILITY_IAM`, using stack name `platinum-live-clips-production`.

The service template permits only zero desired tasks. Its task command requires an absolute deadline. The [separate launcher](launcher-runbook.md) starts finite tasks using the exact task-definition revision, reserves runtime before launch and shares one active slot with optional transcription. An idle queue runs no ECS compute. Do not change fleet admission based on the registered-user target.

Tasks use public IPs for outbound HTTPS to Supabase, CDN and AWS startup services. Their security group permits no inbound traffic and only outbound TCP 443; AWS-provided VPC DNS remains available. This avoids NAT and load-balancer charges while keeping the scheduler unreachable from the internet. See AWS's [Fargate networking requirements](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html).

The container runs as UID/GID 1000, drops Linux capabilities, uses a read-only root and a dedicated writable `/scratch` volume. Dockerfile ownership and `VOLUME` match the task mount, following AWS's [bind-mount ownership guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html). The default 20 GiB Fargate ephemeral allocation covers bounded working files; it is not a persistent media store.

## Scheduling and failure behavior

The launcher checks a bounded queue signal once per minute. During its finite task window, `workers/live-clips/pull.mjs` performs maintenance and one leased render serially. An idle task polls every 60 seconds. Completed jobs pause five seconds before the next claim. Unavailable/retry results back off with jitter, capped at five minutes. Work is driven by a bounded task fleet, never a poll per viewer.

The existing worker enforces a four-minute execution deadline, 512 MiB source budget, 512 MiB combined output budget, at most 600 segments and a five-minute database lease. It obtains fresh source/upload grants, rechecks authorization before upload and finish, and reports ready only after database acceptance. Database lease fencing prevents a stale worker from publishing. Temporary files are removed on success, failure and cancellation.

SIGTERM stops admission, cancels the active encoder, records the durable retry result where possible, and cleans scratch. The process has a 25-second final shutdown bound within the task's 30-second stop timeout. If the task disappears, the database lease eventually becomes reclaimable; this is retryable work, not an exactly-once claim.

## Observability and credentials

CloudWatch receives structured, redacted worker events and eight bounded EMF metrics under `PlatinumCircles/LiveClips`, dimensioned only by deployment. Logs never include a job title, user ID, signed URL, credential, provider body or raw exception. Health is an atomic local heartbeat file checked by the ECS container health command. Stale heartbeats, overlong active cycles and stopping processes fail health.

Worker alarms cover repeated broker unavailability and a database-confirmed terminal failure; idle absence is expected. The launcher separately alarms on missing scheduler heartbeat, repeated errors and unresolved launch reconciliation. Logs retain 14 days. `AlarmTopicArn` accepts an existing monitored SNS topic; if omitted, alarms exist in CloudWatch but **no notification destination is configured**. The package does not claim queue-age or end-to-end latency monitoring from process health alone; use the authorized queue/admin diagnostics alongside these metrics.

Broker-secret rotation must be coordinated between AWS and Supabase. Pause the launcher, stop worker tasks, confirm active work has settled or its lease is fenced, install the new matching values, and verify authenticated idle maintenance on a bounded task before resuming admission. Do not enable independent automatic Secrets Manager rotation that changes only one side. KMS key rotation is enabled independently. Inspect authorized CloudTrail metadata for secret access without retrieving secret values into logs.

## Acceptance before clip admission

Local implementation evidence is separate from the deployed image and task. Confirm the service is paused, and verify the exact image digest, private security group, heartbeat and authenticated idle maintenance on a bounded task. Run the offline encoder command on the exact image before any customer job:

```sh
node workers/live-clips/acceptance.mjs
```

This generates synthetic footage, renders both orientations with watermark/captions/cover, decodes audio/video and checks scratch cleanup. Its broker is deliberately mocked, and its receipt does not claim hosted publication or provider acceptance.

For concrete timing on the target two-vCPU task, use [benchmark-task.mjs](benchmark-task.mjs) as the `-e` argument in the ECS command `node --input-type=module -e <script> -- --run`. It fits within ECS's 8,192-character override limit without extra environment overrides. The script imports encoder modules already in the image, generates only synthetic high-motion 720p30 H.264/AAC, and tests 15/30/60/90/600-second clips in both orientations. It checks decoded dimensions/duration/audio, captions and cover. Each render is bounded at four minutes, source generation at four minutes, and the whole task at 15 minutes with a final hard exit ten seconds later. Per-case redacted events preserve failures; do not replace a failed long-clip result with the short-case success.

The existing ten-minute input maximum is **not** evidence that both formats finish within the four-minute deadline on this task. Benchmark results must inform duration, CPU or lease/deadline decisions before admitting that workload. The timing test excludes real source download and signed output upload, which need additional headroom and acceptance.

Finally, use an isolated authorized test session and actual retained source to exercise the real broker, database lease, private output Storage, asset signing and publication. Verify stale-lease rejection, revoked rights, retry and cleanup with the production configuration. A renderer-only synthetic fixture does not resolve the separate Daily role-assumption failure or certify a broadcast. Keep `live_clip_configure` disabled until its recorded acceptance supports enabling it; do not change global admission merely because ECS is running.

## Initial cost scope

The operator's current AWS Price List query for Ohio returned **$0.04048 per vCPU-hour** and **$0.004445 per GiB-hour**, effective 2026-10-01 and published 2026-10-19. One 2-vCPU/4-GiB task is **$0.09874/hour**. The now-held always-on design would cost **$72.0802 for 730 hours**, even with no work. AWS documents that Fargate charges for requested resources and includes 20 GiB of ephemeral storage in its [pricing](https://aws.amazon.com/fargate/pricing/).

One [public IPv4 address](https://aws.amazon.com/vpc/pricing/) adds $0.005/hour. Initial [KMS key storage](https://aws.amazon.com/kms/pricing/) is $1/month and each [Secrets Manager secret](https://aws.amazon.com/secrets-manager/pricing/) is $0.40/month, before request charges. The held always-on baseline would total about **$77.13/month**, exceeding the observed $60 project spending limit. The replacement launcher caps compute reservations at **120 two-vCPU-task-minutes per UTC day**, approximately **$5.92 of compute per 30 days**, shared with optional transcription. Builds, startup/termination tail risk, DynamoDB/Lambda, ECR/S3 storage, secrets, logs, metrics, alarms, data transfer, Supabase and provider charges remain additional. Credits are a limited payment allowance. Desired count zero stops idle task/IPv4 consumption; retained resources can still incur charges. See the [budget limitations and recovery rules](launcher-runbook.md).

Five million registered users remains a product target. This finite-task initial deployment is bounded operational capacity, not five-million-user load certification. Measure clip arrival rate, queue age, encode time, network/Storage throughput, failures and budget before changing launcher or database admission.

## Local validation

```sh
node --test workers/live-clips/test/*.test.mjs infrastructure/live-clips/test/deployment.test.mjs
node supabase/tests/live-clips-edge.test.cjs
node workers/live-clips/acceptance.mjs
cfn-lint infrastructure/live-clips/bootstrap-cloudformation.json infrastructure/live-clips/service-cloudformation.json -r us-east-2
```

No local test substitutes for the actual CodeBuild image, Fargate task, broker/Storage flow or recorded provider acceptance. Root-owned release receipts record those hosted outcomes.
