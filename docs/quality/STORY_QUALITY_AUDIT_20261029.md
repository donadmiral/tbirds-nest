# Story quality investigation — 29 October 2026

## Release status and evidence limits

This is source work on `codex/app-quality-20261029`. No EAS build, TestFlight submission, App Store submission, or device installation was performed for this pass. The existing installed iPhone app does not contain these new client fixes. The user has explicitly kept TestFlight on hold until the app is satisfactory.

The investigation follows the actual native and web source, production RPC contracts supplied by the contract audit, deterministic interaction tests, and real Skia pixel rendering. It does not certify every physical touch gesture, camera, Photos permission, notification, video decoder, or signed-in production journey. The tests use synthetic identities and adapters: no real story, answer, notification, or message was sent during this lane's verification.

## Reported issues and repairs

| Area | Cause found | Change | Verification and remaining acceptance |
| --- | --- | --- | --- |
| Shared post disappears when Text is opened | The native text editor painted a fresh opaque background over the composition. A shared-post card could also enter the generic text editor; its intentionally empty metadata `text` field could be interpreted as deleting the sticker. | Keep the composition visible behind the text sheet. Text editing accepts text stickers only. Shared-post/story cards open placement actions instead. Empty text can remove only the selected text sticker. Functional updates preserve concurrent stickers. The web editor also separates reference-card placement from text editing. | Actual native handlers preserve cards and concurrent changes. Actual web editor tests preserve cards through text add/cancel and placement editing. Physical keyboard and small-screen visual acceptance remains required. |
| Text-only post becomes a blank story | Native share construction copied `content` only, although text could be stored in `body`; the card layout also budgeted unnecessary photo space. | Use `content || body`; keep title/caption and source/author links. Text-only cards have a readable card surface, up to eight visible caption lines, and no empty media rectangle. | Shared-post rendering/geometry and post-share tests pass. Test a real long text post and an article title on iPhone before release. |
| Brightness and other image adjustments appear ineffective | The native slider could ignore simple track taps. Framing replaced the transform and discarded the adjustment/trim/sound recipe. The viewer parser also discarded most of the stored recipe. Several image effects were translucent approximations rather than pixel changes. | Taps seek on the slider; drag reaches both endpoints. Framing merges only framing fields into the latest recipe. Playback parses the full bounded recipe. Native photos use the installed Skia color matrix; web photos use the same sRGB matrix through SVG. Brightness, contrast, saturation, warmth, tint, highlights, shadows, fade and filters change real channels. Grain/vignette remain spatial overlays. | Seven tests render Skia pixels and read RGBA output, including darker/brighter photos, true monochrome, tonal changes, every filter and intensity. State tests verify crop preserves grade, trim, speed and sound. Real iPhone canvas, wide-color/HDR images, HEIC orientation and Photos output still need visual acceptance. |
| Filter thumbnails do not match the image | Native thumbnails used only the old color-overlay preview. | Photo filter tiles use the same pixel renderer as the composer and viewer. The renderer catches download/decode failures, exposes Retry, reports readiness for image export, and releases decoded images on disposal. | Pixel tests plus typechecking pass. Device memory/performance with a large photo and the full filter sheet is still a device check. |
| Stickers appear one per row | The width calculation did not fully account for sheet spacing/borders and relied on wrapping. | Render explicit two-item rows with bounded widths. An odd last item keeps its half-row position. | Existing studio/gallery accessibility and interaction tests pass. Drag, pinch, rotate and delete remain the existing gesture paths and need physical multi-touch acceptance. |
| Save does nothing for text/shared-card stories and saves an unedited photo | The old action required an original local media URI. | Image/text Save captures the artwork-only composition as a 1080-pixel-wide PNG, including edits, shared cards, drawings and stickers. Toolbar controls are hidden before capture. It waits for photo readiness, refuses failed/loading photos, deduplicates taps, fences permission completion against account/draft changes, and releases the temporary capture. | Actual save callback tests verify text composition export, intended dimensions, readiness/error paths, ownership changes and cleanup. The native Skia/view-shot capture itself must be checked in Photos on a real iPhone. |
| Video editing claims more than the player supports | The native video player cannot apply the new photo pixel grade or export a combined edited movie. Old sliders could create a misleading approximation. | New color-filter/adjustment controls clearly identify that video color editing is unavailable. Crop, trim, speed, drawing, stickers and original audio controls remain usable. Legacy stored looks remain readable. “Save original video” explicitly saves the source and explains that composed video export is unavailable. | The tested save handler cannot label a raw video as an edited export. Full video color grading and composition/export are unfinished features and remain a release decision, not a verified fix. |

## Additional defects found and repaired

### Sticker contracts and response loading

Native `getStickerSummary` called nonexistent `get_sticker_response_summary`. It now calls the production contract `get_story_sticker_summary` with the correct story/sticker arguments. Failed owner-response and personal-response reads now reject instead of masquerading as an empty list or no answer. The viewer and response sheet expose retry, and late results are fenced when the selected story changes. The unused missing `send_sticker_notify` call was removed; this work did not create a broad notification backend.

### Add yours publication

Opening Add yours previously attempted to register `joined` before a new story existed. The production response function requires the ID of a story owned by that viewer. Cancellation could therefore either fail silently or appear joined prematurely.

