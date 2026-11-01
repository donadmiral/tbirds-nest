# One-use music maintenance dispatch

## Scope and current state

This forward migration repairs the concrete reusable-worker-credential exposure in the old music cron operation. Retained QA metadata shows `net.http_request_queue` and `net._http_response` are provider-owned, lack RLS, and grant PUBLIC table access. The old operation would put a reusable Vault bearer in the readable request queue. No such old music credential or cron is activated by this package.

The new migration is `supabase/migrations/20261101043002_music_maintenance_one_use_dispatch.sql`, SHA256 `ca03884998d29913cee9829be7f31e3d827a5d2f3b8953db7cb0e3f963dfe35b`, 11,155 bytes. Root submits the exact request in `music-maintenance-dispatch-request.json` through the normal supported migration tool after the three immutable music migrations pass their exact postflights. No migration or activation was submitted by this offline preparation.

The three original music migration files, current music-maintenance Edge API and both Edge source files remain byte-identical. This repair neither activates original uploads nor provides catalogue rights, provider credentials or licensed playback. It does not modify the independent account-erasure worker.

## Capability and retry contract

Each enqueue produces a fresh random `pc_music_` capability for the fixed `/functions/v1/music-maintenance` endpoint and an empty body. The private database stores only its SHA256 digest. Its expiry is exactly two minutes after creation; a service-only validator atomically changes one matching queued row to claimed and updates the heartbeat. Wrong format, wrong caller role, wrong purpose, wrong dispatch revision, expiry, pause and replay all fail. Private configuration, receipts and operator functions have RLS/no ordinary or service-role direct privileges.

The worker/configuration row lock is acquired before reading the capability clock. Enqueue, consumption, pause and source configuration share that lock order. A duplicate enqueue during the five-minute schedule window returns the original queue request even after consumption; it cannot authorize a second cleanup batch. Queue failure rolls back its nested queue operation and records only a SQLSTATE in a failed private receipt, so a fresh enqueue can retry safely. An exact duplicate installation fails the preflight after the first commit, rather than replacing an advanced installation.

The queue still necessarily carries short-lived one-use authority. A party able to read that provider queue could cause the fixed, already-authorized bounded maintenance invocation during its lifetime. It cannot obtain a reusable credential, choose a user/object/endpoint, replay the capability or activate uploads/catalogue services. This repair does not claim to remove provider queue visibility or denial-of-service possibilities; it limits the authority placed there and keeps cleanup's existing per-object ownership and lease checks.

The migration explicitly retains its bounded DELETE for expired capability receipts so the normal provider confirmation can classify it correctly. It does not delete media. It refuses an already enabled, credentialed or previously used legacy worker, unexpected old RPC body/config/ACL, absent prerequisites or missing postgres execution on the normal provider HTTP API.

## Configuration and activation order

1. Verify all three unchanged music contracts and source journals, then the exact read-only preflight in this package. Require no concurrent client transaction or prepared transaction.
2. Root applies the exact forward migration normally; run the exact postflight and strict verifier. Initial state remains disabled, unconfigured, with zero runs, no heartbeat and no reusable credential.
3. Deploy/read back the reviewed dependent Edge bundle normally. The music-maintenance request SHA256 is `e2ec64030d3bce1af723b006e24014e91afb168134fbb388a3c889fd252124c2`; it binds the exact QA deployment arguments, source bytes and JWT setting. It is not a claim about a provider's compiled bundle bytes. Verify each source-file hash from the retained Edge package before using that reviewed identity as the dispatch `worker_sha256`.
4. Apply the public-origin/source-identity setup operation while maintenance remains paused. Configuration does not enable anything and creates no reusable secret. The legacy credential setup operation now fails closed.
5. Through the existing service-only readiness RPC, enable maintenance with a recorded reason; enqueue one capability and verify an actual claimed run, heartbeat and unchanged scope. Run the guarded cron installer only after that safe path works. It schedules only `select music_library.enqueue_maintenance_run();`; no bearer, Vault lookup or HTTP payload appears in cron text. A different pre-existing command is refused instead of silently replaced.
6. Enable original uploads only after the actual finalizer, delivery, maintenance and disposable-account acceptance dependencies are available. Licensed ingestion/playback stay disabled and grants/credentials remain zero. If a runtime gate fails, pause maintenance/uploads through their reviewed controls and preserve the concrete failure.

## Verification evidence

The actual SQL behavior suite passed 14 named cases with no skips, covering installation drift/refusal, ACLs, disabled defaults, configuration, fixed endpoint and digest-only storage, one-use consumption, expiry, pause/revision revocation, wrong scope, enqueue retries, queue failure rollback, bounded retention and the real cron install operation's readiness/idempotence/conflict checks. The unchanged Edge handler suite passed 14 cases.

The offline generator executed the exact generated read-only projection before and after the migration against the inspected QA baseline, repaired business activation, guarded story transition and all three unchanged music sources. Catalog count is 422 before and 462 after. The only changed existing catalog contracts are `public.set_music_maintenance_ready(boolean,text)` and `public.validate_music_maintenance_worker(text)`. All additions are the two private tables, their constraints/indexes and three operator functions. All private ACL counts remain zero and all readiness flags remain disabled.

The strict verifier passed both positive projections and rejected 16 malformed evidence variants, including missing/duplicate catalog entries, changed RPC body/ACL, opened private access, bool-as-number counts, premature runs/configuration/activation, reusable credentials, a public bucket, missing provider execution, wrong journal/source/statement count, missing music prerequisite and wrong executor. These are local source-bound results, not hosted installation or delivery acceptance.
