# Database and authenticated QA measurements — 2026-11-02

The bounded QA calibration completed 1,065 timed API requests with no errors. After two narrow feed query changes, the final mixed stage completed 600 requests in 60.028 seconds, achieving 9.995 requests per second; feed p95 was 373.54 ms. This establishes a measured result for the stated small QA workload. It does not establish a throughput ceiling, production capacity, or support for five million daily active users.

## Evidence and scope

- [Complete per-request results, method and cleanup receipt](capacity-db-measurements-20261102/calibration-results.json)
- [Query plans, migration identities, queue snapshots and restoration](capacity-db-measurements-20261102/query-and-migration-evidence.json)
- [Owned-account production baseline](capacity-db-measurements-20261102/provider-baseline.json)
- [Final production readback](capacity-db-measurements-20261102/production-readback.json)
- [Infrastructure cost assumptions and account-access limitations](capacity-infrastructure-budget-20261102.md)

Requests used the existing dedicated synthetic QA identity, its real authenticated session, one author-only post, one private book with 32 pages, and three conversations whose sole member was that identity. No real user role, password or account setting was changed. No customer notification was created. The source checkout during measurement was `36e2aec7ddfddf27128a8bf8a3963225bb8e9eed`, with the exact reviewed feed migrations identified below installed in QA between comparison runs.

The mix was 20% feed reads, 20% bounded book pages, 20% engagement-count batches, 20% idempotent share writes, 10% bounded inbox pages and 10% message inserts. The client used authenticated PostgREST through the execution environment's HTTPS proxy. It stopped on an HTTP/correctness failure, any request over 3 seconds, or scheduling lag over 1.5 seconds. Escalation checked feed p95 at 500 ms, inbox p95 at 400 ms and write p95 at 500 ms. The full release capacity gate was not run: these short stages do not supply its long-duration, multi-region, multi-actor, resource-reservation or approved-budget evidence.

## Feed changes and matching workload results

The initial 1 request/second stage missed the feed latency target. The catalog policy called the canonical visibility RPC once per candidate row in repeated frontier probes. The frontier also rescored its entire candidate set after each day even when the candidate count was below the requested page size and its termination condition could not succeed.

`20261102175247_feed_catalog_inline_visibility.sql` inlines the exact fingerprinted canonical visibility SELECT at the catalog RLS boundary. It remains SECURITY INVOKER and retains the caller's posts/profiles RLS and current helper functions. A once-per-query contract check delegates back to the canonical RPC whenever its source, execution permission, volatility, language or configuration changes, or identity is absent. The canonical function itself is unchanged.

`20261102180219_feed_frontier_defer_partial_scoring.sql` postpones scoring while fewer unique candidates than the requested page size have been discovered and another frontier remains. Once enough candidates exist, or the last frontier is exhausted, the existing score, tie fallback, cursor and result logic runs unchanged. Its exact-source guard rejects an unreviewed frontier definition.

| Matching 1 RPS workload | Requests | Feed observations | Feed p50 | Feed p95 | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Before both changes | 20 | 4 | 539.24 ms | 566.17 ms | Held escalation |
| Visibility inlining only | 20 | 4 | 433.14 ms | 526.58 ms | Held escalation |
| Both changes | 20 | 4 | 379.77 ms | 496.25 ms | Proceeded to bounded next stage |

These small comparison runs include the first observed request to each changed definition. No cache eviction occurred, so they are not proven cold-cache tests. The same named fixtures and request mix were used, but QA is a shared environment rather than an isolated benchmark appliance.

The real PostgreSQL 17 suite passed **13/13, with no skipped tests** in 7.412 seconds. It checks exact cards and cursor results in all four feed modes, live hidden/muted/blocked/private/archived restrictions, caller RLS, missing identity, revoked EXECUTE, future authority changes, future-timestamp fallback and exact winners among 22,002 synthetic posts. An instrumented six-day/six-candidate short page proves that the complete frontier is scored once while retaining the exact canonical cards.

| Server-side EXPLAIN ANALYZE | Initial | After inlining | After both changes |
| --- | ---: | ---: | ---: |
| Full feed, 10 returned cards | 410.143 ms | 321.089 ms | 244.787 ms |
| Frontier selection | 260.057 ms | 178.513 ms | 91.603 ms |
| Full-feed shared buffer hits | 18,378 | 16,654 | 14,421 |
| Frontier shared buffer hits | 11,813 | 10,143 | 7,928 |

These plans reported no physical shared reads and no temporary blocks for the measured calls. They are individual observations, not percentile estimates. The full-feed execution observation fell by about 40%; frontier selection fell by about 65%.

| Migration | SHA-256 | QA installed version |
| --- | --- | --- |
| Catalog visibility | `8850532ffd2749f2adc779788a6c9285cb936184e5853af3a691571e3c08d776` | `20261102175956` |
| Deferred frontier scoring | `5cdc737eadb15df8becb0b640e383778de23dae6f6a22e43d3deda3fae4e488e` | `20261102180420` |

## Bounded escalation after both changes

