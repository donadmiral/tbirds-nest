# Platinum media quality release — 28 October 2026

The source includes eight compact memory-book covers, book settings and persistent soundtracks; reliable story gestures and exact story links; validated tagging and reshares; optional full-frame Discover viewing with paged scrolling; soundtrack selection and non-destructive media edits; safer message attachments, voice retry, typing and call media ownership; and automatic dark-mode fixes.

## Verification

All three application typechecks pass. Phone: 590 tests; web: 374; admin: 58; database: 245. The RPC runner and complete pending migration chain pass. Production Next.js build and iOS Hermes export pass. See RELEASE_CHECKS_20261028.json. An export is not a signed installer or an iPhone acceptance test.

## QA database applied

Only project uaulhuelcfkjwojtymmw was changed. Production projects were not migrated.

| Local migration | Hosted QA version |
| --- | --- |
| 20261026063625_soundtrack_rights_and_post_audio.sql | 20261028151728 |
| 20261026064639_post_media_edit_projections.sql | 20261028151734 |
| 20261028151016_memory_book_design_and_soundtrack.sql | 20261028151738 |
| 20261028152200_story_mention_reshare_quality.sql | 20261028151748 |
| 20261028153700_discover_media_access_guards.sql | 20261028151753 |

## Coordinated private-media release

The private session service, local optional phone detector, recipient watermark, OS capture controls, access migration and cleanup worker are implemented and tested in source. They are not switched on in QA yet. Web requires NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED=true and defaults to its existing phone handoff. Do not enable this until the new native build and backend are ready together. See PRIVATE_MEDIA_20261028.md for the complete cutover and acceptance procedure. The current iPhone installer cannot gain new native dependencies through an OTA-only update.

## Music boundary

Rights-aware catalog ingestion, licensed-use and territory validation, immutable assets, expiry/revocation, excerpts, volume and playback synchronization are implemented. No commercial catalog or rights were enabled. The trusted ingestion service must validate cleared assets and agreements before activating them. Editing recipes affect app playback; this release does not claim baked video exports or an Apple Music reuse licence.

## Acceptance still requiring devices or external setup

Test actual iPhone long presses, scroll, call routing and audio interruptions, camera/recording protection, permission cancellation, private-view false positives, thermal/battery use and upload quality. Android hardware/build acceptance is deferred by the user. This release is not a five-million-user load certification, universal camera-capture prevention, E2EE, or a claim of zero security advisories.

The two synthetic QA videos require transfer from protected Vercel hosting to normal media storage; see QA_VIDEO_REPAIR_20261028.md for status. Other user videos must remain untouched.
