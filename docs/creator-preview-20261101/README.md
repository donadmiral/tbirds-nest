# Creator preview, 1 November 2026

This preview extends the previously installed Platinum QA app with the requested story, permission, memory-cover, React, and composer changes. The preview remains linked to the existing QA Expo project and QA backend.

## Changes

- Story photo timing begins on image readiness; video progress uses the native playhead and first-frame readiness. Loading/stalls expose bounded retry or exit controls. Completion exits before hiding the last story.
- Confirmed story publication announces success and returns to the feed. Media reshares retain identity and source links without automatically repeating the source caption.
- Native permission callers read current OS grants before requesting, accept limited photo access, share concurrent requests, and honor revocation. iOS automatic limited-library reminder alerts are disabled; explicit user selection remains available.
- Memory covers support one photo/video thumbnail or an ordered collage of up to four book memories, handwriting/cursive titles, independent colors, and real freehand drawing with undo/redo. v1 documents and existing authorization remain compatible.
- React captures a continuous front-camera/microphone take alongside independently controlled source playback. Native export combines split screen, PiP or person cutout, source holds/replays, trim, sound levels, artwork and creator attribution into an MP4. Post sources are refreshed through current post visibility and exact media capabilities before capture/export/publication.
- Finished React exports remain pending until committed to the composer. Account/session changes invalidate late work. The visible original-source credit and published quote use the same source.
- Composer type chips no longer expand vertically, caption spacing is compact, and horizontal media/category rows use their content height.

## Focused verification before packaging

| Area | Result |
| --- | --- |
| Story timing, publication and privacy behavior | 51 passed |
| React timelines and native request/result contracts | 11 passed |
| Permission broker behavior | 5 passed |
| Canonical React source authorization and revisions | 6 passed |
| Actual Feed handoff, draft ownership and publication callbacks | 24 passed |
| Existing voice recorder, native call and call-media regressions | 44 passed |
| Memory creative/client regressions | 27 passed |
| Real SQL/RPC persistence in PGlite | 35 passed; one pre-existing combined fixture skipped |
| Native and web TypeScript | Passed |
| Memory-cover browser interaction and persistence | Passed, including identical saved cover pixels after reload |
| Android production compositor and eight instrumentation test sources | Compiled against pinned Kotlin, Android, Media3 and ML Kit APIs |

## Native media verification

- Corrected iOS production renderer: all five runtime cases passed on iOS 26.2 arm64 Simulator. Four actual MP4s were decoded and inspected for continuous camera/microphone, source holds and replays, independent audio gains, PiP/photo artwork, trim alignment, invalid inputs and cancellation cleanup. See `ios-react-runtime.json`.
- Android production renderers: all 48 emulator cases passed on API 35, including eight React, 23 story and 17 memory cases. React checks include independent camera/source clocks and audio, mute, photo/artwork fitting, trim, cutout execution and cancellation. See `android-runtime.json`.
- Full native iOS app integration compiled and linked successfully for x86_64 Simulator, including the React renderer and native player bridge. See `ios-native-compile.json`.
- The first iOS export test caught a source-audio fade. Commit `1f831976d4d96d0aab0fa3a47974ffe8de31ea4d` fixes the native mixing windows; the corrected test passed without weakening its assertions.

Android's full Gradle debug assembly succeeded (803 tasks). Its following receipt step rejected the new React capability constants because its regex still described the old bridge. The receipt script is corrected and syntax-checked; application code did not need to change. The subsequent EAS Release build also finished successfully. See `android-native-compile.json`.

A supplemental inspection of the finished APK could not run because its provider artifact URL returned HTTP 403. `android-apk-check.json` records that access limit with `passed: null`; no packaged ABI, registration or certificate-inspection success is inferred. The authenticated Expo page exposes the completed build and installation instructions.

These are native simulator/emulator executions. They do not claim a physical-phone walkthrough or human person-matte quality acceptance.

## Hosted QA change

`20261101181618_memory_cover_personalization_v2.sql` was applied through the normal migration API to `uaulhuelcfkjwojtymmw`. Its provider journal version is `20261101182254`. Postflight verified v2 normalization, capability advertisement, source-membership enforcement and unchanged private-helper access restrictions. Production was not changed.

## Installable previews

Both accepted Expo builds finished successfully with bundled JavaScript, native compilation and signing. They use the existing QA app identifier and `qa-preview` channel.

| Platform | Version | Source | Installation |
| --- | --- | --- | --- |
| iPhone | 1.1.0 (10) | `1f83197` | [Expo install page](https://expo.dev/accounts/donadmiral/projects/platinum-circles/builds/d2601c9b-4aca-4cfd-9de1-27697dda1ce4) |
| Android | 1.1.0 (5) | `acac966` | [Expo install page](https://expo.dev/accounts/donadmiral/projects/platinum-circles/builds/03dd67c6-e489-4efe-998e-6aa526954e57) |

Android uses the complete creator-update source. iPhone additionally includes the verified iOS-only audio mixing correction. Final evidence and CI-receipt updates do not change the application code in these packages. iOS build9 is superseded and is not the delivered preview.

React is available from a post's share menu and the post composer. Personalized covers are in Book settings, including Single photo, Photo collage, Cursive title and Draw on cover.

The exact build identifiers, source commits and public artifact URLs are saved in `preview-builds.json`.
