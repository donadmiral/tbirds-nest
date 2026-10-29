# Production backend rollout — 2026-10-29

**Review artifact; no production changes have been made by this audit.** The current plan contains 40 ordered atomic units / 41 source files. The machine-readable source of truth is `supabase/ops/production-rollout-20261029.json`; every included SQL body has a SHA-256 digest. The final application commit must be recorded by the release owner after combined CI passes.

## Targets and evidence

- Production Supabase: `prlkikhckbifseosbukl` (PostgreSQL 17.6). QA: `uaulhuelcfkjwojtymmw`.
- Public web/admin domains: `platinumcircles.app`, `www.platinumcircles.app`, `admin.platinumcircles.app`; Vercel team `intobank`, projects `platinum-web` and `admin-web`. QA deployments do not update these aliases automatically.
- Production iPhone bundle: `app.platinumcircles.mobile`; QA bundle: `app.platinumcircles.mobile.qa`. Current production publication needs a signed production binary; the repo does not declare a verified OTA update URL/runtime. App Store Connect app ID: `6764038613`.
- Reviewed branch base: `7bcfafbedfacae6d2602a6b54bc79492ce0cd0fb`; master observed at `efbd0e38d774bd1574c066350dae6748fdb1cdca`. The UI fixes remain working-tree changes until the release owner commits them.
- Eight relevant function definitions in the local 2026-10-17 schema fixture exactly match production MD5s: `get_feed`, `get_memory_albums`, `get_memory_book`, `start_group_call`, `sweep_dead_calls`, and all three payment receipt/retention guards. This is a relevant schema fixture, not a device-validation claim.
- All 36 newly created relation sentinels are absent in production; query is saved as `supabase/ops/check-production-new-relations.sql`. Additional structured post edit references were checked: two have matching Storage owners; no extra unknown-owner references were found in the reviewed products, drafts, story audio/transforms/photo stickers.

## Legacy media evidence and scoped compatibility

Current production has 139 owner-confirmed core post/story media references and 15 references without a recorded Storage owner. Those 15 resolve to 10 distinct existing objects in five posts and five stories across four authors. All ten are in public buckets, have `everyone` audience, match the parent author in the canonical path prefix, and have no conflicting parent author. Nine are MP4 videos and one is JPEG. Both Storage owner fields and user metadata are absent. Object rows were created August 31–September 3 after their publication timestamps; this is consistent with replacement/import, but does not prove who uploaded them.

Current story upload policy requires the caller’s own folder; old post upload policies require only authentication. No reliable historical uploader audit is present in the repository. **Do not invent uploader IDs or automatically bind these objects from a path alone.** Unit 39 adds a separately reviewed finite read snapshot for exactly these ten entity/object/version pairs. Its provenance is explicitly `reviewed_legacy_public_read_20261029`, separate from verified uploader bindings. It grants no new upload, edit, cross-entity reuse or object-deletion rights. The current parent author, canonical URL, object ID/version, public bucket and normal audience/profile/block checks must still match. Deleting a parent permanently revokes its snapshot, including after a privileged same-ID restore. An expired owned story may be read through an independently authorized memory book.

The ten SHA-256 fingerprints were measured directly from production; no user URLs or user IDs are stored in the migration source. `supabase/ops/check-production-legacy-media.sql` must return exactly ten pairs (five posts/five stories) immediately before deployment. Production postflight must confirm ten snapshot rows and historical rendering. Other projects legitimately match zero; zero is **not** an acceptable production postflight result. No broad public fallback is introduced, and Storage ownership remains unchanged.

## Ordered source files

Apply sequentially. The two source files in unit 5 must run in **one transaction**, so installed clients never see an intermediate unconditional update error from `consume_media_view`. All other units are applied once using their complete original SQL body. Do not concatenate migration files that contain their own `BEGIN`/`COMMIT` into a single outer transaction.

