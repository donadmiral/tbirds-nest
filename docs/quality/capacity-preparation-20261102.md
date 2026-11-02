# Capacity preparation with experience preservation

The target is more than five million daily active users while preserving the current product experience. This implementation reduces avoidable work and introduces bounded, reversible server contracts. It does not establish the capacity of a hosted deployment. Daily users must be translated into measured concurrency, sessions, requests, media consumption and regional traffic before a capacity sign-off.

## Implemented foundations

| Area | Change | Compatibility boundary |
| --- | --- | --- |
| Background traffic | Event-driven recovery replaces healthy idle health, typing and inactive-call polling. Retry work pauses in the background, uses jitter and recovers on reconnect/focus. | Active calls, presence expiry, durable message IDs, the outbox and final typing state remain covered by regression tests. |
| Feed change delivery | Private, ID-only Broadcast interests and a durable coalescing queue replace broad feed delivery when enabled. Client windows, joins and refresh requests have explicit budgets. | Disabled by default; ranking, row keys, scrolling and the new-posts pill keep their existing contracts. |
| Feed metadata | Nearby poll, collaborator, tag and edit reads share bounded batches. Cancellation propagates into media signing; old sessions cannot publish late results. | No completed cross-viewer metadata cache. A failed renewal retains already-confirmed presentation metadata. |
| Post counters | Statement-level grouped deltas replace repeated full recount triggers, with canonical reconciliation and protection for derived counter fields. | Existing counter meanings are retained; views remain separate. Hot-post serialization still requires a later design. |
| Books and shelves | Seek-based page readers, incremental hydration and exact cover/count metadata avoid downloading every page to open a book. | Disabled by default. Complete films, editors, grids and pickers explicitly finish reading all pages. |
| Inboxes | Personal, context and acting-business readers have separate compatible contracts. Initial pages and retained-ID reads are bounded; badges and tab totals describe the full authorized scope. | Disabled by default. Existing access, request, archive, sender and unread rules are tested against the legacy readers. |
| Admin | Service-only aggregate readers return compact dashboard and analytics results rather than downloading large platform tables to count them in the application. | Exact result semantics and existing presentation are retained. These are still primary-database scans, not maintained reporting projections. |
| Media processing | Durable, versioned jobs, bounded leases, retry/dead-letter state, private immutable derivatives, version checks and physical Storage cleanup replace in-place remux assumptions. | All processing/delivery gates start disabled. Originals remain available. A faststart MP4 is not a substitute for adaptive streaming, CDN design or provider capacity. |

Operational repairs and release-version evidence that disclose private deployment details are maintained in the private implementation handoff, outside this public repository.

## Preservation requirements

Keep the accepted visual design, native mouse scrolling, media ownership and stable feed geometry. Do not restore scroll-jumping virtualization or truncate history simply to satisfy a memory number. Account replacement, revoked access, delayed metadata, background/resume and incomplete media grants must fail without displaying another account's or another post's data.

The important compatibility checks include the final event in a burst, a timeout while transport is still running, a removal while an older request is pending, full unread totals beyond page one, complete book exports, private media authorization, and navigation back to a long scrolled feed. A transport slot remains occupied until its underlying work actually settles; aborting a caller cannot silently multiply in-flight requests.

## Rollout contracts

- [Feed delivery and durable queue](feed-live-rollout.md): explicit delivery/join budgets, worker health, privacy checks and the default-off activation sequence.
- [Book, shelf and versioned inbox readers](paged-readers-rollout.md): complete-reading behavior, cursor identity, exact semantics, index preparation and rollback.
- [Personal inbox clients](inbox-client-rollout.md): loaded-range reconciliation, full badges, forwarding, message invalidation and session fences.

Apply additive schema changes to QA before deploying clients. Compare the target's canonical authorization/read contracts with the tested versions, verify effective grants, and retain old APIs. Enable a capability only after its actual authenticated hosted path has passed. A successful schema installation or a disabled capability is not evidence that the new path is active for users.

Production frontend and native release parity must be verified separately from a feature branch: this repository contains prior accepted work as well as these changes. Do not promote a branch solely because its local tests pass when the production backend or released native binary has a different contract.

## Reproducible checks

```sh
node tools/performance/release-checks.cjs --suite=all
node web/tests/browser/scroll-run.cjs
node web/tests/browser/memory-paging.cjs
```

The full runner includes native, web and admin TypeScript checks and regression suites, database contracts and RPC authorization tests. The browser workflow additionally exercises actual app components, decoding/export paths, navigation and admin controls using synthetic fixtures.

The `database-concurrency` CI job creates a disposable PostgreSQL 17 database with no TCP listener and runs counter, feed-queue, paging, context/business inbox, media-processing and service-authorization contracts. The real PostgreSQL tests require dedicated `pc_scale_*` databases and reject hosted targets; some contract files use PGlite when the real database variables are absent. Report real-database and emulated results separately.

Browser fixture timing, synthetic row counts and local query plans are diagnostic evidence. They do not measure production throughput, network conditions, provider quotas, mobile GPU behavior or the performance of the public deployment.

## Work still required for a five-million-DAU sign-off

1. Complete the compatible operational rollout and reconcile exact web, admin, native and backend releases.
2. Verify and gradually activate the new authenticated QA paths, including private Broadcast delivery, permission changes, membership removal and reconnect behavior.
3. Replace the remaining expensive feed candidate/ranking work, design hot-post counter distribution and durable notification fanout, and move large reporting work onto maintained projections or an appropriate reporting path.
4. Bound long-session retained feed/inbox history without changing scroll behavior. Rendered native cells are bounded; retained arrays, maps and web DOM history are not yet fully bounded.
5. Complete the rendition, CDN/cache, media authorization, external-processing and recovery architecture. Measure actual hosted upload, playback, Range behavior, cleanup and worker resource use.
6. Establish measured infrastructure capacity, provider quotas, reserve resources, monitoring, restore/failover behavior and an approved operating budget.
7. Run representative authenticated mixed workloads, regional playback tests, a 24-hour soak, viral-post tests, reconnect bursts and failure recovery. Advance through the planned DAU-equivalent stages only when latency, errors, correctness, queue age and recovery gates pass.

The workload calculator in `tools/performance/capacity-model.cjs` remains an offline planning model. Its old polling estimates are explicitly labeled historical; current candidate recovery traffic is marked unmeasured. Neither a calculator result nor a single successful load stage warrants an unlimited-user guarantee.
