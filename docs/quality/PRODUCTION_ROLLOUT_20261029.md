# Production visual release — 2026-10-29

**Both earlier release plans are superseded.** Automatic approval review rejected the original music-rights unit and then rejected the non-music plan's `creator_finance_operations` unit as finance/payout infrastructure outside the visual task. Neither rejected unit was applied. Do not retry them, execute them indirectly, or recreate their behavior under another name.

Production remains at **seven applied units**. This plan has **18 total units / 19 source files, with ten visual units and one necessary existing-client compatibility unit remaining**. The frozen 35-unit manifest is retained only as a superseded audit artifact at `supabase/ops/superseded/production-rollout-20261029-35-units.json`; its SHA-256 is `bccfcd6b67fa85f1d8b21a1b8ffb4329b4da098d4bc9f1efd82cb7f08d992b9b`. It must not be used for deployment.

The current machine-readable source is `supabase/ops/production-rollout-20261029.json`. Its source checksums, applied-prefix checkpoint and exclusions are the deployment contract. This audit agent made no cloud mutations.

## Scope and unchanged contracts

The remaining changes address profile/post previews, saved post edits, story publication and layers, book designs/covers/page order, and the media authorization needed to display them. Only `content-media-sign` and the already-prepared compatible `chat-media-sign` endpoint are in scope.

No additional creator finance, subscriptions, products, revenue, payouts, payment receipts, marketplace, hiring, admin commands/provisioning, support operations, verification workflow, call-provider protocol, export endpoint, diagnostics, remux pipeline or Storage configuration is installed. The seven previously applied units are historical checkpoint state; do not undo them or replay them. All existing bucket visibility, MIME limits, Storage policies and excluded-domain schema/data/function behavior must remain unchanged after that checkpoint.

Production has no subscription helper/table. Its existing `can_view_post(uuid)` implements owner, block, community, profile/follower and audience visibility. The existing feed has no paid-subscription condition. The new visual manifest and Discover helper call that existing authorization contract; they introduce no finance schema or substitute entitlement function. Memory signing uses the same `can_view_memory_book(uuid)` predicate as the reader, including deactivation, block and explicit custom-access behavior.

Music selection remains fixed off in the client. The release adds no catalogue, rights schema, music-aware book API, separate audio publisher or music worker. Original audio inside an uploaded video remains part of the file. Development, preview and production keep private-media sessions disabled; existing chat view consumption uses the real claim/count/expiry bridge already applied in unit 5.

## Exact sequence

Resume at **new unit 8, the pure book presentation migration**, after the release owner reviews this scope and checks the checkpoint. The earlier rejected unit numbered 8 was a different SQL file and is excluded. Apply complete source files sequentially, without merging files containing their own transaction boundaries.

| Unit | State | Exact source file(s) in `supabase/migrations/` | Purpose |
| --- | --- | --- | --- |
| 1 | Already applied | `20261022173041_platinum_private_application_cvs.sql` | Historical applied private-CV unit; leave it intact. |
| 2 | Already applied | `20261022173052_account_export_snapshot.sql` | Historical applied export snapshot; no export endpoint rollout in this scope. |
| 3 | Already applied | `20261022173111_creator_monetization_foundation.sql` | Historical applied closed finance foundation; no further finance changes. |
| 4 | Already applied | `20261022211223_marketplace_order_lifecycle.sql` | Historical applied basic marketplace order schema; no further marketplace changes. |
| 5 | Already applied | `20261022211236_message_call_access.sql` + `20261029045648_legacy_chat_media_compatibility.sql` | Historical applied chat authorization plus legacy TABLE-result compatibility bridge, in one transaction. |
| 6 | Already applied | `20261022211253_social_directory_history_quality.sql` | Historical applied profile/discovery/social read contracts. |
| 7 | Already applied | `20261022211259_platinum_story_editor_and_hiring.sql` | Historical applied atomic story publication/draft/sticker contracts. |
| 8 | Pending | `20261029054043_memory_book_visual_presentation.sql` | Visual covers, subtitle, selected cover page, ownership/privacy, order and atomic new-book create; replay saved media edits. |
| 9 | Pending | `20261022211411_feed_snapshot_visibility.sql` | Reconcile cached feed IDs against current visibility. |
| 10 | Pending | `20261022211641_feed_mute_feedback.sql` | Honor muted authors without replacing feed ranking. |
| 11 | Pending | `20261029055844_visual_media_existing_visibility.sql` | Sign visual post/story/book media through current production authorization and verified uploader bindings; no new entitlement system. |
| 12 | Pending | `20261023190047_content_owner_upload_previews.sql` | Owner-only previews of new uploads. |
| 13 | Pending | `20261025073235_trending_story_visibility.sql` | Recheck live story privacy and expiry for ranked discovery rows. |
| 14 | Pending | `20261026064639_post_media_edit_projections.sql` | Return saved post media edits consistently in profile/feed/search. |
| 15 | Pending | `20261029054351_story_visual_publication_controls.sql` | Visual story publication, canonical post cards, mentions/resharing and reply settings; no separate audio publication. |
| 16 | Pending | `20261029055848_visual_discover_existing_visibility.sql` | Use existing production post access rules for Discover media. |
| 17 | Pending | `20261029054355_visual_media_legacy_snapshots.sql` | Ten exact historical public read associations, with current privacy and object-version checks. |
| 18 | Pending | `20261023193500_call_membership_recovery.sql` | Preserve the shipping client’s existing group-call admission/leave APIs and prevent a delayed close from evicting a newer join. |

