# Media privacy and account-file erasure — release candidate evidence

Date: 2026-10-29. Scope: the native/web/shared media clients, account deletion, Storage policy compatibility, private byte handlers, and associated SQL. The admin interface and its same-origin moderation byte route are covered by the separate admin report.

## Result and limits

The source implementation and focused local gates are complete for this lane: **146 cases passed, zero failed**, and both native and web TypeScript checks passed. The production-shaped and QA-shaped combined database chains each passed 18 behavior cases. The QA chain preserves all synthetic counterparts of the existing 1 Auth user, 1 staff record, 1 profile, and 15 Storage objects, including their complete row values and bucket settings.

These are isolated PostgreSQL and mocked HTTP/client checks. They do not establish physical iPhone acceptance, successful execution of an actual deletion request, or an entire-app zero-defect claim. This lane made no hosted mutations, commits, native distribution builds, or TestFlight actions. The release owner separately reported that all three QA migrations were applied, all five Edge bundles became active with byte-identical source readback, and hosted function hashes/ACLs matched the expected catalog by signature. Hosted counts remained 1/1/1/15, all five buckets remained private, zero application tables were unfenced, and the queue remained empty. A subsequent update confirmed a configured healthy worker and seven passing negative HTTP checks. These hosted rollout facts are separate from the local expected-catalog artifacts; actual erasure, authenticated successful delivery, warmed-cache invalidation, and device acceptance remain distinct work.

The intermediate claim that the production manifest needed a creator-entitlement hotfix was incorrect. The deployed production manifest already has the earlier repair. QA legitimately has its own existing entitlement helper and sound-rights wrapper. **No entitlement hotfix is needed, retained, or included in the apply order.** The local QA fixture now reconstructs the inspected helper and its empty structural table dependency. It does not activate held finance/music migrations, insert rights or finance rows, or alter provider settings.

## What the implementation changes

### Account deletion removes bytes before identity

`account_erasure` is a private, RLS-enabled queue with no direct app or service-role table privileges. Requests require a real current Auth session, a nonanonymous identity, and a recently healthy worker. Acceptance is idempotent, disables the account, revokes its sessions, and fences application writes made with an already issued JWT. Storage writes also check the real owner and reserved paths.

The worker accepts only its dedicated `pc_erase_` credential. It never accepts an app JWT or the service key as its caller credential, and the caller cannot choose an account or object path. A five-minute lease and current object ID/version checks fence stale workers. Each invocation processes at most 25 objects, with at most five Storage deletion requests in parallel. Storage bytes are deleted through the Storage API; there is no metadata-only `DELETE storage.objects` shortcut.

The database independently acknowledges object absence, rechecks ownership and retention conditions, then waits 65 seconds for Storage CDN invalidation before application cleanup and final Auth Admin deletion. API failure, lease loss, or lost responses remain retryable. Successful Auth deletion is independently checked before the job becomes complete.

Unknown ownership, shared or managed accounts, staff authority, financial records, and other ambiguous dependencies enter `retention_review`. They are deliberately not marked complete. The authorized admin deletion queue now shows these cases without exposing receipt tokens or file paths; this candidate does not add an approval or retention-bypass action. An operational review process remains necessary for those cases.

Native and web clients persist a scoped request receipt before sending the request. They can recover a lost response and read minimal status after sign-out or final Auth deletion. Completed technical receipts expire after 30 days. The old deletion RPC now explicitly refuses with an updated-client requirement, so an old installed build cannot report successful complete erasure through the previous records-only flow.

### Media delivery rechecks current permission

New clients opt into bounded, no-store delivery. Ordinary post, story, upload, and chat media use opaque five-minute capabilities tied to the issuing real user/session and exact object ID/version/owner. The resolver rechecks the current audience or chat membership, account/session state, and object provenance on every request. A block, revoked session, content removal, or object replacement invalidates the previous capability.