| Requested rate / concurrency | Requests | Duration | Achieved rate | Feed p95 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 RPS / 1 | 20 | 19.126 s | 1.046 RPS | 496.25 ms | 0 |
| 3 RPS / 2 | 90 | 29.776 s | 3.023 RPS | 407.81 ms | 0 |
| 5 RPS / 4 | 225 | 44.932 s | 5.008 RPS | 390.03 ms | 0 |
| 10 RPS / 8 | 600 | 60.028 s | 9.995 RPS | 373.54 ms | 0 |

At 5 RPS, one feed request took 736.76 ms; feed p95 remained 390.03 ms. At the final stage, feed p99 was 495.98 ms and the slowest request was 646.62 ms. No higher-rate stage was attempted. The separate 90-request non-feed diagnostic replaced feed reads with one-card hydration; it is retained in the evidence and is not represented as full-mix capacity.

| Final 10 RPS stage operation | Requests | p95 |
| --- | ---: | ---: |
| Feed | 120 | 373.54 ms |
| Book page | 120 | 147.11 ms |
| Engagement counts | 120 | 161.72 ms |
| Share write | 120 | 144.95 ms |
| Inbox page | 60 | 156.80 ms |
| Message insert | 60 | 131.03 ms |

The final correctness read matched **177 unique share events across 213 successful share calls**, including deliberate replays, and all **106 mixed-workload messages**. Likes and views remained zero. The final stage returned 2,779,248 decoded JSON bytes, approximately 46.3 kB/s of response payload at the imposed rate. That excludes HTTP/TLS, compression and media, and is neither billed transfer nor a network-link limit.

## Queues, reporting and Realtime

Four queue/resource snapshots around the stages observed 15–19 client connections against QA's 60-connection setting, two active backends at each snapshot and zero lock waiters. These are snapshots, not continuously measured peak usage. CPU utilization and IOPS saturation were unavailable and were not inferred from connection counts.

The measured message group's **1,696 fanout shards** were all done before cleanup, with no pending or dead jobs. Observed completion p95 was 984.68 ms and maximum 1,031.43 ms. That group had zero recipients after excluding its sender; this measures queue admission and empty-recipient drain overhead, not large-recipient fanout. Push dispatch remained disabled. Counter snapshots showed no pending work, recorded error or synchronous fallback. Whole-database cumulative counters include cron, other QA activity and a long-lived statistics window, so their changes are not attributed entirely to this workload.

Ten dashboard and ten analytics projection reads each matched their canonical aggregate result. Observed server times were 0.404–5.463 ms for dashboard and 0.229–1.166 ms for analytics. These were privileged connector SQL measurements and do not establish authenticated admin HTTP throughput.

A separate observation used one authenticated Postgres Changes WebSocket on the unused second self-only conversation. All **10/10** inserted messages arrived with zero missing, duplicate or unexpected events. Subscription acknowledgement took 324.02 ms. Pre-write to WebSocket delivery p50 was 444.13 ms and p95/max was 675.90 ms. The connection was closed afterwards. This does not measure a concurrent-connection ceiling, sustained Realtime throughput, a reconnect storm or multi-user isolation under load.

## Confirmed provider settings and remaining capacity evidence

The connected Supabase account confirms **Pearl Group, Pro**. A read-only production snapshot at 17:43:32 UTC reported:

| Production property | Observed value |
| --- | --- |
| PostgreSQL | 17.6 |
| Database bytes | 81,202,323 |
| `max_connections` | 60 |
| Superuser-reserved connections | 3 |
| `shared_buffers` | 224 MiB |
| `work_mem` | 2,184 KiB |
| Client connections in that snapshot | 8 |
| Lock waiters | 0 |

The final QA snapshot had `max_connections=60`, but `shared_buffers=256 MiB` and `work_mem=3,500 KiB`; its database was 47,904,435 bytes. QA resource settings therefore differ from production. The connection setting alone does not uniquely identify the compute SKU.

The connected account surface did not expose the actual compute SKU, pooler client/pool-size limits, customized Auth or Realtime rate limits, or spend-cap configuration. No throughput reservation, provider quota increase or approved operating budget was established by these checks. Public pricing/defaults are planning inputs and must not be labeled as confirmed account allocations. The existing capacity model's five-million-DAU scenarios still require much larger, workload-specific evidence; the measured 10 RPS calibration cannot be extrapolated into a supported DAU claim.

## Restoration and production state

At 18:11:10 UTC, this experiment's QA counter, indexed-feed, maintained-admin, fanout/dispatch and book/inbox reader switches were restored off. At 18:11:15 UTC, the exact synthetic post, book, 32 stories and three conversations were deleted and read back as absent. Conversation deletion also removed the 106 mixed-workload and 10 Realtime messages and their jobs. The three closed synthetic membership-history records were removed after checking that their conversations and jobs no longer existed. Follow-up checks showed no remaining fixture counter shards, rank rows or fanout jobs, and zero notifications created by the synthetic actor. The separate shared media story, source and synthetic account were preserved for the concurrent media acceptance.

A read-only production check at **18:13:25 UTC** verified both reviewed feed changes installed, canonical visibility source unchanged, and the final frontier source matching QA. Production indexed feed, counters, maintained admin projection, book/inbox readers, fanout and dispatch remained **off**; telemetry remained **on**. Production installation was performed by the release owner. This measurement task made no production writes and ran no production load test.
