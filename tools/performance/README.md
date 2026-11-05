# Performance planning tools

`capacity-model.cjs` is an offline workload calculator. It reads explicit assumptions and calculates concurrent sessions, API rates, media bytes, polling demand and retained data at several DAU targets. It does not send traffic, read credentials, measure throughput or certify a supported user count.

`capacity-scenarios.json` contains illustrative light/base/heavy workloads at 5M, 10M and 20M DAU. Replace these assumptions with measured product behavior before sizing infrastructure. Native share refers to active session-time. Background HTTP/API operations and media requests are separate from primary application traffic. The output preserves those distinctions and its limitations.

The `sourcePolling` result is a **historical timer reference from before the event-driven recovery changes**, retained to show the avoidable work in that version. It is not the new client's measured traffic. The new `candidateBackgroundRecovery` daily count is deliberately `null`: healthy idle checks have been removed, but entry, subscription handshakes, foreground, reconnect, active calls, queued messages and failed reads still need real traffic measurements. Do not subtract the historical number from a production bill or assume the candidate generates zero background work.

From the repository root:

```sh
node tools/performance/capacity-model.cjs --input=tools/performance/capacity-scenarios.json --output=/tmp/capacity-results.json --csv=/tmp/capacity-results.csv
node --test tests/capacity-model.test.cjs
```

The existing `http-load.cjs` is a separate GET-only latency probe. It defaults to localhost and requires exact staging-host opt-in for remote use, capped at 10 requests/second and eight workers. Its result never establishes whole-app user capacity. Keep those guards when developing any separate, explicitly budgeted distributed load suite.

## Executable foundation checks

`capacity-foundation.yml` runs the real PostgreSQL 17.11 functions in a disposable 2 CPU / 2 GiB container. The database has no TCP listener or container network. No hosted credentials, URLs, or provider SDK calls are supplied. The workload programs accept only a Unix socket and the explicitly named disposable databases.

The feed fixture also installs the deployed read indexes captured in `production-read-indexes-20261105.json`, including ordered post-media lookup, product lookup and comment previews. `production-read-indexes.sql` reproduces those definitions locally. Each report records the final installed index definitions and source hashes. Earlier failed measurements omitted several of these indexes, so changes in timings cannot be attributed to the ranking change alone. Failed runs now retain their last completed phase and any collected measurements.

| Program | Actual exercise | Gate |
| --- | --- | --- |
| `prepared-feed-load.cjs` | 25,018 posts including 16 owner-only sentinels, 16 authenticated viewers, full `get_feed` card hydration, 30 seconds at 20 operations/s, then a 60-second soak at 10 operations/s | All arrivals complete, zero errors/private-row leaks, p95 at most 500 ms, scheduling lag at most 1,000 ms |
| Same feed program | Read while the worker holds a demand-row lock, snapshot renewal during soak, eight simultaneous PostgreSQL reconnects, live hidden-post revocation | Locked-demand read under 500 ms, renewal occurs, reconnects finish under 5 seconds, revoked row absent |
| `media-admission-load.cjs` | 64 canonical source bindings, 16 competing sessions, four admitted leases, duplicate enrollment, expired lease, emergency stop | At most four simultaneous leases, stale completion rejected, all 64 controlled failure completions accounted for, originals intact |
| `media-encode-probe.mjs` | Four real eight-second 640×360 encodes, two workers, one FFmpeg thread each | Every HLS variant independently decodes, fallback retains audio, original source unchanged |

The feed programs report both service latency and arrival-to-completion latency. A backed-up generator fails instead of silently lowering the requested rate. SQL has a server-side deadline and the test process kills a stuck local connection. The encoder result includes verification time in achieved jobs/second and reports encoding times separately.

Run the workflow on `codex/loading-foundation-20261105`, or dispatch it manually. Equivalent local commands require an already-created disposable PostgreSQL instance and the fixture databases. The workflow shows the complete setup and cleanup sequence. No PGlite throughput result substitutes for native PostgreSQL connection/locking evidence.

The media admission test deliberately closes jobs as controlled failures without producing assets. Its rate measures queue control, not encoding. The reconnect test measures PostgreSQL connections, not Supabase Realtime capacity. Neither a 60-second soak nor the number of fixture accounts establishes supported DAU.