| Unit | Exact source file(s) in `supabase/migrations/` | Purpose |
| --- | --- | --- |
| 1 | `20261022173041_platinum_private_application_cvs.sql` | New private CV bucket and owner/recruiter access; existing legacy CVs unchanged. |
| 2 | `20261022173052_account_export_snapshot.sql` | Caller-bound account export snapshot for Settings export. |
| 3 | `20261022173111_creator_monetization_foundation.sql` | Creator entitlement prerequisite; enrollment and payouts closed by default. |
| 4 | `20261022211223_marketplace_order_lifecycle.sql` | Order/reservation/read contracts used by current marketplace clients. |
| 5 | `20261022211236_message_call_access.sql` + `20261029045648_legacy_chat_media_compatibility.sql` | Chat authorization and call guards, immediately followed by the legacy bridge in the same transaction. |
| 6 | `20261022211253_social_directory_history_quality.sql` | Profile/discovery/channel/search read APIs; new channel-media bucket is private. |
| 7 | `20261022211259_platinum_story_editor_and_hiring.sql` | Atomic story publication, full drafts, private sticker responses. |
| 8 | `20261022211311_story_sound_rights.sql` | Reject unverified reusable audio; required dormant story/book dependency. |
| 9 | `20261022211313_creator_finance_operations.sql` | Closed-by-default finance prerequisite, no worker launch. |
| 10 | `20261022211400_creator_product_entitlements.sql` | Real paid-subscription entitlement predicate used by content visibility. |
| 11 | `20261022211411_feed_snapshot_visibility.sql` | Saved feed snapshot visibility checks. |
| 12 | `20261022211448_business_publishing_and_receipts.sql` | Current commerce/promotion and receipt read RPCs. |
| 13 | `20261022211637_hiring_workflow_quality.sql` | Recruiter pagination and concurrency-aware scheduling; old signatures retained. |
| 14 | `20261022211641_feed_mute_feedback.sql` | Adds mute predicate without replacing feed ranking. |
| 15 | `20261022211648_content_media_manifests.sql` | Owner-backed media bindings and signer manifest; no bucket flip. |
| 16 | `20261022211649_creator_finance_review.sql` | Guarded admin finance read/review API, no automatic decisions. |
| 17 | `20261022211701_admin_payment_reporting_and_support.sql` | Service-only payment reports used by admin. |
| 18 | `20261022211835_admin_command_provision_contracts.sql` | Guarded AAL2 admin commands/provisions/support/deletion requests. |
| 19 | `20261023185734_redacted_client_diagnostics.sql` | Redacted, caller-bound diagnostic submission. |
| 20 | `20261023185851_market_receipt_binding_immutable.sql` | Prevents payment/order identity reassignment; required with order-aware bridge. |
| 21 | `20261023190047_content_owner_upload_previews.sql` | Owner-only unpublished upload previews. |
| 22 | `20261023190254_creator_finance_dispatch_and_refund_guards.sql` | Finance dispatch/environment/refund guards remain closed by default. |
| 23 | `20261023190316_admin_moderation_removal_guards.sql` | Preserves previous moderation removals; backfills audit identities only. |
| 24 | `20261023190601_platinum_storage_bootstrap.sql` | Constrain upload/update/delete policies, preserve all existing bucket visibility. |
| 25 | `20261023191000_support_triage.sql` | Guarded admin support triage contracts. |
| 26 | `20261023192203_story_soundtrack_authoring.sql` | Optional story audio payload dependency; no catalog enablement. |
| 27 | `20261023193500_call_membership_recovery.sql` | Call membership generations; old join/leave signatures retained. |
| 28 | `20261025073211_marketplace_verified_reviews.sql` | Verified order-linked review and admin moderation contracts. |
| 29 | `20261025073232_verification_integrity.sql` | Reviewed verification and report integrity; no self-verification. |
| 30 | `20261025073234_applicant_self_service_quality.sql` | Applicant pagination and retained withdrawal events. |
| 31 | `20261025073235_trending_story_visibility.sql` | Recheck live story privacy on trending snapshot reads. |
| 32 | `20261026063625_soundtrack_rights_and_post_audio.sql` | Dormant soundtrack validation dependency; no licenses/origins/catalog imported. |
| 33 | `20261026064639_post_media_edit_projections.sql` | Read saved media edits consistently across feed/profile/search. |
| 34 | `20261028151016_memory_book_design_and_soundtrack.sql` | Memory cover designs, owned page swaps and legacy book RPC compatibility. |
| 35 | `20261028152200_story_mention_reshare_quality.sql` | Audience-safe mention/reshare publication and notifications. |
| 36 | `20261028153700_discover_media_access_guards.sql` | Discovery media author/block/subscription access guards. |
| 37 | `20261028185149_memory_book_presentation.sql` | Saved subtitle and owned cover story; atomic new-book creation. |
| 38 | `20261029044445_story_reply_controls.sql` | Persist owner-selected story reply controls. |
| 39 | `20261029050453_legacy_public_media_snapshots.sql` | Preserve ten exact historical public read associations; no invented uploader ownership or new-write rights. |
| 40 | `20261029051017_faststart_registered_provenance.sql` | Require verified published media bindings and an exact object/version lease before service video remux; preserve unknown-owner originals. |