An ordinary capability is still a short-lived **bearer capability**: a person holding a valid URL can use it while its issuing authority remains valid. It is not end-to-end encryption and does not establish that every copied valid URL is unusable. Limited-view media and admin moderation bytes use actual authenticated requester checks in addition to their per-request authorization.

Limited-view media retains the existing view counter and deadline. An additional private proof binds the grant to the real Auth session and immutable object version. Reads do not consume another view. A second session, explicit close, expired grant, removed session, or replacement object cannot reuse the original grant. The client synchronously hides content and aborts/revokes pending work during close or account switching.

The byte handlers pin requests to the configured project origin, use authenticated Storage endpoints, reject redirects and active HTML/SVG responses, and apply no-store browser/CDN headers. A fresh documented `cacheNonce` avoids serving an earlier cache entry after a trusted version change. Authorization and version are checked before and after the upstream fetch. Single byte ranges work for seeking; reversed, multiple, empty, and zero-suffix ranges fail before Storage. Upstream 416 remains 416, a missing object is 410, and cancellation propagates to pending and streaming downloads.

Native private images avoid persistent disk caching. Group avatars now use the same bounded object-delivery RPC, with current membership authorization and stale-account-response rejection. Existing CV readers retain their already reviewed private signed-URL contract. Older media clients retain the existing signed-URL contract during staged migration; new clients do not fall back to signed or public delivery when bounded delivery is unavailable.

### Storage compatibility and admin object proof

The compatibility candidate removes only the obsolete public-bucket prerequisite from approved legacy read snapshots. Exact parent, author, publication, object, and version checks remain. Restrictive Storage policies prevent anonymous reads, unowned uploads, overwrites, client deletion, and reuse of a limited-view object as an ordinary message, group/channel avatar, or CV reference. This candidate does not change bucket visibility.

The service-only admin helpers accept the trusted configured origin as an explicit final argument:

- `admin_bound_content_media_object(text, uuid, text, text, text)` returns the current `{object_id, object_version}` or null.
- `admin_bound_content_media_manifest(text, uuid[], text)` returns a sorted array of `{entity_id, bucket_id, object_path}`.

Both require a current canonical post/story reference and either a binding whose uploader matches the actual object owner or an exact approved immutable legacy snapshot. Foreign-host substitutions, stale bindings, changed documents, revoked snapshots, traversal, and encoded-path ambiguity fail closed. Literal spaces and Unicode paths are supported. The manifest accepts at most 200 input IDs and throws explicitly above 4,000 distinct references instead of silently returning partial media. The admin route independently checks current staff authorization before and after fetching bytes; these helpers alone do not authorize a staff user.

## Reviewed database artifacts

| Candidate | SHA-256 |
|---|---|
| `20261029224812_account_storage_erasure.sql` | `be2aaa4a1804e35aea4fd0b0543a4a08afa87a3b7e682728f60c12e4ed573bb1` |
| `20261029224813_private_media_cutover_compatibility.sql` | `e95b6958699507679692dc59106cebafbb6001b25048bcd32ca1d50928e8e5d8` |
| `20261029231321_account_erasure_admin_review_queue.sql` | `33eccb5845c22caa16aeaeb5a05690667f02abcc4d9ea9ae6253896264e35012` |
| `20261029231440_bounded_media_delivery.sql` | `44c6f9d4cbcf858fdbc6a4c50a27bbc5f871347e8dfc45dc97825f52e9e82982` |
| QA-only `20261029233915_qa_media_completion_forward.sql` | `7cf263362002f01f5db989bf9fa63682de8e05d2460319c30f6cd49b312ebf81` |

All SQL candidates are frozen at these hashes. The QA adapter is generated by `scripts/quality/build-qa-media-candidate.cjs` from the unchanged compatibility and bounded-delivery candidates. It exact-checks the inspected QA media catalog: 11 function definitions/ACLs, 22 Storage policies, 3 triggers, bucket visibility, absent new schemas, and 1/1/1/15 row counts. It replaces only the seven conflicting older chat policies and three reference triggers within its transaction. It preserves the unrelated `platinum_*` policies and every account/Storage row.

