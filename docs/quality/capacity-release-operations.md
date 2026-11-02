# Capacity release operations

This release implements bounded clients, indexed feed selection, distributed counters, durable notification work, maintained reporting and adaptive-media processing. Installation, activation, hosted verification and measured capacity are separate recorded states. A passing source test is not a production release receipt.

## Install and release order

For the existing production visual baseline, use the [production prerequisite branches](capacity-production-prerequisites-20261102.md). Its compatibility readers and content-ticket contracts replace a broad creative/music/account cutover. Do not replay the canonical QA reader files over a production compatibility installation.

1. Reconcile the target's canonical authorization, queue and service-proof contracts. Apply the existing `20261102062128` through `20261102075616` capacity foundations in filename order, only where they are not already installed. Keep the exact target migration history in the private release record.
2. Apply the capacity migrations beginning with `20261102090521` in filename order. Preserve their writer fences, lock/statement timeouts, ACLs and canonical-function guards. An atomic multi-file installation must remove only the outer transaction wrappers, then use one outer transaction. On a guard failure, roll back and resolve the actual contract difference.
3. Deploy the compatible ordinary/VoIP handlers and the authenticated `process-notification-outbox` consumer. Verify the real queue can complete a synthetic authorized event. Do not activate durable dispatch while the consumer or its credential proof is unavailable.
4. Deploy the media worker, native gateway and relay using the [media handoff](../../workers/media-renditions/README.md). Keep admission/delivery flags off until a synthetic hosted publication and playback flow passes.
5. Deploy web/admin preview builds and native QA artifacts from the same tested source commit. Verify authenticated book/inbox windows, private feed delivery, cold-history restoration, counter mutations and admin projections on that backend.
6. Activate each capability on QA, then repeat the successful sequence for production. Verify the actual release identifiers separately for the web, operations app, native artifacts and backend. A Git branch or a preview URL does not establish production parity.

## Server activation

These service-only calls are separate from schema installation:

```sql
select public.configure_distributed_post_counters_v1(true);
select public.configure_admin_reporting_v1(true);
select public.configure_indexed_feed_v1(true);
select public.configure_notification_fanout_v1(true, false);
```

The counter and group-fanout migrations install their bounded database workers when `pg_cron` is available. Verify successful runs and status before activation. The snapshot worker runs `flush_post_engagement_snapshots_v1(4000)` every second; group fanout runs `drain_notification_fanout_v1(32,250)` every second; retained work is pruned in bounded batches every ten minutes.

The notification scheduler migration installs `notification-dispatch-v1` with admission initially disabled. It issues short-lived, single-use worker tokens through `pg_net` to the fixed function path on the configured Supabase project. It never sends a database service credential in a cron command. After deploying the consumer, configure the target's own HTTPS project origin with `configure_notification_worker_v1(origin, true, 8)`. Verify `notification_worker_status_v1()` shows a completed tick. Dispatch is limited to eight overlapping invocations by default, with a maximum of 32; idle heartbeats run at most once every 30 seconds. Each invocation stops after 32 jobs or 25 seconds by default, and persisted leases/receipts fence retries.

After the compatible consumer is deployed and its authenticated scheduler has completed a tick:

```sql
select public.configure_notification_fanout_v1(true, true);
```

Inspect the target's existing ordinary-push webhook configuration before this cutover. The migration suppresses the known `notify_push_notification` and `notification_delivery.queue_notification` paths when durable dispatch is enabled. An unmanaged duplicate webhook must not remain active alongside the new consumer. VoIP remains on its existing compatible path.

The counter, fanout and reporting status RPCs expose worker and queue state without customer payloads. The indexed-feed status describes its exact fallback contract. The adaptive-media status includes bounded queue counts, oldest work, leases and cleanup backlog.

## Monitoring

After installation, enable one bounded sample per minute:

```sql
update capacity_ops.settings set enabled=true where singleton;
select cron.schedule('capacity-observability-v1', '* * * * *',
  'select capacity_ops.tick()');
select public.capacity_capture_v1();
```