## Explicitly excluded

| Source | Reason |
| --- | --- |
| `20261023185729_chat_storage_cutover_and_reference_guards.sql` | Hold: flips existing public chat buckets private and changes legacy object access. Requires coordinated installed-client adoption. |
| `20261025073213_single_owner_qa_access.sql` | Exclude production: QA-only sole-owner assurance exception. Production admin keeps AAL2. |
| `20261023190325_scoped_call_worker_credential.sql` | Defer: only required by the daily-reconcile worker, which is not part of this rollout. Do not generate or distribute a worker secret. |
| `20261028150938_private_media_sessions.sql` | Hold: changes historical expiry, recipients/counters, media representation, object reservation and erasure lifecycle; incompatible with legacy installed clients. |

The production limited-view protocol is explicitly legacy-compatible. `open_legacy_chat_media` calls the real serialized claim RPC and returns its original two-minute deadline, authoritative media type and remaining count. Old `consume_media_view` keeps its TABLE return shape and uses that same counter. Both wrappers refuse to operate if `private_media` exists. No seven-day expiry, recipient snapshot, cleanup worker, object erasure or bucket privacy flip is introduced. Existing public object URLs remain the production baseline; this release must not be described as an enforced private-media cutover.

## Do not replay drifted baseline history

- `00000000000151_capture_functions.sql` is a historical dashboard snapshot, not an incremental change; replaying it can overwrite later authorization repairs.
- `00000000000152_organizations.sql` is unrecorded in production migration history, but its organization tables exist. Reconcile exact schema/body evidence before any history repair; do not replay the entire backfill.
- `20260910230211_chat_payment_recovery.sql` is also unrecorded, but its two columns and four receipt/retention triggers exist. The three core function hashes match the live-schema fixture exactly. Do not replay its data backfill.
- Several new migrations are intentionally non-idempotent (`CREATE TABLE/TRIGGER`, named constraints, function rename). A missing source timestamp in hosted history does not establish that its body is absent. Record actual hosted migration IDs and source hashes for every apply operation. Never run a blanket `supabase db push`, reset, or seed against production.

## Preflight and deployment gates

1. Freeze the final application commit and verify manifest hashes. Capture current production deployment IDs and a restorable database backup/PITR checkpoint. The release does not upgrade Postgres.
2. Re-read production migration history, required table/function presence, constraints, bucket visibility, and active functions. Run `supabase/ops/check-production-baseline.sql` and `supabase/ops/check-production-new-relations.sql` before the first unit. Abort on unexpected partial installation or changed baseline feed/projection definitions; do not force string patches past missing anchors.
3. Run `supabase/ops/check-production-legacy-media.sql`; require ten exact pairs. Apply unit 39 before promoting the new signer-dependent clients, require ten registered snapshots, then verify their authorized rendering. Record aggregates without user URLs in release notes.
4. Apply the ordered units through the migration API, preserving exact SQL and atomic unit 5. Stop on any failure; inspect committed units before retrying. New application-cvs/channel-media buckets are private; existing post/story/media/chat buckets retain their visibility.
5. Deploy reviewed `content-media-sign`, `chat-media-sign`, `export-my-data`, order-aware `crisp-bridge`, and guarded `faststart-video` sources after their RPCs exist. Preserve gateway JWT checks on the four media/export endpoints and the existing `verify_jwt=false` setting on `crisp-bridge`, whose handler authenticates the caller itself. `crisp-bridge` needs the existing `CRISP_API_URL`/`CRISP_API_KEY`; the other endpoints use built-in Supabase configuration. Hold production `daily-get-token` at v34: its exact downloaded handler accepts the current client contract, while the newer strict handler can race installed clients joining an incoming group call. Provider-token identity binding and shorter token lifetimes are not delivered by this release. Keep the existing compatible `crisp-payment-recovery` v2 worker; do not invoke it. Deploy the guarded faststart bundle promptly after unit 40; old unmarked service rewrites are rejected by the version guard, while normal new uploads continue. Do not deploy private-media, Apple/music, payout or reconciliation workers.
6. Run `supabase/ops/check-production-postflight.sql` and verify function authorization/denial and exact RPC shapes, then smoke-test a normal new upload, historical profile thumbnails, story publish/reopen/replies, book create/cover/reorder/read, account export and the admin read flows using authorized sessions. Do not use real payouts or message recipients as tests.
7. Promote web/admin only after backend and exact-source CI gates pass. Build production iOS with production backend and legacy media protocol; development, preview and production all keep private sessions disabled for this release. Hosted QA verification found no private_media schema or private-media endpoints; that protocol remains deferred everywhere until independently deployed and validated. Installation/testing on the actual production app remains a distinct verification step.
8. Record final commit, actual applied migration IDs, Edge versions, Vercel deployment IDs, and iOS build/TestFlight status. A QA branch, code export or passing unit count does not establish a production iPhone release.