Unit 18 is a concrete compatibility dependency: the current native/web clients already call `start_group_call_membership`, `join_group_call_membership` and `leave_group_call_membership`. Omitting these existing API contracts would break group calling while shipping the visual client. The release owner reviewed the original unit and approved its inclusion. It uses the provider-identity foundation already applied in unit 5, preserves legacy join/leave entry points, and deploys no new provider endpoint; production Daily v34 remains unchanged. This is not a retry or equivalent of either rejected music/finance unit.

## Production baseline and evidence

The local baseline is `supabase/reference/live-schema-20261017.sql`, loaded through `supabase/tests/rpc-authorization/live-schema-fixture.mjs`, followed by the exact first seven manifest units. Managed Auth/Storage/Vault objects are synthetic fixtures; no hosted database is reset or seeded. Production is PostgreSQL 17.6; the local runner uses PGlite 0.5.10.

The actual production checkpoint was verified read-only: all ten function hashes and 36 relation sentinels match the applied prefix, and the held music/private-media objects remain absent. `supabase/ops/production-resume-checkpoint-20261029.json` records that aggregate evidence, original bucket state and music fingerprints without user URLs or secrets. The existing music catalogue contained zero rows at this checkpoint.

`check-production-excluded-unchanged.sql` compares 21 existing finance/payment/market/hiring/support data sets, their relevant schema, grants, policies, triggers and functions, the existing post-access helpers, and all Storage bucket settings/policies. Capture it before and after the eleven remaining units. The local complete-chain check requires exact equality. Hosted differences require investigation because real concurrent user activity can change data hashes; a difference does not authorize rewriting records.

## Historical profile-media preservation

The read-only audit found 139 owner-confirmed core post/story media references and 15 references without a recorded Storage owner. Those 15 resolve to ten existing objects in five posts and five stories across four authors. All ten are currently public with `everyone` audience and matching author path prefixes, but those facts do not establish uploader ownership. Nine are MP4 videos and one is JPEG; both Storage owner fields and user metadata are absent. Do not manufacture ownership from filenames or the old remux implementation.

Unit 17 adds an immutable, separately labelled read association for exactly those ten reviewed entity/object/version pairs. The current parent, canonical reference, object ID/version, public bucket and ordinary privacy/block/access checks must still match. A deleted parent permanently revokes the association. An owned archived story may be read through an authorized book. The exception grants no new upload, edit, cross-entity reuse, deletion or remux right.

`check-production-legacy-media.sql` must return exactly ten matching pairs immediately before unit 17. Production postflight must confirm five post and five story snapshots. Deploy signer-dependent clients only after that step, so the new authorization path does not turn the existing profile media blank. No broad public-URL fallback is introduced.

## QA compatibility

QA already has the previous presentation and other historical schema. The release owner applied `20261029055318_memory_book_reader_visual_projection.sql` successfully. It replaces only the two book read functions with the same visual projections supplied by production unit 8, preserving existing schema/data/grants. Do not replay the new production schema/trigger replacements on QA.

