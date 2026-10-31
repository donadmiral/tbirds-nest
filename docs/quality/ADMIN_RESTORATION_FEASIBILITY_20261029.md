# Missing admin contracts — restoration feasibility

Date: 29 October 2026. This document preserves the initial read-only feasibility review. Its original catalog observations and proposed next steps below are historical; the subsequent implementation and rollout are recorded here first.

**Current state: the four support/review contracts are applied and verified.** The narrow candidate passed **16 database cases, zero failures and zero skips**, with SHA256 `db5e56166965decc7b9dd873c28b40cfa322e07e909297da03d8a6c10f0dd759`. The production UI backport passed its 10 cases, TypeScript, build and all three GitHub jobs; [PR #5](https://github.com/donadmiral/tbirds-nest/pull/5) merged as `ce4f2f2ebbd7f7669b630caf650fd97cd59297b0`. READY admin deployment `dpl_EtZFdDQDsaZ7V6pifpjSLt3SttCL` preceded live migration `20261029202457` (`platinum_app_quality_admin_support_reviews_20261029`). Fresh preflight matched the tested catalog and postflight matches the exact function definitions and permissions. [Implementation details](ADMIN_SUPPORT_REVIEW_CANDIDATE_20261029.md), [test gate](ADMIN_SUPPORT_REVIEW_GATE_20261029.json) and [live receipt](ADMIN_SUPPORT_REVIEW_POSTFLIGHT_20261029.json) distinguish those facts from pending staff-browser acceptance. Central commands, provisioning and the deletion queue remain absent. The following sections preserve the initial feasibility assessment.

## Initial feasibility conclusion

The four support-triage and seller-review admin contracts can be restored with a small, reviewable database candidate that does not enable music, creator finance, staff provisioning, account deletion, organization changes, or general admin commands. The complete seven-contract restoration is also implementable from existing source, but activates a broader set of operations and requires its associated security guards and Auth integration acceptance.

The older visual release scope is historical context. The current full-app repair request supports preparing these fixes. There is no recorded automatic-review rejection specific to the admin migration in the evidence audited here. The recorded rejections concern music rights and creator finance; this review does not propose either rejected unit.

The concrete next gate is to assemble and test the exact candidate over the current production-equivalent baseline. Existing broad-chain tests do not cover that combination: some use a stubbed validator, and the historical full admin runner expects AAL2 while the current frontend accepts valid password sessions. This is a technical proof gap rather than a request for another blanket permission.

## Production facts at the initial pre-restoration checkpoint

A read-only catalog query against `prlkikhckbifseosbukl` confirms:

- `admin_ops` schema is absent, including `commands`, `provisions`, and `deletion_requests`.
- All seven active missing public RPCs listed below are absent.
- Existing prerequisites `public.admin_audit_log`, `seller_review_reports`, `support_tickets`, `support_messages`, `verification_applications`, `business_applications`, `business_members`, and `org_memberships` are present.
- `public.triniti_admin_session_check(uuid,uuid)` exists. Its inspected definition checks the exact session's ownership, expiry, nondeleted/nonbanned Auth user, active staff membership and the established list of 11 staff roles. It has no AAL requirement.

This confirms the earlier production/parity fixture's absence of the broad admin namespace. It does not prove every column and trigger required by the complete command dispatcher is compatible; those checks belong to the candidate preflight.

## Contract and source map

Paths are relative to the repository root.

| Missing contract | Exact source | Prerequisites / effect |
| --- | --- | --- |
| `admin_seller_review_reports(uuid,uuid,timestamptz,uuid,text)` | `supabase/migrations/20261025073211_marketplace_verified_reviews.sql` | Existing review/report tables; protected session validator with `report_listing`; bounded cursor pagination. |
| `moderate_seller_review(uuid,uuid,uuid,uuid,text,text,integer)` | Same review migration | Review/report tables, private command receipts, admin audit, session permission; version-checked hide/dismiss/restore. |
| `admin_support_triage_read(uuid[])` | `supabase/migrations/20261023191000_support_triage.sql` | New private triage table plus existing support messages/tickets/profiles; up to 100 IDs. Service-only RPC; verified server page performs staff authorization. |
| `admin_support_triage_update(uuid,uuid,uuid,uuid,integer,uuid,text,text,boolean,text)` | Same support migration | New triage table, command receipts and session validator; eligible assignee, version, replay and audit checks. |
| `triniti_platinum_admin_command(uuid,uuid,uuid,text,jsonb)` | `supabase/migrations/20261022211835_admin_command_provision_contracts.sql` | Private receipts/provision/deletion tables; role-checked dispatcher across moderation, verification, support, staff, business, organization and system operations. |
| `triniti_admin_provision(uuid,uuid,uuid,text,jsonb,text)` | Same original admin migration | Private reservation table and indexes, protected session, existing Auth/profile/staff/business/audit tables; reserve/finish protocol around a separate Auth Admin API creation. |
| `triniti_admin_deletion_requests(uuid,uuid,integer)` | Same original admin migration | Private deletion-request table/index, protected session and profiles; super-admin-only paginated queue read, not account erasure. |

## Smallest four-contract candidate

The review schema is already installed by `supabase/migrations/20261029080548_marketplace_purchase_reviews.sql`. The complete old review migration must not be replayed: plain `CREATE` statements for its review policy, report table and indexes would collide, and its customer-facing RPCs are already present.

A new transaction can contain only:

1. The private `admin_ops` schema and restrictive ACLs.
2. `admin_ops.commands`, copied from the beginning of the original admin migration, with its UUID command key, actor, operation, payload, result and timestamp. Enable RLS and deny direct access to `PUBLIC`, `anon`, `authenticated`, and `service_role`.
3. The current-policy `admin_ops.require_session` from `supabase/migrations/20261029074302_admin_optional_authenticator.sql`.
4. The support triage table, RPCs and message-order index from `20261023191000_support_triage.sql`.
5. Only the two missing seller-review admin functions and their ACLs from the old review migration.

This adds two private tables, one shared validator, four public functions and a support-message index. It does not need provisions, deletion requests, removal guards, finance infrastructure or any staff/user data changes. Public functions remain `SECURITY DEFINER` with empty search paths and execute grants only to `service_role`; direct table grants remain closed.

`admin_ops.support_triage` has a cascading ticket foreign key, an assignee foreign key to `admin_users`, priority/queue constraints, escalation, version and update timestamp. Updates validate active eligible staff, reject stale versions and reuse only an identical original command key. Review moderation likewise locks the report/review, checks content version and commits the mutation, audit entry and replay receipt together. These protections should be preserved rather than replacing missing RPCs with direct table writes.

### Session policy must match the current app

The original 22 October validator requires AAL2. The current frontend's `adminAssurance.ts` accepts valid AAL1/AAL2 staff sessions; the later optional-authenticator validator is the matching source. It retains the native session check, rechecks expiry/ban/deletion, locks the session/user/staff rows and applies the existing per-operation permissions.

For these four contracts, `support` permits `super_admin`, `platform_admin`, `trust_safety`, and `support_agent`; `report_listing` permits `super_admin`, `platform_admin`, `trust_safety`, and `market_reviewer`. These sets exactly match `admin-web/lib/permissions.ts`. Installing this helper changes no staff role, credential, MFA factor, or existing session-check function. Restored operations become available to their established roles.

Do not include `20261025073213_single_owner_qa_access.sql`. Its separate QA policy, governance triggers and replacement of a creator-finance validator are unnecessary here.

### Support UI coupling needs a small accompanying fix

`admin-web/app/support/[tid]/page.tsx` currently uses triage availability to reveal both assignment controls and Send reply/Mark solved/Reopen forms. The latter operations go through `admin-web/lib/actions.ts` and `adminCommand.ts` to the still-missing central command RPC.

Restoring the four contracts alone would therefore expose some working assignment controls alongside reply/status actions that remain unavailable. Separate those capability checks and add the mixed state to `admin-web/tests/missing-capabilities.cjs`: triage available, central command unavailable. An alternative is a deliberately restricted central command implementation for just `resolveTicket`, `setTicketStatus`, and `sendTicketReply`, retaining session, role, payload, receipt and audit protection. That would restore support messaging/status without enabling every central admin operation.

## Completing the broader three contracts

### Central admin command

The complete dispatcher references the existing public relations `admin_audit_log`, `admin_users`, `announcements`, `blocked_words`, `business_applications`, `business_members`, `feature_flags`, `listing_reports`, `marketplace_listings`, `member_strikes`, `org_audit_log`, `org_delegations`, `org_memberships`, `organizations`, `post_comments`, `post_reports`, `posts`, `profiles`, `stories`, `studio_campaigns`, `support_messages`, `support_tickets`, `user_reports`, and `verification_applications`, as well as Auth sessions/users and the three private tables.

Its source does not operate on music or creator-finance tables. Campaign approval expressly changes review state without manufacturing payment evidence. However, the full dispatcher also enables staff governance, content removal, account restrictions, verification grants, organization ownership changes and system settings. Its existing action-role matrix must be retained, including super-admin-only governance and protection of the last super-admin.

Three additional components are necessary to assess full readiness:

- **Persistent removal:** `20261023190316_admin_moderation_removal_guards.sql` records audited removals in `admin_ops.removals` and prevents owners from restoring removed listings or reusing removed IDs. Omitting this would leave moderation reversible by the content owner even if the central function compiles.
- **Comment-trigger compatibility:** the original admin file replaces `update_comment_count`, `sync_post_comment_count`, and `sync_post_comments_count` with schema-qualified versions for the dispatcher's empty search path. Compare fresh live definitions before selecting any replacement; do not overwrite later fixes from a historical snapshot.
- **Verification integrity:** `20261025073232_verification_integrity.sql` protects profile verification fields, validates evidence and decision reasons, maintains revocation state and applicant evidence access. The full workflow tests include these protections. They are unnecessary for the small triage/review candidate, but should accompany enabled verification decisions.

The original complete admin file can be used as a source, but a new consolidated candidate should match current schema and session policy and should omit unrelated historical units. A successful local test loading every old migration is insufficient deployment proof.

### Provisioning

Provisioning needs `admin_ops.provisions`, its `snapshot` column and unique email/desired-username indexes. Only existing `super_admin` permissions `staff_manage` and `business_manage` may use it.

The SQL reserves an exact new Auth ID and later validates that ID, normalized email and trusted `triniti_provision_id` metadata before completing. `admin-web/lib/adminProvision.ts` performs the actual `svc.auth.admin.createUser` call between phases, safely checks a concurrent or partially completed identity and never adopts an unrelated existing account. Staff completion installs the requested established role. Business completion assigns delegated ownership and disables direct sign-in for the generated business identity.

There is no music/finance dependency. The genuine external acceptance step is the Auth-provider reserve/create/finish path with an intentionally disposable authorized account, including interruption and retry. Existing tests mock the provider. No real staff identity should be created merely to turn a compile check green.

The current frontend's `ACTIVE_ADMIN_SESSION_REQUIRED` copy still asks the user to complete two-factor verification. If this workflow is restored under the current optional-authenticator policy, align that error text with valid-session recovery.

### Deletion queue

The queue reader requires only its private table/index, the `account_delete` permission and existing profiles. It does not delete data. The corresponding central command revokes sign-in access, removes native sessions and enters `retention_review`; it deliberately keeps the Auth identity and financial history. Enabling the reader must not be presented as completed erasure or a retention processor.

## Existing evidence and required candidate tests

| Existing check | Recorded result / useful behavior | Remaining limitation |
| --- | --- | --- |
| `supabase/tests/marketplace-reviews-db.test.cjs` | 10/10 pass in the final DB gate; report privacy, staff ACLs, visibility, aggregates, audit/replay, deleted targets and stale versions. | Session validator is stubbed; not the exact production-derived candidate. |
| `supabase/tests/support-triage-db.test.cjs` | 3/3 pass; audited replay, conflicting/stale edits, assignees, deadlines and denied client reads. | Simplified fixture and stubbed validator. |
| `supabase/tests/rpc-authorization/test-admin-commands.mjs` | 22 passing custom groups; real ACL/role checks, replay, rollback, removal guards, support, provisioning, organization and deletion-request behavior. | Loads the historical broad chain and explicitly expects AAL1 rejection. |
| `supabase/tests/rpc-authorization/test-verification-integrity.mjs` | 8 passing custom scenarios; private evidence, safe approvals, revocation, profile and report integrity. | Historical prerequisites rather than the proposed extracted candidate. |
| `admin-web/tests/admin-assurance.cjs` | Current frontend session/AAL policy and authorization checks. | Does not execute the SQL validator. |
| `admin-web/tests/command-contracts.cjs` | 13/13 pass; payloads, identity/retry and unavailable behavior. | Auth creation is mocked. |
| `admin-web/tests/missing-capabilities.cjs` | 11/11 pass; actual page/action availability handling and authorization. | Needs the triage-present/central-command-absent support state. |

Prepare one targeted PGlite candidate-chain gate on the existing production + parity + three narrow quality migrations. Use the real current-policy session validator. Cover AAL1 and AAL2, wrong actor/session, expiry/revocation, banned/deleted/inactive users, both action-role maps, exact service-only grants, audit rollback, identical replay, stale versions, and unchanged unrelated finance/music/storage/staff-role state. For a full dispatcher candidate, add its relevant operation and guard cases; for provisioning, retain the separate Auth-provider acceptance step.

After that proof and an exact catalog/definition preflight, the release owner can decide the scoped apply. No production migration was prepared or applied during this feasibility review.

## Reporting correction

`supabase/ops/parity-rollout-20261029.json` still contains historical exclusion text describing the broad admin system as rejected by automatic review. That string is not an exact recorded rejection action/reason. The current RPC audit corrects the distinction: admin was excluded/undeployed; recorded automatic-review rejections were the music-rights and creator-finance units. Preserve that distinction in release reporting.
