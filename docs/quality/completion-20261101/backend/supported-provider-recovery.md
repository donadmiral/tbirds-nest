# Supported migration request recovery

## Current installed state and next boundary

The later authorized root stage-4 request (cell `356`) returned success. Its exact
03:57:47 UTC postflight verifies stage 4 and provider journal `20261101035706`,
including source-identical SQL, catalog/body/owner/ACL and closed private data.
Normal stage-5 and stage-6 calls then succeeded, journaled as `20261101035813` and
`20261101035859`; both exact postflights passed.

Stage 7 was submitted once through the normal child tool, cell `g2:207`. It
yielded after one second, but a wait requesting 1,000 ms blocked 274.1 seconds
until the coordinator interrupted the local wait. The one recovery poll found
no cell and no provider terminal response was retained. Its exact submit timestamp
was not recoverable; the preceding durable preflight is 03:59:24 UTC. At 04:04:36
UTC the database remains exact private stage 6 with no stage-7 journal, no public
activation and no active/open or prepared transaction. This absent observation
is not remote cancellation. See `business-stage7-supported-attempt.json`.

Root owns all further mutations. The independent source-specific stage-7 review
and exact request/preflight/postflight package are ready in
`business-stage7-next-apply-package.json`. The review establishes at most one
committed private installation for concurrent or late identical requests under
the fresh gates; it does not resolve the unknown request or weaken confirmation.
No stage-7 retry or stage-8 apply has been made by this child. Support and
notification requests remain separate unknown operations, unretried.

## Historical root confirmation expiry and recovery

The coordinator's unchanged stage-4 call, cell `344`, returned a real terminal
provider result at **2026-11-01 03:36:58 UTC**: status `expired`, with the message
“This confirmation expired after 2 minutes. Call `apply_migration` again to get a
new confirmation.” The exact read-only postflight at **03:44:07 UTC** still shows
pristine stage 3, the target function and stage-4 journal absent, empty private
tables, and no other active/open client transaction or prepared transaction.

This supplies a supported recovery path for that terminal root request: coordinate
one unchanged normal `apply_migration` call after a fresh exact preflight and
complete the provider's new confirmation within its window. It does not require
changing SQL, weakening its classification or using another DDL route. Do not
advance to stage 5 until the actual stage-4 result and journal are verified.
Earlier child requests still retain their unknown outcomes; the root expiry does
not retrospectively cancel or reject them. The historical observations below are
preserved as such. See `business-stage4-root-terminal-postflight.json`.

The current authorization already covers completing the reviewed work. Three
groups of earlier child requests still have no terminal provider result. Those
requests exposed no approval form, approval rejection, confirmation token
or provider request ID. Local interruption does not cancel a remote
request. No alternate DDL route or rewritten SQL is warranted. A later narrow
review established a concurrency-safe exception for one unchanged stage-4
normal-tool retry, described below; support and notification remain unretried.

## Narrow stage-4 recovery exception

`business-stage4-concurrency-review.md` and its JSON receipt establish that this
exact transaction can commit the new private function and stage marker at most
once. A late identical request fails the stage/catalog guard; overlapping requests
that both pass the old guard collide on the target's immediate unique function
index, and the unsuccessful transaction rolls back. No function body or provider
operation is invoked by installation. The actual DDL event triggers were inspected.

The coordinator may therefore perform **one** unchanged stage-4 submission through
the normal supported tool after every gate in
`business-stage4-recovery-preflight.sql` passes freshly. This is an evidence-based
exception to the earlier conservative operational hold, not an approval bypass
or a claim that any previous request was canceled. Keep all guards, transaction
boundaries, destructive classification and timeouts unchanged. No agent-context
success is promised; the earlier successful readiness request was also in the
child lane. This review does not establish retry safety for support, notification
dispatch or any other candidate.

## Exact operations and observed boundaries

Project: `uaulhuelcfkjwojtymmw` (QA). Tool: `supabase_apply_migration`.

| Submitted migration | Source SHA256 | Local request boundary |
| --- | --- | --- |
| qa_business_auth_04_private_member_signin_20261101 | ba49c5c8b8545952288ac1885bcf3421d4b42bb21c054d87391b891ed7edb749 | Initial wait 1,128.1 seconds; no cell or provider result. A later unchanged, exact-state-guarded request began 2026-11-01 02:15:58 UTC and yielded g2:99; subsequent local execution blocked 953.9 seconds. Its one recovery poll returned cell not found. Both remote outcomes remain unknown. |
| member_support_atomic_reply | de99b019d678dfc51c5b8d6c8a7e533454f7965642bade94929c3fd5d040f7c1 | Wait 952.0 seconds; no cell or provider result. No duplicate submitted. |
| qa_notification_event_dispatch_capabilities_20261101 | 9a5a7ea2d9acfc9c21185ac5b2654cfebd9d8f5aba29363cd5a5b5616f4bf081 | Submitted once at 2026-11-01 02:44:25 UTC; yielded g2:133. A wait requesting 1,000 ms blocked 1,636.6 seconds until coordinator interruption. Its one recovery poll returned cell not found. |

