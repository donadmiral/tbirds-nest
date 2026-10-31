# Memory film and edited-video completion — 2026-10-29

## Status

Implemented in the quality-branch source, with local checks below. Nothing in this lane was deployed, committed, sent to EAS, or submitted to TestFlight. The currently installed iPhone binary does **not** contain the new native video implementation.

The continuous memory player and original instrumental are implemented on native and web. Story video color controls now have a real pixel renderer, and edited-video export has native and browser implementations. Native AVFoundation execution remains unverified because this environment has no Xcode/iOS SDK. Certain export features remain explicitly unsupported; they are listed separately from device testing below.

## Continuous memory film

The existing memory book remains readable with its existing cover and page design. **Play memories** opens an immersive film with a distinct return-to-book control. Every page advances automatically after its media is ready, and the sequence repeats continuously, including a one-page album. Videos use the actual player clock and the saved trim/speed recipe; embedded shared-post videos participate in the sequence. Text-only shared posts retain their text. Only the hydrated, authorized media locators already supplied to the reader are used.

The film includes previous/next, pause/play, progress, original-video mute, soundtrack toggle, soundtrack volume, close and read-book controls. Photo movement is gentle and bounded; reduced-motion removes movement and entrance fades. Native screen-reader activation pauses the film. Web dialogs trap focus, handle Escape and return focus to their opener.

Playback pauses for app/tab backgrounding, active calls, explicit pause, and page errors. Loading has a bounded deadline with Retry and Next memory instead of quietly skipping a failed page. Late audio promises cannot restart sound after unmount. The soundtrack uses one player across page transitions, with reduced music volume when the original video sound is enabled.

Relevant implementation:

- `shared/memoryFilm.ts`
- `src/components/memory/MemoryFilm.tsx`
- `web/components/memory/MemoryFilm.tsx` and its CSS module
- `src/screens/profile/MemoryAlbumScreen.tsx`
- `web/components/MemoryAlbum.tsx`

## Original background instrumental

**Quiet light** is an original procedural instrumental generated for this app. It uses additive synthesis, with no external samples and no imitation of a named song or artist. The licensed music catalogue remains disabled.

`tools/generate-memory-score.py` contains the complete deterministic arrangement and synthesis source. The generated native/web AAC assets are byte-identical. `assets/audio/platinum-memory-score.json` records the source and decoded checks:

| Check | Result |
| --- | --- |
| Container duration | 25.6 seconds |
| Codec | AAC |
| Sample rate / channels | 48,000 Hz / stereo |
| Source peak | 0.46 |
| Decoded peak | 0.4639493525 |
| Source loop-boundary delta | 0 |
| Decoded loop-boundary delta | 0.0000493952 |
| Bytes | 416,691 |
| SHA-256 | `8d86a4aa21575579500a6754598c4b1318d6b1d8cf827c0a24bdd9bd68081607` |

These are numerical checks, not a claim that an iPhone listening review, AAC looping through its audio route, or silent-switch behavior has been completed.

## Real video grading

The existing shared sRGB color-matrix recipe now applies to video pixels. Browser video previews, story playback and memory playback use the same SVG color matrix as photos. Native playback uses an AVPlayer item with a Core Image video composition, exposed through the existing local Expo module. The native controller preserves the story clock, trimming, rate, volume, play/end/status events, scrubbing and retry behavior. Its implementation avoids creating a second audio player for the same video.

Brightness, contrast, saturation, warmth, tint, highlights, shadows, fade, filter presets and intensity feed the shared matrix. Spatial grain/vignette remain separate overlays, so the saved color grade is not applied twice. Older binaries and unsupported platforms continue using their existing player and do not expose native grading/export as if the new module existed.

The iOS renderer pauses when detached/backgrounded and responds to audio interruptions. The editor also gates its player during calls and backgrounding. Actual iPhone audio routing, HDR tone mapping, orientation and rendering performance still require device acceptance.

## Edited-video export

### iPhone source implementation

The Save action now composes an edited MP4 instead of saving the original and claiming the edits were exported. The AVFoundation pipeline:

1. Validates local inputs and an unused, app-cache output path.
2. Reads the actual media tracks/duration.
3. Inserts the selected video and original audio interval, preserving audio gaps.
4. Scales the complete timeline for speed and preserves original-audio pitch.
5. Applies the pixel grade, fit/fill, zoom and normalized position.
6. Composites the actual captured background and timed static story artwork.
7. Writes an MP4, then checks its video track, duration and nonempty byte size before handing it to Photos.

The output is bounded to an even-pixel canvas of at most 1080 × 1920, a source window of at most 60 seconds, and an output timeline of at most 120 seconds. There is one native export job at a time, a three-minute deadline, cancellation, background cancellation, and cleanup of failed/temporary files. The original file is never overwritten.

Capture and final Photos dispatch retain the existing mounted/account/draft fences. Permissions completing after an account change cannot export another account's draft. Raw iOS `react-native-view-shot` paths and file URLs are both validated. The caller's output URI is preserved across internal `/var` / `/private/var` path normalization.

Files: `modules/boomerang/ios/StoryVideoComposition.swift`, `StoryVideoView.swift`, `BoomerangModule.swift`, `modules/boomerang/storyComposition.ts`, `storyVideo.tsx`, `shared/storyVideoComposition.ts`, and the native story composer/viewer integration.

### Browser implementation and observed output

