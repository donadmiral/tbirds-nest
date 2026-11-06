# Budgeted Live task launcher

This package starts a finite Fargate task only when a trusted queue signal reports due work. The renderer service remains at **desired count zero**. DynamoDB conditionally reserves one shared active task and its daily budget across concurrent Lambda invocations. Lambda uses the account's unreserved pool: the observed Ohio account limit is 10, which cannot support a reserved-concurrency allocation while preserving AWS's required unreserved pool. The invocation remains limited to 45 seconds with a one-minute schedule. This is initial operating capacity, not a five-million-user capacity result.

## Fixed limits

| Worker | Task resources | Absolute deadline from reservation | Charged reservation | Shared-budget charge |
| --- | --- | --- | --- | --- |
| Renderer | 2 vCPU / 4 GiB | 600 seconds; graceful stop starts 25 seconds earlier | 720 wall seconds | 720 equivalent seconds |
| Transcription | 1 vCPU / 2 GiB | 240 seconds; its process has at most 25 seconds of shutdown grace | 360 wall seconds | 180 equivalent seconds |

The daily admission limit is **7,200 seconds at the renderer's resource size**, shared across both workers. No reservation crosses a UTC-day boundary. A failed or uncertain launch consumes its reservation. A reservation is not refunded when a task stops early. The initial maximum is therefore ten renderer launches per UTC day if no transcription tasks run; the workload mix can reduce that number.

Reservations include headroom for the one-minute watchdog interval and ECS's 30-second stop timeout. The process also has its own absolute deadline, so losing a scheduler invocation does not leave an always-on worker. AWS startup or termination failures can exceed estimated billing windows; this is an enforced **admission budget**, not an AWS account-wide monetary cap. Manual acceptance tasks, builds, storage, logs, metrics, network and provider charges are separate. At the operator's verified Ohio price of $0.09874/hour for 2 vCPU /4 GiB, 120 reserved task-minutes/day corresponds to approximately **$5.92 compute per 30 days**, before those additional costs. The earlier always-on baseline is held because it exceeds the observed $60 project spending limit.

## Deployment inputs

The existing renderer [service template](service-cloudformation.json) uses a reviewed image digest and defaults to zero tasks. Its task command includes [finite-task.mjs](finite-task.mjs); a missing, invalid or expired `LIVE_CLIP_TASK_DEADLINE_MS` exits before accessing the broker. An explicit synthetic benchmark can override the command with its own bounded acceptance program.

The separate [launcher template](launcher-cloudformation.json) creates a queue-only Secrets Manager secret, retained DynamoDB ledger, Lambda and IAM role, 14-day log group, disabled EventBridge rule, invocation policy and three alarms. It creates no NAT, load balancer or running ECS task. It reuses the existing KMS key for the new secret. Actual account service/policy eligibility must still be checked by deployment; template validation does not establish it.

Generate the reviewed artifacts locally:

```sh
node infrastructure/live-clips/service-template.mjs
node infrastructure/live-clips/launcher-template.mjs
node infrastructure/live-clips/prepare-service.mjs --image-digest sha256:<accepted-digest> --desired-count 0 --output <service-parameters.json>
node infrastructure/live-clips/prepare-launcher.mjs --service-outputs <actual-service-outputs.json> --enabled false --output <launcher-parameters.json>
```

The service-outputs file is an AWS `Outputs` array or a map of `ClusterArn`, `TaskDefinitionArn`, `TaskExecutionRoleArn` and `SecurityGroupId`. The parameter helper uses the verified production subnet and KMS identifiers already recorded in this directory. It rejects foreign-account renderer outputs and requires a numbered task-definition revision.

Use a reviewed CloudFormation change set in **us-east-2**, with `CAPABILITY_IAM`. Suggested separate launcher stack name: `platinum-live-task-launcher-production`. Keep `ScheduleEnabled=false` while installing and checking credentials.

## Queue authentication and database setup

Apply `supabase/migrations/20261103064534_live_clip_queue_peek.sql` through the release workflow and deploy `supabase/functions/live-clip-scaler`. Its Supabase gateway configuration requires `verify_jwt=false`; the function performs its own dedicated queue-secret check. Install the exact newly generated `QueueSecretArn` value privately as **`LIVE_CLIP_QUEUE_SECRET`**. Never reuse `LIVE_CLIP_WORKER_SECRET`, print a value or put it in a template, receipt or parameter file.

The only accepted request is authenticated `POST {"action":"peek"}`. The response contains exactly `enabled`, `due` and a saturated `active` count from zero to two. The endpoint cannot claim, sign, upload, finish or read a clip. The SQL function is service-only and uses indexed eligibility checks. Due publication/cleanup remains eligible while encoding admission is off. The launcher owns no worker, source-signing, Supabase service-role or provider credential.

