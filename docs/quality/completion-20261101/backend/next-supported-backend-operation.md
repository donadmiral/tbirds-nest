# Historical stage-4 recovery preparation

Stage 4 and subsequent private stages 5–6 are now installed and verified. This
file preserves the exact preparation used for that recovery. The current next
operation is recorded in `business-stage7-next-apply-package.json`, whose
coordinator-owned normal apply must retain its separate confirmation.

The next operation is the unchanged QA private business-auth stage 4. Its previous
coordinator request returned an **expired provider confirmation**, so a new ordinary
confirmation must be coordinated while the user is available. Preparing the files
below has not opened that confirmation or submitted another migration.

## Exact request and observed baseline

The complete normal-tool arguments are in
`business-stage4-next-apply-request.json`: QA project `uaulhuelcfkjwojtymmw`, name
`qa_business_auth_04_private_member_signin_20261101`, and all 7,894 original SQL
bytes. The source SHA256 is
`ba49c5c8b8545952288ac1885bcf3421d4b42bb21c054d87391b891ed7edb749`.
The package manifest binds that request, the preflight and the success checker.
No SQL, transaction boundary, classifier, guard, timeout or function body was
rewritten. The request must use `supabase_apply_migration`; it must not use an
alternate DDL route or skip the provider's confirmation.

At 03:51:24 UTC the exact read-only checker still observed private stage 3:
fingerprint `2f92a9d038364736fa2413bb6d05a160`, 99 catalog rows, empty private
tables, no business Auth session, no target function or stage-4 journal, and no
other active/open client transaction or prepared transaction. These are historical
observations, so repeat the preflight immediately before applying.

## Coordinated execution

1. Read `business-stage4-next-apply-package.json` and verify its recorded file
   hashes. Run `business-stage4-recovery-preflight.sql` through the normal
   read-only SQL tool. Require `allGatesPassed: true`. Any catalog/data/session
   change requires inspecting that actual state before proceeding.
2. When the coordinator has the confirmation window ready, submit the exact
   argument object to `supabase_apply_migration` and complete its ordinary
   provider confirmation. Record the terminal tool result and provider version.
   Retain the earlier child requests as unknown; the narrow concurrency review
   establishes the database-effect bound for this exact request only.
3. Run `business-stage4-success-postflight.sql`. Require `stage4Installed: true`:
   this checks the exact stage-4 marker and 100-row catalog fingerprint, the
   source-derived function body and metadata, all private ACLs, absence of public
   activation, empty data/session guards, and the provider journal's exact source
   bytes/hash. Function existence or a submitted request alone is insufficient.
4. Continue stages 5–7 sequentially using the unchanged source units and their
   manifest before/after fingerprints, with the generic staged `postflight.sql`
   after each. Stage 7 keeps its own destructive confirmation. Before another
   apply, recheck current data/session and activity guards; quiescence is separate
   from whether the preceding stage installed correctly.
5. Stage 8 remains one atomic transaction. Its source manifest's final fingerprint
   is a local fixture value. After hosted activation, enumerate every currently
   eligible RLS table and verify its exact restrictive policy, as well as the six
   published functions, five triggers, grants, seeds and request hook. Use the
   staged catalog projection and `check-business-bound-auth-postflight.sql`;
   never substitute the fixture's policy count for hosted coverage.
6. Follow `ordered-completion-dependencies.json` for the three music migrations,
   source-matching Edge deployments and actual owned-audio acceptance. The
   prepared Edge request files are complete. Readiness starts disabled; a real
   confirmed disposable identity is needed for multi-account and erasure gates.
   Commercial catalogue rights are separate and remain deferred.

If a request expires again, record the actual expiry and fresh read-only state.
If it yields no terminal result, preserve that unknown outcome. Do not infer
remote cancellation from local interruption. Support and notification requests
remain outside this source-specific retry review and have not been resubmitted.

## Checks completed while confirmation is pending

The offline request/postflight verifier passes seven actual-SQL fixture checks.
It accepts exact stage 4 only with the source-identical provider journal, and
rejects stage 3, a missing/changed journal, an added execute grant and an unexpected
activation hook. Its hosted read-only execution correctly rejects the current
stage 3 as not installed.

The latest independent read-only receipt also verifies the installed readiness
body/owner/ACL, 13 actual Storage references with zero missing or unbound objects,
five private buckets, ten restrictive policies, closed erasure-review access, two
erasure operator triggers and an empty erasure queue. The music schema, atomic
support reply and notification candidate are still absent. These checks do not
claim a real account was erased or that external delivery occurred.

The useful remaining reads are the fresh preflight and after-state checks at the
actual provider operation boundary. Repeating already-passed source suites or
unchanged catalog snapshots cannot replace the confirmation, installed contracts,
confirmed disposable accounts or provider acceptance.