## Behavior and rollback implications

No included migration automatically deletes user data or moves money. Creator enrollment, payouts and sandbox purchases remain disabled; do not populate provider credentials/rights/origins or launch workers. Soundtrack schema is an existing story/book contract dependency, not permission to import or license music. Existing unverified catalog audio becomes unavailable; original video audio is unaffected by catalog rights checks.

The faststart service now skips files lacking a verified published uploader binding, including snapshot-only and draft-only assets. A short lease and exact version/ETag fence prevent stale jobs from committing over another object generation. Unmarked service-role video replacements are refused; the snapshot records do not authorize remux.

The new guards intentionally reject in-place content-object overwrite/delete, direct application deletion (withdrawal retains history), self-verification, changes to a verified identity without review, raw diagnostics writes and payment/order reassignment. New CV/channel attachment formats require compatible readers. Legacy book RPC signatures and recruiter scheduling signatures remain; old limited-view consumption uses the tested bridge.

If an additive unit fails, its transaction must roll back; do not advance to dependent units. If frontend verification fails after successful schema work, restore the recorded web/admin deployment and keep the compatible additive schema while investigating. Do not drop new tables or undo retention/audit records. Do not flip private buckets public to mask an authorization failure. Rollback of a tightened guard is a separate reviewed fix, not a wholesale baseline restore.

## Local verification performed

- Final integrated RPC CI command `npm test --prefix supabase/tests/rpc-authorization` exited 0 with the final 40-unit/41-file manifest. The three new suites run in isolated child processes in `run-all.mjs`, preserving their independent database/test hooks.
- `node supabase/tests/rpc-authorization/test-production-rollout-chain.mjs`: all 40 selected units /41 source files apply to the production-matching live-schema fixture; required RPCs resolve, existing bucket visibility is unchanged, private schema/QA assurance exception absent, finance enrollment/payouts false.
- `node supabase/tests/rpc-authorization/test-legacy-chat-media-compatibility.mjs`: 11 behavior cases pass: response shape, unchanged retry deadline, shared old/new counters, exhaustion, sender/nonmember/anonymous refusal, expired request, account/message binding, deletion, unsupported media, foreign-owner denial, bucket preservation, private-schema refusal (some cases cover more than one invariant).
- `node supabase/tests/rpc-authorization/test-legacy-public-media-snapshots.mjs`: 11 runtime database cases pass for the finite whitelist, current audience/private-profile/block checks, new-write/cross-entity refusal, object version/deletion/bucket checks, irreversible parent revocation, archived-story book access, immutable evidence and anonymous denial. Only the ten fingerprint constants are substituted with synthetic test evidence; runtime SQL remains the same.
- The faststart owner reports 11 database lease/lifecycle/permissions/race cases and 10 handler/entry cases passing; the final combined gate remains with the release owner.
- Parent release owner runs combined UI/type/build/Edge and domain-specific regression gates. These local database checks do not prove hosted timing, provider behavior, browser rendering or physical-device gestures.

## Hosted audit limitations before release

Production is `ACTIVE_HEALTHY`, but the available connector does not expose backup/PITR inventory or a recoverable time window. This does not verify a recovery point. The release owner must record the actual disposition before production mutations.

Production Storage trigger, stored-function, cron and hook-history metadata contained no active faststart webhook. Vault metadata contained the `service_role_key` name; no secret value was read. Deploying the guarded endpoint does not create a webhook or prove active remux delivery. The guard remains a protection against any externally managed or later configured caller.
