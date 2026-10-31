# Studio workflows, access governance, and business Auth

Date: 2026-10-30. Repository: `codex/app-quality-20261029`.

## Status

Three reviewed migrations are installed on the isolated QA backend `uaulhuelcfkjwojtymmw`. They provide persisted newsroom and creator-partnership workflows, repair shared-business member governance, reserve public web routes against username collisions, and reject a reserved business handle before provisioning creates an Auth identity.

The additional business-session migration and eight related Edge entrypoints are implemented and locally verified. They have **passed independent review and received QA-only application/deployment approval**. The hosted migration connector stalled on both authorized attempts without returning success, error, or approval rejection. The final read at 04:42:50 UTC confirms that the new schema and owner-access contract are absent, the latest migration is still `20261030033815`, and no matching migration transaction or waiting lock exists. No Edge deployment was started. The new provider path remains source-ready and **not installed on QA**; it has not been exercised against hosted Auth.

Production `prlkikhckbifseosbukl` was not changed. TestFlight remains on hold. No live account was created, erased, renamed, or unbanned by this work.

## Installed QA migrations

| Source migration | SHA-256 | Actual hosted QA version |
|---|---|---|
| `20261030024125_studio_editorial_and_partnership_workflows.sql` | `74fb83e842c349a49ec28c9b1181ced33e855432b1c1e614c0d2d8d5a278ff4c` | `20261030032512` |
| `20261030031124_reserve_web_route_usernames.sql` | `625fd871ff4a6a83938086d78b47e482ee0a492ec1dee54310cb56eacc14248c` | `20261030032528` |
| `20261030033214_reserve_business_provision_usernames.sql` | `57313ea2c22c90d28f62933c757e178b93cae31958b557ada792429e4a690260` | `20261030033815` |

Receipts are in `docs/quality/studio-workflows-20261030/qa-applied-evidence.json`, `qa-business-route-guard-applied.json`, and `qa-advisor-delta.json`. Each installation followed an exact source-hash check, read-only preflight, root review, and QA-only approval. Actual function-definition hashes, grants, trigger state, private tables, and preserved aggregate counts were checked afterward.

The main Studio migration has **35 new or replaced functions**: 21 public authenticated APIs and 14 private helpers. All use an empty `search_path` and a controlled owner. Six internal tables—newsroom assignments, partnerships, deliverable versions, events, idempotent commands, and access events—have RLS enabled with no app policies or raw client/service grants. The public functions derive the caller from the actual Auth session and bound member.

Postflight retained the existing QA Auth user, profile, staff record, 13 Auth sessions, 15 Storage objects, and bucket settings. The new workflow tables remained empty. Five media buckets remained private on QA. Production privacy was not changed.

## Newsroom contracts

The newsroom is persisted work rather than a client-only list. An assignment links to the actual scheduled-post record, records an assignee, a brief, rights owner, territory, rights expiry, embargo, requested publication time, sponsor, and disclosure requirement. The detail API returns the linked creative directly, including a draft outside the latest 100 planner items.

An editor can prepare and submit an assignment. An independent owner or administrator must review it. Submission records the exact creative hash; changing its caption or media requires withdrawing or requesting changes first. Approval and scheduling check the same draft, version, rights, expiry, disclosure, and embargo. Scheduling updates the real publishing queue. The normal publisher also checks the newsroom approval, so Planner and immediate-publish APIs cannot bypass it.

Team review is separate from platform advertising review. These contracts do not activate advertisements, charge an account, or imply platform approval. Paid partnership disclosure is required in the actual published text because the present post schema has no dedicated public sponsorship badge field.

Writes carry the expected Auth user, a request UUID, and an expected record version. Repeating the same committed request returns its recorded result; reusing the key with different input fails. Stale versions, foreign assignees, foreign drafts, invalid rights, missing disclosure, self-approval, and unscheduled publication are rejected. Audit events remain attached to the work.

## Creator partnerships and consent

Partnerships name a real personal creator account. The business can prepare and propose a brief; the creator can accept or decline, submit a version, revise it after feedback, or withdraw a submission. Business review records an outcome and note against that version.