The private sampler retains fourteen days by default and removes at most 1,440 expired rows in a sample. It stores aggregate counters, never SQL text, credentials or customer records. Database connection warnings begin at 70% and critical alerts at 90%; five/twenty lock waiters and 30/120-second open transactions are warning/critical thresholds. Feed and call queue ages have separate alerts. Counter queue age and synchronous fallback, notification fanout/dispatch age and dead letters, media queue age, expired leases, failed jobs, cleanup backlog and missing worker heartbeats also generate bounded alerts. An unavailable or malformed component status creates a critical alert while preserving the independent database sample.

Staff can read the last sample in Platform controls or through `/api/capacity?minutes=60`. The endpoint requires the existing operations assurance and system permission. It is read-only and uncached. Missing sampling remains visible as unavailable/stale.

For an external approved monitor, `tools/performance/capacity-observe.cjs` reads the same service-only status. Supply its backend credentials through the monitor's protected environment, never a command-line argument or public CI log. It returns a failing exit status for disabled sampling, missing/stale data or a critical alert and bounds response size and request time. Configure the actual paging destination through the operator's existing incident system; installing the sampler does not establish on-call coverage.

Enter provider-confirmed limits, reservation expiry and approved budget in `capacity_ops.provider_limits`. Leave unknown values NULL. A reservation requires `reservation_evidence`, a positive reserved peak and a confirmation that is already effective and has not expired. A budget requires `budget_approval_evidence` and an effective approval date. Store a receipt or ticket reference, never credentials. Use dated evidence from the actual account, since published plan defaults do not confirm a custom reservation. The operations desk shows observed limits, current reservations and confirmed budgets separately. Alerting is not a hard billing stop.

## Capacity and cost gates

The offline calculator and example scenarios translate predicted DAU into workload assumptions. They do not establish that a database, network path or provider account can carry that demand. Select a starting infrastructure tier for the first measured stage, then scale using the measured bottleneck and reserved headroom. Confirm database/pool connections, realtime connections/events, API rates, media throughput, encoder throughput, push rates and auth limits separately.

`tools/performance/capacity-gate.cjs` accepts a dated measured receipt. Defined stages are 100,000; 250,000; 500,000; 1 million; 2.5 million; 5 million; 10 million; 20 million DAU equivalents. The receipt pins exact releases, authenticated mixed traffic, correctness results, observed peaks, regional playback and current reservations with at least 30% reserve. The 5 million and larger stages require at least 24 hours. Cost projection must fit an explicitly approved monthly budget supported by approval evidence. A synthetic fixture can test the validator but cannot satisfy the operating gate as evidence.

Measure media cost using actual delivered bytes, cache behavior, gateway transfer, encoding seconds, retained source/derivative storage and region mix. Measure application cost using actual database compute/IO, auth activity, realtime fanout and request execution. Record the assumptions and rates used. Reserve purchases and custom quota requests require the actual provider account and a concrete spending decision; these files do not buy them.

## Recovery and rollback

- Disable indexed ranking to return to the canonical exact query. Measure its fallback workloads under viral and deep-pagination conditions before a capacity claim.
- Disable distributed counter writes through the configuration RPC, which drains/coheres the legacy snapshot. The exact ledger remains available. A stale snapshot worker triggers synchronous compatibility behavior after five seconds; that protects freshness but restores contention until the worker recovers.
- Disable new fanout/dispatch admission while already durable work drains. Retain dead letters and receipt outcomes. Retry an unknown zero-acceptance failure within its bounded attempt policy. Reconcile partial acceptance without resending successful destinations. Provider acceptance is not proof of delivery to a device.
- Disable media admission/worker gates to stop new encoding, and disable delivery/client flags to restore original playback. Keep maintenance running until failed/retired output has been physically removed. Do not delete originals or manually erase only Storage metadata.
- A client storage failure keeps the active content and its current position. Earlier content must be reauthorized before restoration. Account change clears session state. Full-book exports/editors complete their explicit read, then ordinary reading returns to its bounded window.

Stop a measured load stage on authorization/correctness failure, sustained latency/error-budget breach, rising unbounded queue age, unavailable telemetry, depleted reserve or budget overrun. Stop admission, allow bounded work to drain, verify recovery and repeat the failed stage against the exact corrected release. Growth is supported by this repeatable process, not an unlimited-user guarantee.