Browser Save uses the actual story artwork, embedded image/font bytes, a WebGL pixel grade, a Canvas stream, Web Audio for the original sound mix, and MediaRecorder with runtime codec selection. It does not record UI chrome. It rejects unavailable/tainted media rather than emitting an empty or partly missing image. Export cancellation, hidden-tab cancellation, media errors, a deadline and byte limits are explicit. The completed file has its real MP4 or WebM extension; the user receives a download control. Account/draft changes revoke temporary blob URLs and cancel pending work.

Streaming WebM output receives finite duration metadata using the EBML/Matroska format. The small finalizer is scoped to the app's own live recordings and avoids changing indexed files. It rewrites only the small header with Blob slices rather than loading the complete video into a JS array.

The actual browser integration fixture uses the production export module, official Chrome for Testing 156.0.8078.80, a generated three-second red/blue video, a sine-wave audio track, and DOM artwork. The output is decoded and inspected with ffprobe/ffmpeg. The receipt is `MEMORY_VIDEO_BROWSER_20261029.json`.

| Observed check | Result |
| --- | --- |
| Pixel output | 1080 × 1918, matching the fixture's canvas aspect |
| Trim/speed | Two seconds of source at 2×, approximately one-second output |
| Actual encoded format in this browser | VP9 WebM; Opus when original sound is enabled |
| Brightness −100 | Red sampled as `[125, 0, 0]`, blue as `[0, 0, 126]` |
| Timed artwork | Green artwork present before its end, absent afterwards |
| Sound mix | Nonzero decoded audio at the selected mix |
| Muted export | No audio track |
| Cancel | Rejected without an export result |

This verifies the browser engine with synthetic media. It does not substitute for a signed-in composer walkthrough, real private media/CORS checks, Safari acceptance, or native rendering tests.

Files: `web/lib/storyVideoExport.ts`, `web/lib/recordedWebm.ts`, the web composer/editor/viewer integration, and `web/tests/browser/story-video-export.cjs`.

## Features still requiring implementation

These are explicit product limitations, not merely tests waiting to run:

- Animated GIF export and animated sticker/text entrances. The exporter rejects these; it does not silently save a frozen substitute.
- A video embedded inside another video, including video post/story stickers.
- Mixing a separately added song or voiceover into exported story video. Original video audio is supported. The licensed catalogue remains disabled.
- Native dual-camera video export. The draft is preserved and the limitation is explained.
- Downloading an entire memory album as one composed movie. This change implements continuous memory playback and individual edited story-video export; it does not add an album-movie download action.

## Verification

Passed locally:

- Native and web TypeScript (`tsc --noEmit --incremental false`).
- 9 native/shared memory-film behavioral cases and 7 web memory-film cases.
- 10 video recipe/bridge/controller cases.
- 4 WebM duration/header cases.
- 10 native story-editing cases, including the new composed-save handoff, unsupported build and stale-account checks.
- 7 existing photo-pixel cases.
- Existing memory playback, media authorization/regression, page-turn, stability and story-presentation suites.
- Existing web memory hook-boundary and story editor post-fit suites.
- Real browser video fixture: graded audio export, muted export, cancellation, decoded media/pixel checks.
- `git diff --check`.

Reproduction:

```sh
node tests/quality/memory-film.cjs
node tests/quality/story-video-composition.cjs
node tests/quality/story-editing-state.cjs
cd web
node tests/memory-film.cjs
node tests/recorded-webm.cjs
STORY_QA_CHROME=/path/to/chrome node tests/browser/story-video-export.cjs
```

The browser integration test requires a locally installed Chrome for Testing plus ffmpeg/ffprobe and permission to launch local processes. It does not read user media or call a production backend.

## Native and end-to-end acceptance still required

An Xcode compile of the local Expo module is required before a new iPhone binary can be called ready. Then verify actual playback/export on device: landscape/portrait rotation, mirrored captures, HDR/HEVC/HEIC sources, silent switch, headphones/Bluetooth, incoming/in-app calls, app backgrounding, Photos permission states, cancellation at each stage, large/slow media, private signed URLs, timed text/photo stickers/polls/drawings, and output sound sync. Check reduced motion, VoiceOver, Dynamic Type, narrow screens and landscape controls.

The isolated QA deployment and its authenticated user journeys remain separate acceptance gates owned by the release coordinator. No claim of zero bugs, complete provider acceptance, a 10/10 rating, or TestFlight readiness is made by these local results.

## Primary implementation references

- [Expo module API, native views and events](https://docs.expo.dev/modules/module-api/)
- [Apple AVVideoComposition with Core Image filters](https://developer.apple.com/documentation/avfoundation/avvideocomposition/init(asset:applyingcifilterswithhandler:))
- [Apple AVAssetExportSession](https://developer.apple.com/documentation/avfoundation/avassetexportsession)
- [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [MDN Canvas capture stream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [MDN MediaElementAudioSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaElementAudioSourceNode)
- [Matroska element specification](https://www.matroska.org/technical/elements.html)
- [RFC 8794, EBML variable-size integers and elements](https://www.rfc-editor.org/rfc/rfc8794)

The iOS implementation deliberately retains the AVFoundation APIs available at the repository's iOS 15.1 deployment target. Availability/deprecation warnings and actual build behavior must be reviewed in Xcode; TypeScript cannot validate Swift or Apple frameworks.
