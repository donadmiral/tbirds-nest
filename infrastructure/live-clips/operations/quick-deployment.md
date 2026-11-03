# Quick renderer and idle-scheduler deployment

Prepared for the operator's **2026-11-03 07:37–07:47 UTC** window. This sequence uses the reviewed frozen image and infrastructure. No benchmark, capacity test, ASR, social publishing or admission expansion belongs in this window. The files in this directory are requests for operator execution; creating them performs no AWS operation.

## Fixed production inputs

| Input | Verified value |
| --- | --- |
| Account / region | `518317808503` / `us-east-2` |
| VPC | `vpc-070155457255a935e` |
| Subnets | `subnet-02cc531f1e50efb77`, `subnet-0beca645a4b3f54dd` |
| Effective route | Main `rtb-01e8aa4c24ff91229`, `0.0.0.0/0` through `igw-0d8eb3a332c6effea` |
| Image repository | `518317808503.dkr.ecr.us-east-2.amazonaws.com/platinum-live-clips-build-production-images-fgzusuampzyi` |
| Broker secret ARN | `arn:aws:secretsmanager:us-east-2:518317808503:secret:platinum-live-clips-build-production/broker-4Qsmcx` |
| Existing CMK | `arn:aws:kms:us-east-2:518317808503:key/c0502962-cac0-4244-b722-31dfa2fa8fed` |
| Supabase project | `prlkikhckbifseosbukl` |
| HLS CDN | `https://d34dlehokbfej7.cloudfront.net` |
| Service stack | `platinum-live-clips-service-production` |
| Launcher stack | `platinum-live-task-launcher-production` |

These identifiers come from the operator-verified `production-network.json` and `production-bootstrap.json`. Their older descriptive count fields do not control deployment: the current template and helper enforce **service desired count 0**. The task uses 2 vCPU / 4 GiB, no task role, no listener, no inbound security-group rule, HTTPS egress, public-IP egress through the existing gateway, UID 1000 and private scratch. No NAT or load balancer is created.

## 1. Bind the accepted image and create the paused service

First inspect existing stack state. The supplied requests use `ChangeSetType=CREATE`; if the named stack already exists, review an UPDATE of that stack rather than creating a duplicate or guessing a new name.

Require the exact final CodeBuild image to pass its mandatory nonroot inventory, offline encode/decode and worker checks, followed by the agreed image/security review. The frozen source manifest is `256608f864374a0978f8884bcd597e537c532b30843836b45530e18b476527fb`. A successful source upload or an ECR tag alone is not image acceptance.

In `renderer-service-create.pending.json`, replace only `ImageDigest=REPLACE_WITH_ACCEPTED_IMAGE_DIGEST` with the actual accepted `sha256:` digest. Keep `DesiredCount=0`. The request contains the exact reviewed template and verified nonsecret parameters. Use `CloudFormation.CreateChangeSet`, inspect its resource changes, execute that change set, and wait for completion. Never execute a file containing `REPLACE_WITH_`.

Equivalent parameter preparation, without any hosted action:

```sh
node infrastructure/live-clips/prepare-service.mjs --image-digest sha256:<accepted-image-digest> --desired-count 0 --output <service-parameters.json>
```

Capture actual `ClusterArn`, `TaskDefinitionArn`, `TaskExecutionRoleArn`, `SecurityGroupId`, `WorkerLogGroup` and `PinnedImage` outputs. Verify the numbered task definition uses that digest, service running/desired/pending counts are zero, and scratch remains writable by UID 1000. The matching Docker `VOLUME /scratch` and task `containerPath /scratch` preserve the image's configured ownership under Fargate.

## 2. Create the disabled launcher and pair its queue-only secret

Fill the four service-output markers in `renderer-launcher-create.pending.json`. Its subnet IDs, CMK, project, disabled schedule and disabled ASR lane are already set. Create, review and execute this change set. Capture `LauncherArn`, `QueueSecretArn`, `LedgerTable`, `LauncherLogGroup` and `ScheduleRuleArn`.