The erasure candidate also exact-checks `delete_user_account(uuid)` against deployed MD5 `2216cc828cb339debeeed40865d72d78` before cloning its application cleanup without direct Auth deletion. A mismatch must stop the rollout for review; do not relax this guard to make a migration pass.

### Correct QA order

Prerequisite: the separately reviewed QA admin forward is already installed. Then apply exactly:

1. `supabase/ops/qa/20261029233915_qa_media_completion_forward.sql`
2. `supabase/migrations/20261029224812_account_storage_erasure.sql`
3. `supabase/migrations/20261029231321_account_erasure_admin_review_queue.sql`

The adapter contains the compatibility and bounded-delivery SQL; do not apply those two production files a second time on QA. Apply the adapter before the later database-hardening projection, because the latter intentionally changes media reader definitions checked by the adapter. There is no fourth entitlement step and no reset of the existing QA project.

Run `supabase/ops/check-qa-media-completion-preflight.sql` immediately before applying. After all three steps and before later hardening, run `supabase/ops/check-media-completion-postflight.sql` and compare its `catalog` entries with `docs/quality/QA_MEDIA_COMPLETION_EXPECTED_20261029.json`. Normalize array order by ordinal key comparison before the deep comparison: functions by signature, policies by name, private tables by schema/table, triggers by table/name, and schemas by name. Hosted PostgreSQL and PGlite collations can order underscores and dots differently; an array-order difference alone is not catalog drift. Definitions, hashes, ACLs, policy expressions, trigger values, and membership must still match exactly. The expected catalog contains 44 functions, 14 policies, and 6 private tables. The production-shaped expectation contains 41 functions, reflecting its different existing reader baseline.

These expected files are generated locally by `supabase/tests/rpc-authorization/capture-media-completion-postflight.mjs` with and without `--qa`. They are not hosted postflight claims. The QA reconstruction additionally deep-compares all preserved account/session/profile/staff/Storage rows and bucket values before and after the forward upgrade. Compare hosted counts to the fresh hosted preflight, not the production fixture's synthetic counts.

## Edge deployment and worker health

Deploy all five functions with `verify_jwt=false`, which is explicitly recorded in `supabase/config.toml`. Each handler performs its own protocol-specific authentication; this setting is not permission to bypass those checks.

| Function | Files required in the deploy bundle |
|---|---|
| `account-storage-erasure` | Its `index.ts` and `handler.ts` |
| `media-content` | Its `index.ts` and `handler.ts` |
| `limited-media-file` | Its `index.ts` plus `private-media-session/handler.ts` |
| `content-media-sign` | Its `index.ts`, `handler.ts`, and `shared/contentMedia.ts`, `shared/mediaDelivery.ts` |
| `chat-media-sign` | Its `index.ts` and `shared/mediaDelivery.ts` |

The standard Supabase URL, anonymous key, and service-role key are provided through the platform environment. Do not put service credentials in a client or source artifact. Retrieve deployed files and function metadata afterward and compare them to the per-file SHA-256 values in `MEDIA_PRIVACY_ERASURE_GATE_20261029.json`; verify the actual `verify_jwt` settings and inclusion of relative shared imports.

For the worker, run `setup-account-erasure-credential.sql`, set the exact project URL in Vault as `account_erasure_project_url`, then run `install-account-erasure-cron.sql`. The scoped plaintext credential is generated and kept in Vault; only its digest is in the private worker record. The minute cron job reads Vault internally and does not embed credentials in its command text or return them to a client.

Before configuration, the expected worker is unconfigured and unseen, and deletion requests are unavailable. After a correctly authenticated empty tick, expect HTTP 200 with `{processed: 0, completed: false}`, a recent heartbeat, `workerHealthy=true`, an empty queue, and `unfencedApplicationTables=0`. All six private tables must have RLS enabled and no direct anon/authenticated/service-role table grants. Missing/wrong credentials must return 401; GET must return 405. Use `check-account-erasure-health.sql` for redacted ongoing monitoring. A heartbeat confirms the worker path, not successful erasure of actual Storage bytes.