Publishing permission and permission for paid promotion are independent creator decisions. Both are scoped to the approved deliverable, expire, and can be revoked. Source changes invalidate effective permission even when a prior consent record remains visible for audit and explicit revocation. The source hash includes current post text and presentation fields, `post_media.edit` framing/color/audio/cover state, alternate text, sensitivity, legacy media locations, article revision, poll, products, and tags that exist in the inspected schema.

Recorded fees are brief terms. This implementation does not execute payments, move earnings, activate ads, or automatically publish a creator's content. The UI separates recorded consent from currently effective consent and reads full deliverable/history details before enabling review.

## Shared-business member governance

Raw app access to access-member hashes, device registrations, sign-in logs, and session-to-member bindings was removed. Member, role, device, and code operations use the protected RPCs. First-owner setup is explicit; subsequent member creation defaults to editor. Strong random codes replace the older short-code scheme. Existing codes are never exposed by list APIs.

Changes enforce actual bound roles, the last-owner rule, tenant ownership, current Auth session, and account-erasure admission. They serialize with the shared-business access lock. `studio_bind_member` uses an update lock while updating sign-in state to avoid the previous share-to-update lock upgrade. The native Business Access and Studio settings clients were migrated to the protected APIs, with account-change fencing and failure/retry states.

Older installed clients that use direct business tables are incompatible with these restrictions. Production adoption needs an intentional client rollout and authenticated native/browser checks. QA installation does not waive that gate.

## Reserved web routes and provisioning

The route migration reserves 34 actual static web roots, including `/watch`, through both username availability and database insert/changed-username enforcement. A collision aborts installation. Unchanged legacy handles are preserved; no account is renamed. Read-only checks found no current collisions on QA or production.

The third migration adds the same reservation check to the actual admin business-provision reserve phase, before an Auth identity can be created. It also rejects a pending legacy reservation with a newly reserved handle rather than silently proceeding. The actual `triniti_admin_provision` definition changed from MD5 `def6cbc9557e3ec5fa22ce85b003a291` to `69d07d257bb8a9c59ae27d7a4e8e79cd`, with service-only execution and empty search path preserved. Pending reservations remained zero on QA.

## New business Auth candidate

Candidate: `supabase/migrations/20261030034752_business_bound_auth_sessions.sql`.

SHA-256: `66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996`.

The reviewed baseline exposed a concrete gap: the repository's owner-launch/sign-in clients depended on missing SQL contracts, while the deployed older sign-in function automatically approved unfamiliar devices and did not enforce the seat's active flag. Merely publishing the newer client would not repair this.

The candidate adds seven private tables: a business identity registry, verified owner-seat mappings, device proof hashes, two-minute sign-in grants, bound Auth sessions, bounded rate-limit counters, and access events. No app or service role can read these tables directly. Four service-only provider contracts prepare owner/code access, finish a real Auth-session binding, and revoke an incomplete exchange.

The business identity registry retains the UUID classification if a profile is removed or reclassified. A stale business JWT cannot become an unrestricted personal JWT through a profile change.

### Owner and member entry

Owner launch checks the current personal Auth user/session, current business ownership, active profile, moderation state, and erasure state. It accepts either an approved provisioned application or an exact business ID with actual current ownership. An owner confirms the creation of their owner seat and first device; no hidden code or raw magic-link capability is delivered to the client. An established owner's new device remains pending.

Member sign-in validates the active seat's code hash, device ID, and separately stored 256-bit device proof. A valid code on an unknown device creates a pending registration. Knowledge of a device ID alone cannot take over an approved registration. A removed device stays blocked until an authorized owner/administrator explicitly approves it again. Legacy registrations without a proof fail closed.

Both paths create a short-lived, single-use grant. The Edge handler then generates and exchanges the Auth magic link on the server using a separate anonymous Auth client. It verifies the issued business user and actual session ID, finishes the member/device binding, and only then returns the access token and refresh token. It never returns a `token_hash`, email address, or service credential.

The session lasts at most 24 hours and cannot outlive its dependent personal owner session. Code rotation, seat removal, device removal, ownership loss, and personal-session deletion revoke the affected actual Auth sessions and bindings. A same-session finish retry is idempotent; another session, expired grant, wrong proof, or wrong business fails. Failed/cancelled exchanges attempt both bounded SQL cleanup and Auth revocation.