The native action now only opens a seeded composer. After native publication confirms the saved story, a checked idempotent response links that story to the original prompt. If that response is not confirmed, the draft identifies the partial success and retries the same saved story instead of creating another. The existing native publisher uses several checkpointed requests; this repair does not falsely claim native publication is one database transaction. The web `publish_story_v2` contract already joins the prompt in its story transaction.

Tests verify cancellation makes no join, a failed join retains the original story, and retry links that same story ID. A separate missing-field bug is fixed: speed-only native media edits now persist even when every framing field has its default value.

### Countdown reminders

Permission denial, invalid/past dates, schedule failure, and database failure no longer lead to a success indication. A deterministic reminder ID includes viewer, story and sticker. Repeated taps reuse an existing device reminder. A newly scheduled reminder is canceled if recording the response fails or returns no confirmation. Previously recorded responses count as an active reminder on this device only when the scheduled local notification is still present and permission remains granted.

The ports are tested for ordering, cancellation, denial and deduplication. Actual notification delivery, permission changes in iOS Settings, and behavior across app reinstall require device checks.

### Question, quiz and slider submissions

A failed question send previously cleared the answer and closed its sheet. It now preserves both, releases the sending state, and displays the failure. Same-tick duplicate taps share a guard. Question/choice results from an earlier account or story cannot update the current story. Quiz and slider state follows the confirmed server response, including an existing answer returned by an idempotent request. Errors are visible instead of only being logged.

### Owner story settings

Owner switches previously updated the UI immediately and ignored PostgREST error/zero-row results. They now update only after a confirmed owner-scoped write. In-flight changes disable the switches; duplicate taps and stale completions are fenced. Tests cover explicit rejection, zero changed rows, duplicate taps, and account changes.

The existing viewer download action is now labelled **Save original media**. It no longer claims to save the composed story with stickers. Download failure is checked; temporary downloads are cleaned up; an old permission/download completion cannot save a newly selected story. Text stories explain that an edited image is saved from the editor.

### Media-theater contrast regression

Integration with the new semantic comment menu exposed a real white-on-white menu in the fixed-color media theater. The contrast test was updated to locate the current menu, which initially measured 1.00:1. The primary agent added a scoped dark menu background (`#15191d`), leaving ordinary comment menus theme-aware. Both light and dark theater calculations now pass the existing text/control contrast thresholds.

## Verification performed

Every listed test file was executed directly with `node file.cjs`; the totals count registered test cases, not merely child-file exits. This matters in this runtime because `node --test` initially reported file execution without the expected contained-case totals.

| Verified group | Registered cases | Result |
| --- | ---: | --- |
| Native/shared story, related post-editor and post-soundtrack suites | 152 | All pass |
| Web story suites | 115 | All pass |
| Media-theater contrast suite | 11 | All pass |
| Total selected lane set | 278 | All pass; no skips |

The 267 story/post cases ran across 26 files; the theater suite is an additional file. These overlap the primary agent's app-wide run and must not be added twice to the application total.

Focused new/expanded files:

- `tests/quality/story-editing-state.cjs`: 9 cases, including actual native editor callbacks, slider gestures and image-export orchestration.
- `tests/quality/story-photo-pixels.cjs`: 7 real Skia pixel cases.
- `tests/quality/story-engagement-quality.cjs`: 9 cases, including reminder ports, actual native answer callbacks, settings writes and canceled Add yours.
- `tests/quality/story-publication-regressions.cjs`: 25 cases, including the actual native service/orchestrator and saved-story Add yours retries.
- `web/tests/story-editor-post-fit.cjs`: 15 cases, including shared-post fitting and text/reference editing separation.
- `web/tests/story-owner-regressions.cjs`: 27 cases, covering account/draft/upload/publication isolation.
- `web/tests/theater-contrast-regressions.cjs`: 11 compiled CSS/contrast cases.

Native and web TypeScript checks pass. `git diff --check` passes. Logs from this pass are recorded by the release owner; temporary execution logs are not production telemetry or device evidence.

## Before any future TestFlight release

1. On the actual iPhone, share a photo post and a text-only post; open Text, type, cancel, reopen, add text, move the card, resize, rotate, and share. Confirm no original card disappears and the published view matches the draft.
2. Apply every photo adjustment at negative, neutral and positive values; switch crop/fit, cancel and reopen the tools; publish and reopen in both native and web viewers. Compare the edited PNG in Photos with the composer, including shared cards and photo stickers.
3. Try short/long/portrait/landscape videos, mute, speed, trim, timed text, next/back and background/foreground. Confirm the interface makes unsupported color grading/composed export clear. If those capabilities are required for the complete app, implement and validate them before release.
4. Test the two-column sticker sheet on a small and large iPhone, Dynamic Type, VoiceOver, keyboard presentation, and reduced motion. Verify physical pinch/rotate/delete gestures.
5. Test failed uploads, offline sends, expired media capabilities, denied Photos/notification permission, and returning from Settings. Drafts and confirmed settings must remain accurate.
6. Use two authorized accounts to verify question/quiz/slider responses, owner-only response details, countdown delivery, Add yours publish/cancel/retry, and each story privacy control.
7. Verify camera/lenses on actual hardware with the production provider entitlement. Provider configuration alone is not evidence that camera capture or all lenses work.
8. Keep licensed music unavailable until the catalogue/rights/provider work is complete. This lane did not enable a music catalogue or verify audible licensed soundtrack playback. Continuous memory playback and exported memory movies are assessed separately in the profile/memory audit.

These acceptance items are intentionally not marked complete by static tests. TestFlight remains on hold.