The launcher-generated `QueueSecretArn` is **separate from the existing renderer broker secret**. Privately retrieve only that exact queue secret through the established operator transfer path and install its exact value as production **`LIVE_CLIP_QUEUE_SECRET`**. Compare exact-value SHA-256 digests privately and record only a match boolean. Do not print the value, put it in these requests, or replace `LIVE_CLIP_WORKER_SECRET`.

Confirm the reviewed migration `20261103064534_live_clip_queue_peek.sql` and `live-clip-scaler` endpoint are deployed. The repository configuration already sets that function's `verify_jwt=false`; its handler authenticates the dedicated queue secret itself. A valid `POST {"action":"peek"}` to `https://prlkikhckbifseosbukl.supabase.co/functions/v1/live-clip-scaler` returns HTTP 200 and only `{enabled, due, active}`. An unauthenticated request and the worker credential must return 401. Record no bearer headers.

Keep clip/provider admission at its current accepted state. The queue may report cleanup/publication work even with encoding admission disabled. **Do not call that response idle unless `due=false` and `active=0`.** If work is due, do not enable scheduling under an idle-only acceptance claim.

## 3. Minimum finite worker and disabled-launcher checks

Invoke the disabled Lambda with `{}`. With no active reservation it must return `disabled`, produce its redacted heartbeat, and start no task. Read the ledger's `slot` and current UTC `day#YYYY-MM-DD` item consistently before and after; missing items are a valid initial state. A disabled invocation still reconciles an existing active reservation, so first inspect and preserve any such reservation.

For the one-off worker health check, fill `renderer-idle-run-task.pending.json` from the actual service outputs. Generate one persisted random `clientToken`. Immediately before dispatch set `LIVE_CLIP_TASK_DEADLINE_MS` to **current epoch milliseconds + 180,000**. Keep the default finite task command and `count=1`; the scheduler must still be disabled. Save the exact request before `ECS.RunTask`. A lost response must be reconciled using that same request/token, not a new launch.

Require one returned task ARN and no launch failure. Observe that exact task's image digest and redacted logs: at least one `live_clip_worker` heartbeat and a `drain` result of `idle`, with no `unavailable` or `fatal`. A task that starts after its remaining deadline falls below 25 seconds exits before broker work and does **not** prove worker health. Confirm normal stop/exit code 0; otherwise stop that exact task before the time budget ends and record the observed result. This explicit acceptance task is outside the scheduled daily ledger and must not be left running.

## 4. Enable only the idle scheduler

After the exact worker task is stopped, the dedicated queue check is idle, and the disabled Lambda succeeded, review `renderer-launcher-enable.json`. It uses the deployed template and previous parameters, changes `ScheduleEnabled=true`, and keeps `AsrEnabled=false`. No clip admission is enabled by this update.

Observe a scheduled invocation or invoke once manually after the update. Require `state=idle`, a scheduler heartbeat, no ECS task launch, no active reservation and no increase to the day's `used_seconds` or `launches`. Leave the service at zero. The scheduler has one reserved Lambda execution, one shared ledger slot and a fixed 7,200 equivalent-second UTC-day admission budget; it cannot create an always-on service.

If the window expires, preserve the completed stack state and exact receipts. Leave any unverified schedule disabled, stop any known acceptance task, and report the precise remaining gate. Do not extend the test window or reset a ledger to manufacture a pass. Missing notification-topic configuration means alarms are visible in CloudWatch only.

## Evidence and API references

Record stack/change-set IDs and status, accepted image digest, task-definition revision, task ARN/exit status, queue authentication status codes, secret-digest match boolean, redacted worker/Lambda states and before/after ledger counters. These prove deployment and idle operation only; they do not prove real Daily broadcasting, rendering of customer media, ten-minute clips or five-million-user throughput.

The [RunTask API](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html) defines exact revision, request idempotency and command/environment overrides. [Fargate bind mounts](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html) document matching Docker volumes and ownership. The [task execution role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) supplies image/log/secret startup access; its credentials are not task-role credentials exposed to the application.