For transcription, configure all eight `Asr*` identifiers with `--asr-config <nonsecret-asr-identifiers.json>`. They are the exact cluster/task revision, execution role, task role, security group, comma-separated subnet IDs, queue secret ARN and its customer-managed KMS key ARN. The separate **`LIVE_TRANSCRIPTION_QUEUE_SECRET`** protects `POST {"action":"peek"}` on `live-transcription-worker`. Its worker credential cannot perform that action. Transcription must have its own image, role, provider and source acceptance before `AsrEnabled=true`; queue configuration does not enable caption admission. The optional lane consumes the same daily ledger and cannot overlap renderer compute.

## Acceptance and operation

1. Verify the deployed image and task command, renderer service count zero, exact execution-role grants, inbound-empty security group and actual task/network outputs. Run the bounded encoder acceptance and benchmark as explicit one-off tasks; record these separately from scheduled work.
2. Verify the queue-secret digest matches across AWS and Supabase without logging values. Check unauthorized and worker-secret requests are rejected; the valid queue-only request returns the three-field idle result. Verify user/anonymous SQL roles cannot execute `live_clip_queue_peek`.
3. With the schedule disabled, invoke the Lambda once. It should report `disabled`, create no task and consume no daily reservation. Confirm its role cannot read the renderer broker secret, update the ECS service, run a different task definition, or pass an unrelated role.
4. Enable the schedule through a reviewed template update after the queue endpoint is ready. An idle queue must produce heartbeat events with no RunTask or budget charge. For a controlled accepted fixture, confirm a budget transaction precedes one task, that task uses the exact image/revision and absolute deadline, and the database still enforces its lease and source rights.
5. Observe task exit and ledger settlement. Confirm a lost launch acknowledgement reuses the stored `clientToken` and **identical request**, an expired unknown launch remains blocked for reconciliation, a consumed daily budget refuses new launches, and the optional lane shares rather than bypasses the cap. Use local fault fixtures for deliberately ambiguous cases; do not create duplicate real tasks to simulate them.

The EventBridge event cannot select a URL, credential, task or budget. Every minute the launcher reconciles its existing reservation before considering new work. A STOPPED task without successful container exit codes is reported as failure, including image, network and secret startup failures. It never logs raw AWS errors, queue credentials, media paths or user data.

When a task's absolute deadline passes, the launcher issues `StopTask` for that exact task and retains the slot until AWS confirms STOPPED. If a RunTask result was lost, it replays the stored request while the deadline remains valid. After the deadline, an unknown task ARN triggers `manual_review`; it does not delete the reservation, assume the task is absent, or submit another request. The operator must inspect the saved request/client token, ECS/CloudTrail metadata and confirmed task state before a narrowly conditional reconciliation. **Do not delete the ledger or reset a daily counter to resolve an outage.**

For emergency pause, disable new queue admissions and the schedule, stop any recorded task, and verify STOPPED. Preserve the ledger and retained secret. If only worker admission is disabled, due cleanup can still request a bounded task. Credential rotation requires a coordinated matching update to the relevant AWS secret and Supabase queue endpoint; a mismatch fails closed and emits `LauncherUnavailable`.

The three launcher alarms cover missing scheduler heartbeat, repeated unavailability and unresolved launch reconciliation. Worker alarms separately cover broker failures and terminal jobs. An empty `AlarmTopicArn` means CloudWatch-only visibility with no notification destination. Budget exhaustion is an explicit `budget_blocked` event; it never raises the cap automatically.

## Local verification

```sh
python3 infrastructure/live-clips/test/launcher_test.py
node --test infrastructure/live-clips/test/*.test.mjs supabase/tests/live-clip-queue.test.cjs
node --test supabase/tests/rpc-authorization/test-live-clip-queue.mjs
PYTHONPATH=/tmp/platinum-live-cfnlint /tmp/platinum-live-cfnlint/bin/cfn-lint infrastructure/live-clips/service-cloudformation.json infrastructure/live-clips/launcher-cloudformation.json -r us-east-2
```

The fault tests exercise atomic admission shape, exact retry identity, finite deadlines, startup failure, cleanup eligibility, authentication, budget exhaustion and ASR sharing. They do not claim hosted AWS/Supabase acceptance.

Primary API references: [ECS RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html), [ECS idempotency](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-api-idempotency.html), [DynamoDB transactional permissions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html), [Fargate pricing](https://aws.amazon.com/fargate/pricing/). Operator-owned release receipts carry actual deployment and pricing outcomes.
