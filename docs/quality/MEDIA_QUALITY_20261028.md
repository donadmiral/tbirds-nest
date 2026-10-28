# Platinum media quality release — 28 October 2026

The source includes eight compact memory-book covers, book settings and persistent soundtracks; reliable story gestures and exact story links; validated tagging and reshares; optional full-frame Discover viewing with paged scrolling; soundtrack selection and non-destructive media edits; safer message attachments, voice retry, typing and call media ownership; and automatic dark-mode fixes.

## Verification

All three application typechecks pass. Phone: 594 tests; web: 387; admin: 58; database: 245. All 1,284 named tests pass with no skips or failures. The RPC runner and complete pending migration chain pass. Production Next.js build and iOS Hermes export pass. See RELEASE_CHECKS_20261028.json. An export is not a signed installer or an iPhone acceptance test.

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

The two synthetic QA videos were transferred through the normal uploader to private media storage and the original QA post was repaired. Both videos played successfully in the authenticated web app. See QA_VIDEO_REPAIR_20261028.md for exact scope and evidence. The user's separate uploaded video was not modified.

## Browser-discovered follow-up

Live QA checks found and fixed three additional issues: timezone-dependent timestamp hydration, cropped portrait video in post detail, and archived video stories rendered as broken images in the book picker. Relative timestamps now have a stable first render and shared client clock. Post detail fits the full video frame inside the existing bounded layout. Rotated still images fit inline and theater viewports, including the comments panel. Book previews render text and video correctly, label their selection state, show unavailable media honestly, and recover after re-signing expired media URLs.

Verified in the live QA browser before the final follow-up deployment: repaired landscape and portrait video playback; Discover scrolling between distinct posts; comments closed by default, opened and closed on request; expanded full-frame portrait playback; creating a compact Postcard-style book (`QA memories`, ID `8ab712f2-88ce-4205-9734-7871002c69a7`); sticker creation and editing controls; empty rights-cleared music catalog guidance; dark-mode settings readability and restoration of the original System theme. The story preview was not published.

Screenshots: `qa-book-designs-20261028.jpg`, `qa-discover-fullframe-20261028.jpg`, and the initial `qa-video-repair-20261028.jpg`. The latter records the original post-detail crop before the follow-up fix. No signed media URL is stored in these notes.