QA's existing publisher already supports visual transforms, filters, stickers and reply settings. The release owner also applied `20261029060247_story_public_post_reference_cards.sql`, the separately reviewed canonical post-card guard. Neither QA patch replays the full production migration chain. The QA media/Discover implementations can retain their historical nonvisual dependencies while browser smoke tests exercise the same visual output; production compatibility is established by the actual baseline chain tests.

## Release checks

1. Record the final application commit and verify every included source checksum. Retain current production deployment IDs and the recovery disposition; this audit does not establish PITR availability.
2. Re-read hosted history and run `check-production-resume.sql`. All ten function and 36 relation checks must match the first-seven-unit checkpoint. Do not use the older all-absent pre-install sentinels to replay work.
3. Save `check-production-music-unchanged.sql` and `check-production-excluded-unchanged.sql` results. Both are single-result read-only queries. The existing finance foundation and marketplace order records must remain exactly as found.
4. Apply only units 8–18 after review. Stop on any error or approval rejection. Immediately before unit 17, repeat the exact historical-media fingerprint check.
5. Run `check-production-postflight.sql`; verify all visual RPCs and grants, exact legacy chat result, snapshot counts and absence of held infrastructure. Repeat both unchanged-state queries and investigate any differences.
6. Deploy only reviewed `content-media-sign` and `chat-media-sign` with built-in Supabase configuration and gateway JWT checks. Preserve current Daily, all Crisp/payment/recovery, export and faststart versions. Do not launch workers or add webhooks.
7. Release the tested web/admin visual changes with graceful availability for contracts excluded from this rollout. The frontend audit map is `supabase/ops/visual-release-excluded-contracts.json`; a listed replaced function may still have an older working signature, so do not assume every name is absent or replace old behavior speculatively.
8. Verify upload/profile preview, story edit/publish/reopen, book create/cover/order/read, and video trim/rate/filter/sticker replay using authorized sessions. Production web aliases are `platinumcircles.app`, `www.platinumcircles.app`, and `admin.platinumcircles.app` (Vercel `intobank`, projects `platinum-web` and `admin-web`).
9. Build and distribute the actual production iPhone bundle `app.platinumcircles.mobile` (App Store Connect `6764038613`), using production backend and legacy media protocol. QA bundle `app.platinumcircles.mobile.qa` is a separate app; no verified OTA URL/runtime is declared. Record the signed build/distribution and actual installed-device result separately.

## Verification and limits

The final integrated command `npm test --prefix supabase/tests/rpc-authorization` exited **0** with the frozen **18-unit / 19-file** manifest. It proves music, excluded-domain data/schema/functions, Storage settings/policies and existing post-access helpers remain unchanged after the applied prefix. The existing group-call authorization and admission/delayed-leave runtime suites also pass with the original reviewed membership unit.

The pure-book suite has 16 cases for ownership/privacy, atomic creation/rollback, chosen cover/fallback, order, 30-character titles, installed book APIs, saved trim/rate/filter/stickers, and identical QA reader definitions/grants. The historical snapshot suite has 11 behavior cases, and the legacy chat bridge has 11 cases. The visual publication suite passes 31 cases, visual content signing passes 16 cases (one historical music case is intentionally held), and Discover passes six cases. These suites are registered in the isolated RPC runner. The small full chain exercises the real baseline access helpers without new finance or music prerequisites.

These are database and source checks, not proof of hosted timing, browser rendering or physical-device gestures. The release owner owns combined frontend/type/build/Edge and real browser/device validation.

## Failure and rollback boundaries

No remaining unit deletes user content, transfers money, changes bucket privacy, invents uploader ownership or adds an unrelated service. If a unit fails, stop before its dependents and inspect the actual committed state. Do not undo the applied prefix, drop new audit/snapshot records, force missing string-patch anchors, or run blanket `db push`, reset or seed.

If a frontend deployment fails verification after the additive visual schema commits, restore the recorded frontend deployment while investigating. Do not replay historical function snapshots (`00000000000151_capture_functions.sql`), organization backfills (`00000000000152_organizations.sql`) or payment recovery (`20260910230211_chat_payment_recovery.sql`) to mask it. Those sources have known history drift and can overwrite established behavior.
