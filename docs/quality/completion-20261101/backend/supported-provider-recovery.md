# Supported migration request recovery

The current authorization already covers completing the reviewed work. The actual
block is that three independently submitted migration types have not returned a
terminal provider result. No approval form, approval rejection, confirmation token
or provider request ID was exposed. Local interruption does not cancel a remote
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
No visible provider confirmation can be approved or resumed with the current
tools. A repeated submission could still create another uncertain provider
operation; only the explicitly reviewed stage-4 exception above has a justified
database-effect bound.

The concrete external recovery request is to identify these operations by the
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
