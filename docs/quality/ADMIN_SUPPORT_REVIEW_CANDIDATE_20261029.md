# Narrow support/review admin candidate — 29 October 2026

## Reviewable result

The missing support assignment and seller-review moderation workflows now have a narrowly scoped atomic migration and an exact production-baseline test. **All 16 registered database cases pass, with no failures or skips.** The production-compatible admin UI backport passes its 10 focused cases, standalone TypeScript and a Next16.4.3 production build.

**Applied and postflight-verified.** The release owner published the three-file UI backport in [PR #5](https://github.com/donadmiral/tbirds-nest/pull/5), merged it as `ce4f2f2ebbd7f7669b630caf650fd97cd59297b0`, and verified READY deployment `dpl_EtZFdDQDsaZ7V6pifpjSLt3SttCL` at `admin.platinumcircles.app`. All three [GitHub quality jobs](https://github.com/donadmiral/tbirds-nest/actions/runs/40947592056) passed. The fresh database preflight exactly matched the tested catalog before migration `20261029202457`, named `platinum_app_quality_admin_support_reviews_20261029`, was applied. Postflight matches all five function hashes and intended grants, private-table denials, unchanged session helper and held-contract absence. [The installed receipt](ADMIN_SUPPORT_REVIEW_POSTFLIGHT_20261029.json) records those results.

No real support reply, review moderation, staff account creation or deletion was used as a test. Hosted staff-session/browser acceptance is still pending; general support reply/status, provisioning and deletion-queue workflows are not restored by these four contracts.

## Exact migration and behavior

Candidate: `supabase/migrations/20261029213000_admin_support_review_contracts.sql`.

SHA256: `db5e56166965decc7b9dd873c28b40cfa322e07e909297da03d8a6c10f0dd759`.

The transaction creates a private `admin_ops` namespace with only `commands` and `support_triage`, a session validator restricted to `support` and `report_listing`, and these four service-only public RPCs:

- `admin_support_triage_read(uuid[])`
- `admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)`
- `admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text)`
- `moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)`

The validator preserves current valid AAL1/AAL2 password-session policy, native session ownership, expiry, ban/deletion and active-role checks. Its two permission maps match all 11 published frontend roles. It changes no credential, role, MFA factor or existing native session-check definition. App clients receive no execute access to these functions, and all three caller roles—including `service_role`—remain unable to directly read or mutate the new private tables.

Triage updates lock the ticket and eligible assignee, reject stale versions, and commit assignment, audit and receipt together. The assignee foreign key uses **`ON DELETE SET NULL`**: deleting a staff identity does not block account cleanup or erase the support ticket. Review moderation retains version checks, private reporting, audit/retry behavior and deleted-target dismissal without recreating reviews.

The read projection adds `support_commands_available`, derived only from the exact central-command signature and its service execute ACL. It never invokes that command. On the current baseline this field is false. No central dispatcher, provisioning, erasure queue, staff governance, finance or music workflow is installed by this candidate.

The migration starts with a new schema creation and will stop atomically if another admin namespace has appeared. It does not overwrite an independently installed broader admin layer. A final PostgREST schema notification is inside the transaction.

## Current-baseline evidence

`supabase/tests/rpc-authorization/test-admin-support-review-chain.mjs` reconstructs the existing 18 production + seven parity units from their reviewed files and SHA256 values. It then applies only the three already-deployed jobs, comment-pin and diagnostics fixes before this candidate.

The local prerequisite catalog is **deep-equal to the fresh live preflight**, including the full native session-check definition and MD5 `ba2e1c694288129ee94d8b6d06746eef`. All nine required relation/column groups are present in production; the private namespace and four target contracts were absent at the read-only checkpoint. The three earlier quality RPCs were present.

The 16 cases cover:

- Exact deployed chain compatibility and unchanged pre-existing public/Auth/storage/finance functions, ACLs, table metadata, policies, storage buckets, music state, roles and user/staff rows.
- Service-only function execution; client-role denial even with forged claims; denied direct table reads/writes.
- Real native-session table checks for AAL1/AAL2, actor/session mismatch, missing/expired/revoked sessions, invalid AAL, inactive staff, banned/deleted accounts and unauthorized roles.
- All current frontend role mappings for the two restored permissions.
- Triage replay, stale data, invalid/inactive assignees, transaction rollback on failed audit, deadlines and bounded read input.
- Actual synthetic Auth-user deletion cascading through `admin_users` while the ticket/triage survive and the owner becomes unassigned.
- Exact-signature/ACL capability detection without invoking a mutating command.
- Stable review-queue pagination, hide/restore visibility and ratings, version conflicts, identical retries, deleted-target dismissal and audit rollback.
- Cross-actor/cross-operation receipt protection and session revalidation on retries.

The test also executes the prepared postflight query and verifies its grants, private table protection, empty search paths, held contracts, unchanged session helper and assignee-delete behavior. Function definition hashes and expected ACLs are preserved in `docs/quality/ADMIN_SUPPORT_REVIEW_GATE_20261029.json`.

Run from the repository root:

```bash
ADMIN_CONTRACT_CATALOG_OUTPUT=/tmp/platinum-admin-support-review-local-catalog.json node supabase/tests/rpc-authorization/test-admin-support-review-chain.mjs > /tmp/platinum-admin-support-review-chain.log 2>&1
```

The runner is also registered in `supabase/tests/rpc-authorization/run-all.mjs`. These are actual cases run directly by Node, rather than an outer single-file test count. Managed Auth/storage objects are local fixtures; the test does not constitute a real hosted staff-session/browser acceptance check or a multi-connection production load test.

## Production-compatible UI backport

The isolated worktree `/workspace/scratch/f1b31bf6880a/platinum-web-security` is on `codex/admin-capability-20261029` at base `a692fbc4`. Its only changed paths are:

- `admin-web/lib/supportTriage.ts`: optional boolean capability field.
- `admin-web/app/support/[tid]/page.tsx`: assignment controls remain tied to triage; reply/status controls require explicit capability `true`. Missing or malformed fields stay unavailable.
- `admin-web/tests/missing-capabilities.cjs`: only the relevant capability cases were backported; unrelated draft deletion/action changes were excluded.

The required availability helper already exists in production source; no additional runtime dependency or framework change is needed. The backport tests cover working assignment with unavailable reply/solve/reopen, legacy/malformed capability fields, positive availability for open and solved tickets, existing read/error/authorization behavior, and absence of mutating probes.

| Backport gate | Result | Receipt |
| --- | --- | --- |
| Direct capability tests | 10 passed, 0 failed/skipped | `/tmp/platinum-admin-capability-backport-tests.log` |
| Standalone admin TypeScript | Exit 0 | `/tmp/platinum-admin-capability-backport-types.log` |
| Admin production build | Exit 0, Next16.4.3 | `/tmp/platinum-admin-capability-backport-build.log` |
| Scoped file/whitespace check | Exactly two UI files plus test; clean | `git diff --name-only` / `git diff --check` |

The full draft admin tree separately passes 13 capability cases and TypeScript. Those 13 overlap the production backport's 10 and should not be added as independent unique coverage.

## Completed rollout order and remaining acceptance

1. **Complete:** published/deployed the admin UI capability backport and verified READY with the production custom domain.
2. **Complete:** repeated `supabase/ops/check-admin-support-review-preflight.sql`; it exactly matched the tested catalog, including the absent namespace/signatures and present prerequisites.
3. **Complete:** applied exactly the reviewed migration and SHA256 above as one transaction.
4. **Complete:** ran `supabase/ops/check-admin-support-review-postflight.sql`; all five hashes match, service execution is true, app-role execution and private-table access are false, the existing session hash is unchanged, and central/provision/deletion RPCs remain absent.
5. **Pending:** verify support assignment and review moderation with an authorized staff session and an intentional disposable acceptance scenario. Message reply/status, provisioning and completed erasure remain outside this repair.

The UI must precede the database migration. The older page equated triage availability with central-command availability and would otherwise reveal reply/solve/reopen controls while that RPC remained missing. A stale page still cannot execute the absent command, but a correctly sequenced rollout prevents the misleading enabled controls in the deployed client.
