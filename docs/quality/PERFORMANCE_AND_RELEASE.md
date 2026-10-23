# Performance and release verification

## Implemented startup behavior

- Native starts the account-bound disk read and live feed load together. The snapshot contains at most 20 recently verified public posts, expires after 15 minutes, and is cleared on account change, sign-out, hiding or visibility invalidation. Private media capabilities, messages and payment data are never saved in this cache.
- Web authenticates on the server, starts feed and mute-preference reads together, and renders real first-page content in HTML. Browser hydration does not duplicate a successful initial fetch. A failed media signer removes protected URLs while keeping authorized post text readable and offering retry.
- Refresh updates existing rows in place. New posts wait behind the new-posts action, preserving reading position. Retained pages have visibility rechecked. Request and account generation checks reject late responses.
- Paging keeps its cursor until both content retrieval and media authorization succeed. Image prefetch is limited to nearby safe images/posters, never whole videos, and respects web data saver. Virtualization bounds mounted web post cards.
- Five-minute content-media capabilities are refreshed on foreground/focus and at four-minute intervals while active. Still-valid in-memory capabilities are reused during paging; they are not persisted to feed snapshots.
- Route retry fetches fresh server data using the installed Next API: `retry` on web 16.3 and `unstable_retry` on operations 16.2. Root-layout errors have a separate HTML/body fallback.

## Diagnostics

Only enumerated category, source, platform, fatal status and validated app version are collected. Raw error messages, stacks, links, tokens, arbitrary context and user content are excluded in both clients and the database. Authentication binds the reporting account. Clients deduplicate and cap requests at five per minute; the database deduplicates and caps each account at ten reports per ten minutes. Report delivery is best effort and never retries recursively. Unauthenticated errors are not persisted.

The operations Controls desk shows the latest received reports and redacts legacy report text. Absence of received reports is not proof that all devices are healthy. Server feed timing logs include only duration, row count and result category. The browser `pc-performance` event provides feed refresh/page timing to an authorized test harness without sending post content.

## Local verification

Install the committed lockfiles for the root, web, admin-web and supabase/tests/rpc-authorization directories. Use the same Node major as CI (22).

```sh
node tools/performance/release-checks.cjs --output=/tmp/platinum-release-checks
```

The runner records each of the three typechecks, root/web/admin regressions, database tests and RPC authorization suite in a separate log, then writes a machine-readable report. It uses at most two suites and two test files per suite concurrently to bound PGlite memory. A nonzero status is a failed gate. It does not build native binaries, sign builds, migrate a hosted database, call a payment provider, or deploy anything. Production builds and the authenticated device/browser scenario matrix remain separate release gates.

To rerun one gate after a targeted fix:

```sh
node tools/performance/release-checks.cjs --suite=web-tests --output=/tmp/platinum-web-checks
```

CI discovers the new feed, diagnostics and database regression files through its existing test globs. It also limits test-file concurrency to two.

## Controlled latency probe

```sh
node tools/performance/http-load.cjs --url=http://127.0.0.1:3000/home --requests=100 --rate=5 --concurrency=4 --expect=data-feed-content --output=/tmp/platinum-latency.json
```

An authenticated page requires an already authorized QA account cookie through `PERF_COOKIE`; never put it in a command argument, report or source file. Redirects to sign-in, missing initial content, transport failures and non-success statuses fail the default gate. Reports include p50/p95/p99/max latency, throughput, errors and bytes. They omit cookies and query strings. The probe is GET-only. External targets require explicit `--allow-staging` and exact `PERF_ALLOWED_STAGING_HOST`, HTTPS, and remain capped at 10 requests/second and eight workers. It must not be pointed at production. Longer/high-throughput testing belongs on an isolated, separately budgeted environment.

## Capacity assumptions: a planning scenario, not a measured claim

Five million registered accounts does not define concurrent usage. For a concrete initial planning model assume:

| Input | Assumption | Derived load |
| --- | --- | --- |
| Registered accounts | 5,000,000 | Storage/identity cardinality |
| Daily active accounts | 20% = 1,000,000 | Daily working set |
| Time active per day | 30 minutes per daily account | About 20,833 average concurrent users |
| Peak factor | 5 times average | About 104,167 concurrent users |
| Feed requests per day | 12 per daily account, including first page | About 139 average / 695 peak feed requests per second |
| Other API requests per day | 80 per daily account | About 926 average / 4,630 peak requests per second |
| Media transferred per day | 80 MB per daily account, decimal units | 80 TB/day; about 7.4 Gbit/s average / 37 Gbit/s peak CDN delivery |

Video, calls and live-event spikes may exceed this model. Ads/analytics writes, realtime connections and message fan-out must be modeled separately. Payment throughput is unrelated to feed throughput and requires independent idempotency and provider-capacity verification.

Before making a capacity claim, create a representative synthetic dataset with skewed follower counts, large communities, long message histories, expired media, cold caches and typical block/mute/access policies. Measure independent API and CDN paths, database pool wait, query p95/p99, CPU, memory, storage I/O, realtime connection/fan-out load, queue age, error rate and provider quotas. Ramp to the planned peak, include at least a one-hour peak soak, test a deployment/reconnect spike, then repeat after failover with sufficient headroom. Never run that ramp with live users or real payments.

Proposed acceptance budgets for the release test matrix: warm native cached content within one second on the chosen baseline device; normal-network web initial content p95 below 1.5 seconds; feed API p95 below 300 ms and p99 below one second at the accepted peak; fewer than 0.1% unexpected failures; no scroll jumps, duplicate sends, cross-account content or unbounded memory growth. These are target budgets to measure, not current claims. Record device, geography, network conditions, dataset and exact build for every result.

## Evidence boundary

`feed-query-plan-20261022.json` records a read-only QA query plan: 9.716 ms execution, 24.413 ms planning and two returned posts. It establishes only that small-dataset query result. It is not a load test, native startup measurement, recovery/failover test or evidence of five-million-user capacity. Automated synthetic regression passes establish the behaviors they exercise; they cannot establish provider delivery, app-store acceptance, licensing, encryption properties or production capacity by themselves.
