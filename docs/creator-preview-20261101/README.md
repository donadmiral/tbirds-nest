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

The standalone native encoding gates and full installable builds attach their own results to this branch. A compiler result is not treated as device execution or human cutout-quality acceptance.

## Hosted QA change

`20261101181618_memory_cover_personalization_v2.sql` was applied through the normal migration API to `uaulhuelcfkjwojtymmw`. Its provider journal version is `20261101182254`. Postflight verified v2 normalization, capability advertisement, source-membership enforcement and unchanged private-helper access restrictions. Production was not changed.
