# Web memory movies and local export audio

Date: 2026-10-30. Source changes and synthetic browser verification only. No production, provider, account, bucket, catalogue, deployment or TestFlight operation was performed for this work.

## Delivered behavior

The memory film now has a **Download memory movie** action. It opens a keyboard-contained download dialog, pauses the reader and its score, and lets the viewer choose original video sound, the existing original *Quiet light* instrumental, or an audio/voiceover file from their device. Create and Back stay visible while longer options scroll. Closing, Escape and returning to the film have defined paths; the film stays paused until the viewer deliberately resumes it.

The movie contains all supported pages in book order in one actual recorded file. It includes photos, text pages, the author’s saved video trim/speed/framing/color, drawings, static stickers, timed layer windows and captions that fit the movie frame. It uses the already authorized media references supplied to the reader. It does not manufacture public storage URLs or substitute a thumbnail for a missing original.

The movie is portrait 720 × 1280 at a requested 30 frames per second. It has hard cuts between memories. Photo/text durations follow the reader’s existing 3–30 second bounds; video durations follow the saved excerpt and playback speed. The movie is bounded to **30 memories, five minutes, 120 captured artwork states, and 160 MiB of recorded output**. Decoded artwork and video renderers are retained for the current and next memory rather than every page at once. The selected codec determines the truthful `.mp4` or `.webm` filename.

Original clip audio retains its saved mute and level setting. The score loops on one continuous timeline, ducking under original video sound. A local file can be mixed into the movie with an explicit level, start point and repeat option. With repeat off it plays once; with repeat on only the selected excerpt repeats. Mixing uses a unity-gain ceiling rather than a compressor that changes the chosen level.

The story editor’s **Save video** action now opens download options. Its existing edited-video exporter can mix the same local audio/voiceover while preserving the original-sound setting, including a muted original. The exported file is offered for download after encoding succeeds. Choosing local audio **does not change a published story, save audio to a draft, upload a recording, or enable the catalogue**.

Local audio is limited to a non-empty MP3, M4A, AAC, WAV, Ogg, WebM or FLAC file under 30 MB, with a decoded duration of at most three minutes and mono/stereo channels. Actual browser decoding determines support. A bad file or unsupported decode fails the export rather than producing a silent substitute. This is support for an existing audio/voiceover file, not a new microphone recorder or an entitlement to commercial music.

## Failure and lifecycle behavior

- Cancel, closing/unmounting, account/clip replacement, hidden tabs, active calls, other media interruptions, unavailable source media, stalls and size limits never offer a partial movie as a finished download.
- Export preparation and resource loading have deadlines. Progress distinguishes preparation, recording and download finalization. Errors retain the chosen settings for a retry; memory-media refresh remains available.
- Media tracks stop, Web Audio contexts close, WebGL renderers and decoded images are released, object URLs are revoked on exit, and late work cannot publish a result after its owner or component changes.
- A missing media capability is an error. Existing live bucket access and cache policy are unchanged by this local export feature.
- A caption or text page that overflows its allocated movie frame is refused with the memory number. The exporter does not silently shorten that text.
- Every captured image asset is inspected by its bytes before being embedded, including primary photos, photo stickers, CSS backgrounds and data/blob URLs. Each image has a **32 MiB read limit and a 20-second overall deadline**; absent or inaccurate `Content-Length` headers cannot bypass the byte cap. Cancellation closes an in-progress image reader and aborts its fetch.

## Unsupported compositions remain explicit

The complete movie is refused when any required page has an unsupported element. No page is quietly skipped.

| Case | Current result |
| --- | --- |
| GIF, animated PNG/WebP, animated sticker or animated text | Refused; static rasterization is not presented as an animation export. GIF remains excluded even when single-frame. Static PNG/WebP remain supported. |
| Second camera / dual-front source | Refused; the second camera is not discarded. |
| Video embedded inside another memory | Refused. |
| Shared-post card over another memory, or multiple shared cards | Refused because the film frame does not yet compose these cards. |
| Shared primary post with its own media-edit/playback recipe | Refused rather than losing that recipe. A simple authorized primary shared image/video can be used. |
| Saved added story audio or an album catalogue soundtrack | Refused because export rights/ownership and the active release pipeline cannot be verified. |
| Missing original, excessive length/artwork/size, or overflowing text | Refused with recovery guidance. |
| Licensed commercial music catalogue | Still excluded. `MUSIC_CATALOG_ENABLED` remains `false`. |