Ownership transfer revokes the former owner's mapped seat and sessions. The new verified owner can create a mapped seat, but an unfamiliar device still requires approval after the original business bootstrap. If no authorized owner/admin device remains, an intentional operator recovery process is needed. The implementation does not silently reactivate a removed device, disabled seat, or banned business.

### Protection after sign-in

The Data API pre-request hook and restrictive authenticated policies apply one current-session predicate to the existing exposed RLS tables. The fresh QA preflight identified 193 such tables and zero app-accessible unprotected tables in the target schemas. The helper derives business identity from authoritative profile/registry data and verifies actual Auth/member/device/owner state. Editable JWT metadata does not confer a role. Anonymous, ordinary personal, and staff behavior retains the existing policies.

Privileged Edge handlers need an additional boundary because their service clients use no caller `auth.uid()`. A shared guard forwards the actual caller Authorization header to the protected predicate before service/provider work. It wraps `daily-get-token`, `crisp-bridge`, `link-preview` POST, `apple-music`, `replicate-proxy`, and `create-business`. Daily checks again before and after token issuance. Public verified link-preview image GET requests remain public by their existing token contract.

Content/chat media and data-export APIs authorize through caller-JWT RPCs, which pass through the Data API hook. Opaque media redemption already requires the actual Auth session and object version; it now also checks the current business member/owner binding on each redemption. Worker functions keep their separate service/Vault credentials. No IntoBank provider configuration or payment workflow was changed; the Platinum bridge's entry authorization is the only change on that path.

This does not revoke a file already downloaded by a legitimate user or retroactively remove a previously issued Storage signed URL. Private delivery, limited views, cached copies, and CDN expiry remain separate acceptance checks. Production public buckets remain a blocker.

### New candidate preflight and deployment gate

`business-auth-qa-preflight.json` records a fresh read-only QA inspection: six exact function hashes/ACLs/empty search paths match; no existing request hook; the authenticator role, Auth timestamp, digest, and random-byte functions exist; zero unbound business sessions; zero business profiles, access members, devices, Studio bindings, or pending provisions. Existing counts remain Auth 1, profile 1, staff 1, sessions 13, Storage objects 15. The five inspected QA media buckets remain private.

The migration aborts if an existing custom pre-request hook needs integration, a guarded baseline function drifts, an app-accessible table lacks RLS, or already-issued business sessions require a coordinated client cutover. It never unbans an existing business. The future business provisioning finish stops adding the obsolete unconditional Auth ban because the newly created identity is protected by the bound-session path; existing banned identities remain unchanged.

Independent review accepted the exact `business-auth-candidate.json` SQL and both `check-business-bound-auth-*.sql` scripts. The bounded-fetch follow-up preserves request and SDK cancellation, caps each network call at eight seconds, and gives compensating revocation its own bounded client even after request cancellation. These changes passed the Edge tests and all eight entrypoint typechecks before the authorized attempts. All eight changed entrypoints use the same pinned Supabase SDK `2.112.3`, already used by the project's active media handlers. Both business entrypoints authenticate explicitly inside the handler and require `verify_jwt=false`; owner requests still require a provider-verified personal user/session.

## Verification receipts

| Verification | Result | Evidence |
|---|---|---|
| Main three migrations, production-shaped local chain | 41/41 | `production-shaped-gate.json` |
| Main three migrations, inspected QA-forward local chain | 41/41 | `qa-shaped-gate.json` |
| New business Auth, production-shaped local chain | 27/27 | `business-auth-production-gate.json` |
| New business Auth, inspected QA-forward local chain | 27/27 | `business-auth-qa-gate.json` |
| Edge issuance, abort/failure cleanup, network deadlines, and privileged-entry guard | 21/21 | `supabase/tests/business-session.test.cjs` and candidate manifest |
| Actual Daily entrypoint authorization and mid-issuance revocation | 24/24 | `tests/daily-call-access.test.cjs` and candidate manifest |
| Eight changed Edge entrypoints | Deno typecheck passed | Candidate manifest |

