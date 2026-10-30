# Account-erasure operator workflow

## Implemented behavior

The deletion desk now lets an authorized super administrator add an investigation note or explicitly ask the service to **recheck and resume eligible erasure**. The latter can schedule irreversible deletion, so its form describes the consequence and requires an explicit confirmation. It does not offer an override for retention or ownership holds.

General staff-created deletion requests previously stopped after disabling sign-in. An eligible reviewed request now obtains a persistent link to the same Storage-first worker used by member requests. The desk shows that worker's actual state and verified file counts. A hold before file inventory exists is labeled as an inventory awaiting review, rather than claiming zero stored files. An admin request becomes completed only when the existing worker completion contract has verified Storage and Auth identity absence. A compact completion record survives expiration of the worker's 30-day technical receipt. The page avoids links to profiles already removed during identity preparation.

For member requests, review resumes the original job. It preserves the original receipt, object identities and versions, erased-file count, cache-invalidation wait, and retry history. A changed object or ownership proof stays on hold. An active worker lease cannot be taken over. A completed or already queued job cannot be reactivated by a new review command.

The original worker represented successful application cleanup through its `identity_pending` state. Exhausting provider retries could replace that state with a review hold. The new migration makes that phase durable through an `identity_prepared` flag and backfills existing technical events. After review, these jobs resume identity deletion without repeating already completed application cleanup. The tests deliberately make repeated cleanup fail to prove that the correct phase is retained.

## Authorization and transaction guarantees

The server action resolves the existing verified staff token and native Auth session. The database independently checks the current `account_delete` permission and live native session before accepting a new command or returning an idempotent receipt. App roles cannot call the review RPC or read private review notes.

Every command binds its source, request ID, opaque state version, note, action, actor and idempotency key. Changed state invalidates a stale form. Reusing a key for different details fails. Worker state, timing, lease and progress participate in the version. The account's existing write fence and advisory lock remain in use. Worker and review row locks follow job → admin request → account lock ordering.

Before scheduling work, the service rechecks the current retention rules, stored-object provenance, disabled identity, worker health and deployed application cleanup. Cleanup eligibility runs in a subtransaction that is always rolled back. Scheduling, private review records, the shared audit event and the command receipt commit atomically; an audit failure rolls everything back.

The migration does not delete Storage metadata, call a provider, delete an Auth identity, change bucket visibility, change financial records, or weaken existing retention rules. The privileged worker still performs physical deletion through the existing provider APIs.

## Verification

| Gate | Result |
|---|---|
| Exact production-derived admin/privacy/hardening chain | 20 cases passed |
| Exact QA forward chain | 20 cases passed; existing synthetic account/profile/staff/Storage data preserved |
| Actual admin server action and service | 9 cases passed |
| Actual queue server rendering | 3 cases passed |
| Admin TypeScript | Passed |

The database cases cover permissions and replay, stale versions, explicit confirmation, financial and managed-account holds, ambiguous ownership, worker health, rolled-back cleanup, partial progress, object-version changes, active leases, exhausted identity-provider retries, verified admin completion, receipt expiration, completed-job protection and audit atomicity. An additional regression covers a staff request created after a member job was already queued: verified completion establishes its link before the job anonymizes its subject, and remains visible after receipt expiration. These are executable isolated database/provider-contract fixtures; they do not represent deletion of a real hosted account or an authenticated staff walkthrough.

Evidence: `ERASURE_OPERATOR_DB_GATE_20261030.json`, `QA_ERASURE_OPERATOR_DB_GATE_20261030.json`, `supabase/tests/rpc-authorization/test-erasure-operator-chain.mjs`, `admin-web/tests/erasure-review.cjs`, and `admin-web/tests/erasure-queue.cjs`. The rendering cases prevent a false zero-file claim before inventory, dead links to removed profiles, and actions appearing against the older read-only queue contract. An independent source review identified the mixed member/staff completion case and the misleading zero-file message; both were fixed and regression-gated before freezing this candidate.

The migration was created using `supabase migration new account_erasure_operator_review`: `20261030005241_account_erasure_operator_review.sql`. Fresh read-only preflight and postflight queries are included in `supabase/ops/check-erasure-operator-{preflight,postflight}.sql`. Deploy only after their required prior admin/privacy migrations. The QA fixture additionally tests the separately applied database hardening delta.

## Remaining policy and hosted acceptance

Existing policy intentionally holds accounts with any matching financial or order records, including zero balances or settled history; any staff identity, including an inactive staff record; managed-account responsibilities; or ambiguous stored-file ownership. Review cannot erase those records or assert that their obligations disappeared. They need a separately approved retention/anonymization or managed-account/provenance resolution process. This implementation closes the operator scheduling and retry gap for eligible accounts while retaining those boundaries.

An authenticated staff walkthrough and a deliberately disposable isolated QA account still need to exercise real Storage deletion, CDN propagation, provider Auth deletion and the final status shown in the desk. No real user data was deleted by this implementation or its local gates. No TestFlight action was taken.

## Ordinary restore is fenced during erasure

The follow-up migration `20261030010250_account_erasure_admin_restore_guard.sql` closes a cross-module conflict: ordinary staff restoration previously checked only staff-created deletion requests. It now rejects `restoreUser` and `liftRestriction` for every pending self-service erasure, including retention review, before returning an old command receipt. A shared account-erasure lock is acquired before staff/Auth row locks, so acceptance of a concurrent deletion cannot be undone by ordinary restoration. The operator workflow remains the only review/resume path. It does not reopen sign-in.

The regression failed against the previous source with “Missing expected rejection.” Both production-shaped and QA-shaped media/admin chains pass 21 cases after this change. Both complete operator chains pass 20 cases, including a hold-to-resume sequence that remains protected against ordinary restoration. The new forward migration preserves the frozen previous candidates and fails if the exact central-command definition has drifted. No hosted state was changed by these local tests.