The successful independent operation is also material: the normal supported
`private_media_readiness_storage_references` apply returned success and was
journaled as `20261101021335`. Its exact body/owner/ACL and hosted readiness
postflight passed. The connector is therefore not universally unavailable.

At **2026-11-01 03:12:37 UTC**, the supported read-only postflight found business
stage 3, no atomic support reply, no music schema, no notification candidate tables,
functions, triggers or journal, and no active candidate SQL statement. The
readiness repair's journal remained present. Provider-owned pg_net ACLs were
unchanged. This absent after-state is not proof of cancellation or rejection.

## Available recovery mechanisms

The exposed Supabase tool inventory provides project details, migrations, SQL
readback and logs. It does **not** expose a pending `apply_migration` request lookup,
request cancellation, confirmation-token completion, or approval-history operation.
The existing cells no longer exist. Project details returned `NotFoundException`
while SQL and Edge listing for the same QA project succeeded; that individual
endpoint response cannot establish that project access was lost.

The normal read-only log query found no matching stage-4/support request rows
in its bounded window. We did not infer a provider decision from missing logs.
No live confirmation from the earlier unknown calls can be approved or resumed
with the current tools. The later root confirmation has explicitly expired and
can be refreshed only by another ordinary supported apply, coordinated with the
confirmation window. A repeated submission could still create another uncertain provider
operation; only the explicitly reviewed stage-4 exception above has a justified
database-effect bound.

If the supported confirmation refresh remains unavailable, the concrete external
recovery request is to identify the older unknown operations by the
project, exact names, UTC times and source hashes, then return their authoritative
request IDs and terminal states. If a provider confirmation exists, it must be
resolved through that provider's ordinary supported interface. This is a request
to resolve the existing operations, not a request to execute replacement SQL.
No support message has been sent and no unseen rejection or approval is claimed.

## What we will do when the provider state is established

1. Re-run the exact read-only catalog, journal and activity checks, including the
   stored business fingerprint. Use `notification-event-post-interruption.sql`
   for that candidate's current catalog observation.
2. If an operation committed, verify its exact source-derived definitions,
   owners, ACLs, triggers, disabled readiness and journal before moving forward.
3. If the provider establishes that an operation never started or has terminated
   without a commit, use its ordinary supported recovery/resubmission path only
   after a fresh exact preflight. Keep every reviewed SQL guard unchanged.
4. Continue the authorized dependency order recorded in
   `ordered-completion-dependencies.json`, then deploy the prepared source-bound
   Edge packages and perform the actual account/provider acceptance. We retain
   ownership of the implementation and rollout after these external gates clear.

For original-audio acceptance, the database and dependent Edge contracts must
first exist. The separate current Auth preflight also requires a real disposable
test identity/authorized confirmation: email signup is enabled with autoconfirm
off, and no other Auth method is enabled. No unverified account or email was sent
to manufacture that gate. Existing single-account saves and reads are evidence
for that account only. Licensed catalogue activation remains deferred pending
actual commercial/provider rights, distinct from the requested owned-audio work.

## Receipts

Use `connector-mutation-attempts.json`, `business-stage4-resume.json`,
`notification-event-supported-attempt.json`,
`notification-event-post-interruption.json`,
`provider-request-status-observation.json`,
`readiness-supported-apply-attempt.json`, and
`auth-disposable-account-preflight.json`. These contain public-safe metadata and
source references; they contain no credentials or ordinary-user message content.

## Ready request and acceptance checks

`business-stage4-next-apply-package.json` binds the exact next supported request,
fresh preflight and private-stage success postflight. The request preserves all
7,894 source bytes and the official destructive classification. No new
confirmation was created while preparing it. The helper
`verify-business-stage4-next-package.mjs` passed seven isolated actual-SQL checks,
including rejection of missing/changed journal bytes, an extra execute grant and
an unexpected activation hook. The hosted success checker correctly returned
`stage4Installed: false` for the unchanged stage-3 baseline at 03:51:24 UTC.

`completion-read-only-backend-acceptance.json` records the remaining meaningful
read-only checks: the repaired readiness helper still has its exact body, owner
and ACL; all five buckets are private; the 13 actual references have no missing
or unbound objects; both erasure operator triggers exist and the private review
ACL remains closed. The erasure queue is empty. The 03:52:03 UTC observation still
finds no installed music, atomic support reply or notification candidate. These
checks establish the existing metadata and observed data state; actual
disposable-account erasure, multi-account access and provider delivery remain
separate gates. Repeating unchanged source suites or these same snapshots will
not establish those missing real operations.