The integrated 296-case Supabase Node run predates the final bounded-fetch delta and contained the earlier 18-case business-session test file. The later targeted run passed all 21 cases in that updated file; it includes the earlier cases plus three deadline/cancellation checks. These counts must not be added as distinct tests or described as a full-suite rerun. `business-auth-edge-delta.json` records exact final source hashes, the original 21-case log, and the observed successful eight-entrypoint Deno result with its provenance. This receipt was preserved without rerunning tests or mutating hosted state.

The SQL tests execute the actual reserve/create/finish contract with a synthetic Auth Admin confirmation inside an isolated local database. They cover live seat/session checks, device approval, wrong proof, stale grant, one-use retry, expiry, role binding, code rotation, owner transfer, direct RLS denial, media redemption, and preservation of existing rows. This is intentionally separate from hosted Auth and real-device evidence. The fixture's refresh test verifies that the same Auth session ID retains its binding; an actual hosted refresh exchange remains a provider acceptance check.

The local concurrency evidence establishes lock order and admission behavior; the single-process SQL fixture is not a multi-connection load test. The deployment preflight is not a completed owner/member browser walkthrough. Native and web client compatibility changes have their own focused tests and final typechecks in the professional UI lane.

## Hosted connector blocker and final freeze

The first authorized `apply_migration` call never returned a result and was interrupted with `aborted by user after 1255.8s`. Recovery reads showed no schema, contract, migration, or matching active transaction. After a fresh exact-hash/preflight/transaction check, one retry yielded a running cell; its wait requested 1,000 ms but also stalled and was interrupted after 213.1 seconds. Neither attempt returned an automatic approval rejection. This is recorded as a connector stall, without inferring the internal cause.

No third apply was attempted, and no alternate mutation mechanism was used. Final read-only evidence at 2026-10-30 04:42:50 UTC confirms Auth users 1, profiles 1, staff 1, Auth sessions 13, Storage objects 15, business profiles 0, access members 0, devices 0, Studio bindings 0, pending provisions 0, no `business_auth` schema, no owner-access contract, and no matching active/idle migration transaction. The three earlier migrations remain installed. The eight new Edge deployments have not started.

The exact tool outcomes and final aggregate state are in `business-auth-qa-connector-blocker.json`. Restoring connector availability and completing the reviewed QA migration plus eight-function deployment remains a release gate. Resume only after checking actual state again; never infer completion from the source tests or retry a migration that has appeared in the hosted history.

The web/native owner entry now reuses the existing inspected `get_my_businesses()` contract, a stable SQL invoker function filtered by `m.member_id = auth.uid()`. Owner cards call the reviewed owner endpoint with `business_id`; the endpoint rechecks real ownership. This supports transferred or directly created owners without inventing a raw-membership grant. New-device approval and banned-account restrictions still apply. Focused final client checks reported 48/48 native and 52/52 web with both typechecks passing; full integrated gate results are tracked in the overall completion report.

## Advisor interpretation and remaining acceptance

For the first Studio installation, intentionally private RLS-without-policy findings increased from 80 to 86, anonymous security-definer execution warnings decreased from 137 to 135, and authenticated security-definer execution warnings increased from 324 to 335 because of the protected APIs. The leaked-password protection warning remained one. These advisor counts describe findings to review; they are not counts of demonstrated exploits. The source and postflight verify each new function's grants, identity checks, and search path.

Production media privacy and installed-client compatibility still need a coordinated cutover and real unauthorized-URL, expiry/revocation, and warmed-cache tests. Complete ordinary-account Storage/CDN/Auth erasure still needs an authorized disposable ordinary identity and real worker verification. Staff and managed-business identities intentionally enter retention review; they cannot be used to bypass that hold for an erasure demonstration.

Leaked-password protection remains disabled on the inspected provider configuration. The connected database tools do not expose that Auth setting. Supabase documents its provider-side setting and availability at <https://supabase.com/docs/guides/auth/password-security>. Auth Admin create-user behavior is documented at <https://supabase.com/docs/reference/javascript/auth-admin-createuser>; Storage CDN behavior at <https://supabase.com/docs/guides/storage/cdn/smart-cdn>.

Physical iPhone media failures, camera/HEIC/HDR, export to Photos, gestures, interruptions, calls, push, offline recovery, accessibility, and real external-provider behavior remain separate acceptance work. This report does not claim those checks passed.