## Bounded QA canary

After the isolated gates pass, a separately authorized QA canary can use two existing synthetic accounts and their private fixture posts. Start with 30 feed-head reads at 1 request/s, then at most 90 reads at 3 requests/s, with no more than two requests in flight. Do not escalate beyond 120 requests in this canary. Keep the original feed fallback available and capture before/after queue and database observations.

Stop on the first authorization mismatch, HTTP/server error, request over 3 seconds, generator lag over 1 second, feed p95 over 500 ms, prepared work older than 60 seconds, missing telemetry, or more than 42 database client connections. CPU below 70% also requires real provider telemetry; absence of that metric is not proof of headroom. Re-check revoked/hidden content through each account before ending the canary.

A separate reconnect canary can close/reopen at most four authenticated QA sockets with staggered reconnects, checking ordered sequence IDs and cross-account isolation. It must record missing, duplicate, and unexpected events. One HLS fixture can exercise actual source-to-playlist-to-playback under the approved daily media budget. Neither canary authorizes notification fanout to real followers, a production stress test, or additional provider spend.

`provider-readback-20261105.json` preserves the read-only baseline. Both hosted databases reported 60 maximum connections and three reserved connections. The production snapshot observed 21 client connections and QA observed 20. Those are point observations, not peaks. Recorded reservations for high-scale throughput and a five-million-DAU operating budget remain unconfirmed. A later authorized QA `capacity_capture_v1` call refreshed its stale sample without enabling processing.

The existing base workload model at five million DAU assumes 200 application requests per person per day and a peak factor of five: about 11,574 average and 57,870 peak application requests/s. Feed-head share is not measured. A passing 20-operation/s fixture demonstrates correctness and a reproducible starting measurement; it cannot be extrapolated to that target. Regional playback, sustained mixed traffic, reconnect fanout, cold-cache behavior, provider quotas, and an approved scale budget remain separate acceptance requirements enforced by `capacity-gate.cjs`.

## Expanded regression and demand-bound acceptance

The workflow also runs the `expanded` profile in a separate isolated PostgreSQL container with the same 2 CPU / 2 GiB limits. It generates 250,000 ordinary posts plus the original fixtures and 128 private owner-only sentinels, uses 128 authenticated actors and 32 client connections, schedules 6,000 reads at 100/s, and schedules another 7,200 reads at 60/s over a 120-second refresh soak. The existing authorization, live revocation, current card hydration, worker lock, arrival lag and reconnect checks remain in force. It stores five-second container resource samples and pre/post PostgreSQL statistics. The result is published as `bounded-capacity-expanded`; its presence is not a passing result, inspect `passed` and the last phase.

Use `PC_CAPACITY_PROFILE=expanded` with the same disposable local database prerequisites to run this profile. An unknown profile fails. There is no host URL, credential or remote load override.

The scale gate now binds receipts to the SHA-256 of the checked-in base scenario. It requires sustained successful API operations, delivered media bytes, distinct authenticated actors, no dropped arrivals, and at least 900 seconds of non-overlapping windows reaching the modeled API, media and realtime peaks together. A tiny workload cannot pass by setting `dauEquivalent` to five million. The gate validates the submitted evidence; it cannot prove that arbitrary supplied JSON is truthful. Retain raw runner and provider logs alongside each receipt.

At the current five-million base target this means 57,870 peak API requests/s, 442,709 realtime connections, 65.8 GB/s peak delivered media, one billion successful API requests and 1.137 PB of delivered media over a 24-hour run. These are explicit planning assumptions, not observed product demand. Changing product assumptions requires a reviewed scenario change and a new measured receipt.

`measurements/capacity-constraints-20261105.json` records fresh read-only production configuration at 15:23 UTC. The scheduled prepared-feed worker can attempt at most 8,640 snapshots/day at one per ten seconds, before failures or slow work. Even the assumption of one snapshot per DAU needs 5,000,000/day. The configured production database still has 60 connections and 224 MiB shared buffers. Provider peak reservations and the scale budget are unconfirmed. These facts prevent five-million acceptance independently of the isolated regression result.