## Verification recorded

| Gate | Passed |
|---|---:|
| Account erasure over deployed migration chain | 11 |
| Private cutover compatibility chain | 14 |
| Production-shaped combined admin/erasure/privacy/queue chain | 18 |
| Exact QA-shaped forward chain with preserved existing-state fixtures | 18 |
| Worker and account-receipt HTTP/client contracts | 10 |
| Limited-view session/byte handler | 10 |
| Bounded byte delivery and legacy signer compatibility | 13 |
| Group avatar and existing CV reader compatibility | 4 |
| Native/web chat cache, account switching, stale-response and partial-failure regressions | 32 |
| Content parsing, authorization, hydration and owner-upload regressions | 16 |
| **Focused cases** | **146** |

Native `npx tsc --noEmit`, web `npx tsc --noEmit`, and `git diff --check` passed. The machine-readable gate retains command names, complete focused-test output, counts, and source hashes. Local postflight reconstruction also passed for both baselines. These checks cover forged capabilities, session revocation, owner/version changes, authorization during in-flight reads, invalid ranges, cancellation, replayed leases, lost deletion responses, financial/staff review cases, manifest caps, and preserving old-client contracts.

The release-wide run exposed two stale test harness contracts: the chat-cache harness did not load the newly imported shared media-delivery module, and the owner-upload assertion omitted the explicit `delivery: 'no-store'` request flag. The harness now loads the actual helper, the request assertion verifies the no-store contract, and the owner-upload fixture returns an actual bounded capability. All original cache/account-switch/security assertions remain in place. Both targeted suites passed after these test-only updates; no app, Edge, or SQL change was needed for those failures.

## Hosted and device acceptance still required

The last read-only production baseline in this lane had 472 Storage objects, including 21 null-owner objects, and 10 approved legacy read snapshots. All five target media buckets were public; `account_erasure` and `media_delivery` were absent. QA had 1 Auth user, 1 staff record, 1 profile, 15 objects, and five already-private media buckets. These are observed baseline facts, not claims about later rollout state. Null ownership is not inferred permission to delete or serve a file.

The production visibility flip remains a separate held operation in `activate-private-media.sql`. Before activating it, record real provider checks using disposable QA fixtures while preserving existing QA accounts and files: unauthorized canonical URLs, previously warmed URLs, expired/revoked capabilities, signed URLs issued by older clients, range/seek behavior, stream cancellation, and cache invalidation after deletion. Verify the exact new web/native/admin clients and the currently installed older iPhone build against the staged contracts. The activation script requires reviewed QA and client-evidence hashes plus zero readiness blockers; those hashes must identify actual evidence, not placeholder values.

Run an actual erasure with a newly created disposable QA account and owned files. Verify Storage API absence, the CDN wait, record cleanup, Auth deletion, receipt status after sign-out, and a retry/failure path. Do not use the existing QA owner account for this destructive acceptance test. Review cases need a separately authorized operator resolution process; this candidate does not auto-resume them.

Supabase documents that signed URLs can remain served from cache after token expiry and that deleting an object can take up to 60 seconds to invalidate cached entries. The 65-second deletion wait accommodates that documented interval; browser/device copies already downloaded cannot be remotely recalled. See [Supabase Smart CDN documentation](https://supabase.com/docs/guides/storage/cdn/smart-cdn). No result here establishes recall of saved copies or immunity from screenshots.

Physical iPhone testing of media rendering, playback, backgrounding, seeking, account switching, Photos export, slow networks, and the original failing photos/videos remains necessary. The later database-hardening lane also supplies the planned highlight audience/hidden-user fixes and must be included in the final integrated release gate. Nothing in this report authorizes TestFlight or represents acceptance of the app as flawless.