The player’s optional photo zoom and entrance transition are not included in the movie. A downloaded video renders interactive cards as supported static artwork; it does not make links or polls interactive inside a file. This implementation does not establish native Photos export, Safari/MP4 behavior, physical iPhone compatibility, HDR/HEIC correctness, revoked-URL cache behavior or production erasure.

## Defects caught by actual encoding checks

The first movie integration produced valid video/audio streams while the captured DOM artwork was transparent. Computed styles contained logical `inset-inline` offsets from the hidden capture surface. Resetting only physical `left`/`top` left the clone positioned at −20,000 px inside its SVG. The shared web capture now clears both physical/logical inset declarations before normalizing the root. This fixes the offscreen capture used by both memory and story exports. The story browser fixture now deliberately places its artwork offscreen to keep that regression covered.

The next decoded-audio assertion caught automatic compressor makeup gain changing the author’s saved volume. A unity-gain ceiling replaced that compressor. Source sound is now measured at its selected level, and local/existing tracks are checked independently by frequency.

WebM duration finalization now accepts an explicit, finite movie duration limit. Its story default remains 180 seconds. A regression verifies a 240-second movie header with the explicit limit, while the same duration without that limit and unbounded limits remain rejected. Encoded content is not rewritten.

The final independent review found that ordinary photo uploads could contain animated PNG/WebP bytes, while the original export guard checked only GIF filenames and sticker animation metadata. The shared image capture now parses actual PNG/WebP container chunks and rejects animation before recording. It checks PNG animation-control/frame chunks, the WebP animation flag and animation/frame chunks, and GIF headers regardless of filename or MIME label. Truncated or invalid container lengths are rejected rather than skipped. Checks follow the [W3C PNG specification](https://www.w3.org/TR/png/#acTL-chunk) and [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container). Matching text inside static metadata is not mistaken for an animation chunk.

## Evidence and verification

All media fixtures are generated colors, text and sine waves, plus the repository’s original score. No personal account or staff content appears in the evidence.

The full movie browser receipt has five actually decoded outputs and five cancellation/failure cases, plus the unsupported-composition and mobile navigation checks. A focused final receipt adds the overlong-caption refusal and checks the first trimmed video frame. Together these cover:

- Five complete 720 × 1280 movies of approximately 7.00 seconds: original sound, silent, original score, local voiceover once, and local voiceover looped.
- Pixel checks for the first photo, a green sticker appearing only during its saved window, the following video’s half-bright red/blue grade, the omitted white pre-trim introduction, and the final text-page background.
- Frequency/level checks separating the source 880 Hz tone from the added 440 Hz recording. Original audio appears only in its video page, the added recording starts from the chosen offset, and once/loop behavior differs as selected.
- Cancel, call interruption, hidden-tab policy, unmount, missing media and overflowing text produce no download and leave tracks/contexts closed. The hidden-tab case dispatches the real browser event with a synthetic visibility state; it is not a physical-device background test.
- Eight unsupported-input checks, mobile width/overflow, opening download from the film, Escape/back behavior and deliberate resume after exit.

The extended story browser run passes **8 cases**, including mixed original/local audio, local-only audio while the original is muted, bad-audio rejection, offscreen timed artwork, delayed recorder start, oversized final chunk rejection and cancellation. Five of those produce files decoded by `ffprobe`/`ffmpeg`; the three negative cases produce no accepted file.

The image-guard browser run passes **19 cases** with zero uncaught errors. It repeats all five audio variants and adds a sixth decoded movie with real static PNG/WebP files served under different filename extensions. Decoded pixels confirm that the static primary photo and timed WebP sticker survive inspection. Real two-frame APNG, WebP and GIF fixtures in primary-image, photo-sticker and CSS-background positions, plus an animated data URL, are rejected before a recording is created; no download appears and all media resources close. Cancelling while an image body is partly received aborts that read and produces no file. These are synthetic browser checks, not tests of a physical device or production media access.

The corresponding **12 byte-level tests** cover real static/animated image containers, nonzero byte offsets, filename/MIME mismatch, data/blob URLs, truncated and oversized container lengths, missing animation-control metadata, false-positive text inside metadata, declared/streamed size limits, pending-read cancellation and the overall deadline. The six original 8 × 8 fixtures and their generation instructions are in `web/tests/fixtures/export-images`.

After the final cancellation cleanup, the focused image-guard browser run passes **8/8 cases**, and the shared story-export browser run again passes **8/8 cases**. Its test-only module inventory now includes the image inspector and checks import-time browser errors before starting encoding. The production capture helper, inspector and updated React fixture pass scoped ESLint with no errors or warnings.

Browser: Chrome for Testing **156.0.8078.80**. Verified recordings used VP9/Opus WebM. Zero uncaught browser errors in the movie runs. MP4 remains selected only when the actual browser reports support and has not been established by this Linux Chromium run.

Additional source checks passed: web TypeScript; 27 story ownership/publication regressions; 10 film behavior tests; 6 film lifecycle tests; 20 story quality tests; 5 WebM duration tests. The requested admin diagnostics test adapter now recognizes the icon component; all 8 diagnostic/retry/redaction tests pass with their behavioral assertions unchanged.

### Review files

- [Movie browser receipt](memory-export-20261030/browser-receipt.json)
- [Final trim/text-guard receipt](memory-export-20261030/guard-browser-receipt.json)
- [Image-animation browser receipt](memory-export-20261030/animation-browser-receipt.json)
- [Final image-inspection cleanup receipt](memory-export-20261030/animation-final-browser-receipt.json)
- [Shared story export after image guard](memory-export-20261030/animation-story-browser-receipt.json)
- [Image-animation refusal screenshot](memory-export-20261030/animated-image-refused.png)
- [Image byte-level test receipt](memory-export-20261030/animation-byte-tests.txt)
- [Story browser receipt](memory-export-20261030/story-browser-receipt.json)
- [Desktop download options](memory-export-20261030/download-options.png), [download ready](memory-export-20261030/download-ready.png), [mobile dialog](memory-export-20261030/download-mobile.png)
- [Decoded photo with timed artwork](memory-export-20261030/decoded-photo-artwork.png), [decoded video grade](memory-export-20261030/decoded-video-grade.png)
- [Actual synthetic movie with a looped local recording](memory-export-20261030/synthetic-memory-movie.webm)
- [Actual synthetic movie with the original score](memory-export-20261030/synthetic-memory-score.webm)
- [Actual synthetic edited story with added recording](memory-export-20261030/synthetic-story-with-voiceover.webm)

### Reproduce

```sh
node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json
STORY_QA_CHROME=/path/to/chrome node web/tests/browser/memory-movie-export.cjs
STORY_QA_CHROME=/path/to/chrome node web/tests/browser/story-video-export.cjs
node web/tests/memory-film.cjs
node web/tests/memory-film-lifecycle.cjs
node web/tests/story-owner-regressions.cjs
node web/tests/story-quality-regressions.cjs
node web/tests/recorded-webm.cjs
node web/tests/export-image.cjs
node tests/client-diagnostics.test.cjs
```

Both browser fixtures start a loopback-only server and need Chromium plus ffmpeg/ffprobe. `MEMORY_QA_OUTPUT`/`STORY_QA_OUTPUT` choose their evidence directories. `MEMORY_QA_CASES=original,overflow` runs a focused guard check. The fixtures are test-only entries, not an application route or authentication bypass.

`MEMORY_QA_CASES=static_images,animated_primary,animated_sticker,animated_background,animated_data,image_inspection_cancel` selects the new image-guard checks (along with the fixture's always-run unsupported-composition and exit checks).
