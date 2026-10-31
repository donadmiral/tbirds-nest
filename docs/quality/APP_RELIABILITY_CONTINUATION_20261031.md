# App reliability and performance continuation

This report records the continuation of the app-wide reliability, navigation and
native acceptance work. It separates implemented changes, observed results and
remaining release gates. It does not claim that every product feature or every
physical-device flow is complete.

## Current published repair candidate: f4c35f32 (v6)

Repair-cycle progress: **5 of 6 milestones complete**. The remaining milestone
is complete installed-app acceptance on iPhone Simulator and Android Emulator.
This is a milestone count, not a whole-product completion percentage. The
[review checklist](https://github.com/donadmiral/tbirds-nest/pull/3) and
[workflow history](https://github.com/donadmiral/tbirds-nest/actions/workflows/native-app-ui.yml)
remain available independently of the chat connection.

The reviewed v6 checkpoint is now published as application/PR head
[`f4c35f32795be5f196840c37382143a2d7e33d55`](https://github.com/donadmiral/tbirds-nest/commit/f4c35f32795be5f196840c37382143a2d7e33d55).
Its current PR merge is `6f3204cd44996dfe66ffe2dcf7192543805aa912`; both have the
verified tree `7699f995aa8e5192658f785258eb48f408af6a39`. The four repairs below
are included in that source. The earlier isolated checkpoint is preserved in
its history; it is no longer merely a proposed follow-up.

All four supporting workflows on this published source have now completed
successfully: [type/quality](https://github.com/donadmiral/tbirds-nest/actions/runs/41211437271),
[browser interaction/media](https://github.com/donadmiral/tbirds-nest/actions/runs/41211437263),
[Android compilation/encoders](https://github.com/donadmiral/tbirds-nest/actions/runs/41211437311)
and [iOS compilation/encoders](https://github.com/donadmiral/tbirds-nest/actions/runs/41211437309).
The Android job in
[complete-native run 41211437305](https://github.com/donadmiral/tbirds-nest/actions/runs/41211437305)
has now finished with **failed acceptance after emulator host loss**. Its
16-minute-14-second native build succeeded. Home, Market, Jobs, Messages and both
Profile content assertions passed, with five actual page screenshots retained.
The first scroll toward View all memory books then lost the device transport;
no shelf-link tap, film, book settings or export acceptance was reached. The
host shell explicitly reported an emulator-process **SIGSEGV**. The retained
logs do not identify the faulting component or establish an application cause.

The new centering option was present in the executed scroll command, but the
lost device prevented testing the subsequent tap. All four exported auth and
fixture snapshots are empty, and no failure hierarchy or screenshot could be
captured after transport loss. This run supplies no fresh timer, request-count,
saved-account-readback or capture-cleanup acceptance. The separate required
capture invocation was attempted and reported that the emulator was not
connected; no capture or movie resulted. The failure gates remain intact.

The current iPhone job also finished with **failed acceptance at 15:34:36 UTC**.
Native compilation and simulator signing passed. Main-page navigation through
Profile, centered memory-shelf entry and the exact book-card assertion passed.
After that card was tapped, the required reader assertion failed on a real
loading spinner. The separate capture heading also failed to appear; its
failure screenshot shows the later-loaded book cover. Both required Maestro
invocations produced testcases. Complete installed-app acceptance and milestone
6 remain open. The earlier `6878c384` failures remain under their own source
identity below.

### Fresh supporting verification on published f4c35f32

| Gate on the current source | Observed result |
| --- | --- |
| Root regression CI | **1,771 passed**, zero failures, cancellations, skips or todos |
| Web and operations regressions | **683 and 195 passed**, with no failures or skips |
| TypeScript and Edge | All three TypeScript stages passed; two Edge TLS cases passed |
| Backend fixtures | **314 Node and 883 RPC cases passed**, with three conditional skips in each mode; all six skipped cases have passing counterparts |
| Browser UI | **131 journeys passed**: 37 admin, 41 web, 25 commerce, 25 Studio and three real-Next journeys |
| Browser media and layouts | 12 story, 25 memory, five music and five cover-editor cases passed; 288 layouts had no measured overflow or overlap; CI reported 18 encoded outputs |
| Standalone native encoders | **58 passed**: 39 Android, eight iOS story and 11 iOS memory cases |
| Standalone unsigned native compiler jobs | Android and iOS passed in **721 and 872 seconds** respectively |
| Complete installed native apps | Android failed after confirmed emulator-process SIGSEGV; iPhone failed reader-readiness and capture-entry assertions; milestone 6 remains open |

The root CI total includes one file-level wrapper for the standalone auth
program. It therefore reports **1,771 cases**, while the unchanged final local
gate records **1,770 formal cases plus the separate 33-check auth program**.
Those counts use different reporting methods and are not added together.

The fresh browser archive digest and 24 source hashes were verified. The actual
Next route probe retained navigation across **163 sampled frames**, including
43 fallback frames, with zero frames without navigation. Warm Home, Messages,
Jobs and Profile fixtures reported zero blank-content frames. Home's first
observed destination frame was **202.6 ms**, with a maximum sampled interval of
183.4 ms in this CI run. These retained values are scoped to synthetic component
routing or the local development App Router; they do not measure production
network latency, device GPU frame times or universal app speed. The browser job
completed in 444 seconds and its real-Next step in 13 seconds. Its movie binaries
were not retained in the archive, so this review did not independently decode
the 18 CI outputs again.

Fresh standalone encoder counts come from the completed authenticated job logs
and their required harnesses. Their current archives were not downloaded or
independently decoded by the reviewer. Of 65 compared native engine, harness,
dependency and configuration files, 64 match `6878c384`; the sole change is the
reviewed TypeScript movie-request bridge. The Swift/Kotlin engines and standalone
harnesses are unchanged, and their successful direct tests do not establish the
repaired installed-app JavaScript-to-native handoff.

Both unsigned compiler jobs also passed. The Android log supplies the current
checkout and native-source postflight. The iOS result is bound to completed
workflow/job metadata and the exact source/configuration; its current archive,
receipt and compiled-object hashes were not independently opened. Compiler and
encoder gates do not establish complete app navigation, saved-account readback,
Photos save, a signed release build or physical-device acceptance.

The fresh hosted QA checks at **14:53:56 and 14:54:01 UTC** still show the exact
stage-3 catalogue and migration history. They do not resolve either original
stage-4 invocation's unknown terminal outcome. Dependent activation remains held,
and commercial music licensing remains disabled, as described in the hosted
backend section.

[Current publication and source binding](live-app-20261031/publication-f4c35f32.json) ·
[Fresh quality receipt](live-app-20261031/ci-quality-f4c35f32.json) ·
[Fresh browser receipt](live-app-20261031/browser-quality-f4c35f32.json) ·
[Fresh standalone encoder evidence](native-full-app-20261031/native-encoders-f4c35f32-status-and-source-equivalence.json) ·
[Fresh compiler evidence](native-full-app-20261031/native-compile-f4c35f32-status.json) ·
[Current hosted postflight](live-app-20261031/backend-stage3-postflight-f4c35f32.json) ·
[Current Android full-app result](native-full-app-20261031/android-full-app-f4c35f32-review.json) ·
[Current Android navigation evidence](native-full-app-20261031/android-f4c35f32-navigation-independent-review.json) ·
[Current emulator host-loss investigation](native-full-app-20261031/android-full-app-f4c35f32-emulator-disappearance.json) ·
[Current iPhone full-app result](native-full-app-20261031/ios-full-app-f4c35f32-review.json) ·
[Current iPhone navigation evidence](native-full-app-20261031/ios-f4c35f32-navigation-independent-review.json) ·
[Current iPhone auth coverage](native-full-app-20261031/ios-f4c35f32-auth-independent-review.json)

### What the current iPhone run established

The current iPhone archive was downloaded once and checksum-verified. All 496
original source hashes, six retained overlays and nine installed dependency
hashes match `f4c35f32` and its tested merge. Its source manifest is byte-identical
to the current Android manifest. Embedded simulator entitlements and host
signature verification passed; this does not establish a signed-device build.

The centered shelf control, Private selection and exact two-memory book card
passed. The card tap targeted its actual bounds. The subsequent failure
hierarchy contains an activity spinner and no Edit memory book control; its
screenshot confirms the reader loading branch. The source still awaits auth,
the authorized book, media hydration and an optional reaction query before
clearing initial loading. The retained request counts have no per-request
completion timing, so they do not identify the unfinished stage. No selector,
keyboard, settings-modal or deadline correction is established by this result.

The capture invocation started its driver and produced a testcase. Its URL
command completed, the exact iOS handoff-prompt conditional was skipped, and
the mandatory capture heading failed. The saved hierarchy and image show the
loaded book cover with its real reader controls. There is no retained direct
JavaScript URL-received, action-produced or capture-mount event. A successful
Maestro URL command alone cannot establish those boundaries. No completed
saved-account reread or movie capture is recorded; that absence does not prove
whether the capture effect briefly began. The source and exact assertions are
preserved, and the cause of the missed capture entry remains unresolved.

The auth snapshot extends through **15:34:01.707 UTC**, after both flow attempts.
It reports 419 operations, 1,024 retained events, 178 dropped middle events and
zero tracking drops. Final active locks, waiters and storage operations are
empty. The retained capture interval has 258 events covering 86 operations,
with observed maximum lock wait/hold times of 3.767/78.747 ms and no matching
acquisition warning. These bounded observations do not prove the maximum over
dropped events or identify the reader/capture cause. Cumulative profile,
shelf, book and reaction reads are two each; the earlier profile request-storm
pattern is absent from these counts.

### Saved Android runner follow-up

The reviewed follow-up is saved separately at
[`f4ee61a3`](https://github.com/donadmiral/tbirds-nest/commit/f4ee61a3d3e991e5a8c442e36f2c9ef53a8bcf1b),
with all 20 source/evidence files read back and verified. It has not been
published to the app/PR branch or exercised in a new emulator run. The sole
launch-argument change selects documented `swiftshader` instead of adaptive
`software`. Guest Vulkan, the API 35 image, memory allocation, workflow,
both flows, decoder gates and deadlines remain intact. This is an empirical
renderer-isolation step; no faulting component or crash cure is established.

The follow-up also retains version/help output and bounded current-run
Crashpad evidence on a best-effort basis. Diagnostics cannot replace the
required acceptance result. Its current-user/version store is not a unique
per-PID namespace, and the recorded cleanup-entry status is not the final
workflow verdict under signal cancellation. These limits are explicit in the
receipts. The five changed runner, helper, provenance and test files passed
52 focused cases: 37 collector/shell cases and 15 existing auth/source-manifest
cases. An independent review repeated the 37 cases and separately checked two
real SIGTERM probes. No additional full root suite or emulator pass is claimed.

[Runner follow-up and focused evidence](native-full-app-20261031/android-emulator-renderer-isolation-repair.json) ·
[Independent runner review](native-full-app-20261031/android-emulator-renderer-isolation-independent-review.json)

### What the Android baseline established

The Android job completed with **failed acceptance** at 07:26:32 UTC. The
emulator remained available through both required Maestro flows and evidence
collection, and then shut down normally. This run does not repeat the earlier
emulator-process SIGSEGV. All 496 source-manifest entries, six overlays and nine
installed dependency hashes were checked against the published baseline.

Home, Market, Jobs, Messages and Profile content checks passed. The memory-shelf
entry then failed: Maestro tapped the exact View all memory books control at
`(282, 605)` on a 320×640 screen, inside the Android system navigation container
at y592–640. Its raw visibility check had accepted the obscured control. The
screen stayed on Profile, so the following Private tab was absent. That
establishes a masked tap target; it does not exclude the separate request storm
observed during the same interval.

The auth trace retained stable timer API identities, but it also recorded a
31.5-second lock hold and eight real five-second acquisition warnings. The
fixture recorded 280 profile reads and 279 shelf reads. Installed Navigation
hooks and the actual Profile completion callback reproduce a feedback path:
publishing a profile changed the inline unhandled-action callback, recreated
navigation helpers and restarted focused reads. Stable timer identities do not
make these warnings harmless, and the bounded trace does not cover every event.
The existing saved-account readback did pass for one reloaded QA account.

The independently required capture flow also ran and failed. Its cancellation
cycle stopped an actual 1,024-byte media read and cleaned its owned files; the
retry produced 12 real PNG captures, then failed at `composeMemoryMovie` with
`Cannot convert '[object Object]' to a Kotlin type`. No MP4 was produced. The
installed Expo converter and actual request factory identify a concrete nested
`undefined` representability defect. Retained photo and sticker pixels also
show partial image fading during capture; the photo's four interior quadrants
fit a common opacity of about 0.213 over their background, with at most one RGB
level of residual. The required flow and media verifiers remain failed.

[Android flow, source and capture receipt](native-full-app-20261031/android-full-app-6878c384-review.json) ·
[Independent auth and account-readback review](native-full-app-20261031/android-6878c384-auth-independent-review.json)

### What the preceding iPhone baseline established

The iPhone job in
[run 41179235060](https://github.com/donadmiral/tbirds-nest/actions/runs/41179235060)
finished with **failed acceptance at 08:13:06 UTC**. Native compilation and
simulator signing succeeded. Home, Market, Jobs and Messages checks passed;
the exact Alex Rivera assertion failed after the correct Profile tab was tapped.
The later failure screenshot visibly shows that name, and its accessibility
tree contains two exact matching labels with Profile selected.

The retained screen recording changes from Messages at presentation timestamp
456.926667 seconds to visible Profile/Alex Rivera at 456.970000 seconds. Its
creation tags are consistent with the logged tab tap, but are not a calibrated
latency anchor. The saved failure hierarchy and screenshot were collected after
the failed lookup; the matching polls' actual hierarchy payloads were not
retained. This evidence does not demonstrate an incorrect selector or a late
blank Profile. The exact assertion and its existing deadline remain unchanged.
The memory shelf is still a skeleton in the retained Profile evidence. The
auth/fixture snapshot ends before the Profile tap, so its stable timer identities
and bounded waits cannot establish what happened afterward or rule out a later
read-feedback problem.

The separately required capture CLI was attempted once but failed during iOS
driver startup, before a capture testcase or JUnit report existed. Memory-reader,
film/export, settings, saved-account readback and movie acceptance were not
reached. The retained navigation MP4 is a simulator screen recording, not an
exported memory movie. This older run cannot validate the published modal repair
or show whether the newer navigation-handler repair resolves the Profile symptom.

After transient workspace loss, the original artifact was recovered with the
same verified ZIP digest. Its raw evidence and source bindings were restored.
The auth review was reproduced byte-identically; the navigation and owner
receipts explicitly identify themselves as regenerated and retain their original
hashes as historical provenance. Recovery is not a new installed-app test.

[iPhone flow, source, signing and capture-startup receipt](native-full-app-20261031/ios-full-app-6878c384-review.json) ·
[Independent navigation and recording review](native-full-app-20261031/ios-6878c384-navigation-independent-review.json) ·
[Independent auth coverage review](native-full-app-20261031/ios-6878c384-auth-independent-review.json)

### Four published repairs and their acceptance limits

| Repair | Resulting behavior and retained boundaries |
| --- | --- |
| Stable navigation callback | A stateless module-level handler prevents profile publication from changing Navigation's helper identity. Genuine blur/refocus refresh, session/ABA root keys and the original type-only diagnostic behavior remain. SDK locks and deadlines are unchanged. |
| Schema-exact movie request snapshot | The original request is validated, then every supported field is copied into a new native payload. Absent optional properties are omitted; zero/false values and artwork/timing/audio fields are preserved. Cancellation and result verification use that submitted snapshot. Unsupported animation and rights checks remain. |
| Full-opacity capture-aware images | Native images use `fadeDuration=0` when the existing readiness context is present. This includes the memory export preview and the StoryComposer visible snapshot/export-artwork canvases. Ordinary viewer/feed playback without that context and the graded Skia path retain their existing behavior. No wait or decoder threshold was relaxed. |
| Centered semantic shelf entry | The existing View all memory books scroll requests Maestro's `centerElement` behavior before the same named tap. Every prior command, selector, assertion, timeout and account-lifecycle operation is preserved; no coordinate tap was added. |

The final combined local gate passed **all 172 selected files: 1,770 formal
cases, zero failures, cancellations, skips or todos**, plus the separate
successful **33-check auth program**. The 19 new formal cases comprise six
bridge, five navigation-handler, five capture-readiness and three shelf-entry
cases. All 2,025 snapshotted inputs stayed unchanged through the 58.7-second
run. Full native TypeScript and the scoped lint checks passed.

Independent reviews accepted all four repairs. The focused tests execute
production components, the actual request/preparation code and installed
Navigation hooks using documented controlled hosts; the pixel checks decode
retained real Android images. They do not establish a new UIKit presentation,
full-opacity native capture, playable movie, Photos save, device speed or
warning-free auth trace. Milestone 6 remains open.

[Final v6 combined local gate](native-full-app-20261031/native-v6-final-root-regressions.json) ·
[Navigation feedback repair](native-full-app-20261031/native-navigation-focus-feedback-repair.json) ·
[Independent navigation review](native-full-app-20261031/native-navigation-focus-feedback-independent-review.json) ·
[Native bridge repair](native-full-app-20261031/native-memory-bridge-repair.json) ·
[Independent bridge review](native-full-app-20261031/native-memory-bridge-independent-review.json) ·
[Capture fade repair](native-full-app-20261031/native-memory-capture-fade-repair.json) ·
[Independent capture fade review](native-full-app-20261031/native-memory-capture-fade-independent-review.json) ·
[Shelf-entry repair](native-full-app-20261031/android-6878c384-shelf-entry-repair.json) ·
[Independent shelf-entry review](native-full-app-20261031/android-6878c384-shelf-entry-independent-review.json)

### Current hosted deployment binding

The current `f4c35f32` PR-branch web and admin builds were intentionally canceled
by their existing ignored-build steps. Their branch aliases still serve the READY
web `ab281bca` and admin `26e80ae9` deployments. Complete application, shared,
root package/lock and vendor Git objects match the published repair candidate,
so the earlier hosted observations remain applicable within their original
account and sample limits. No hosted journey was repeated for unchanged inputs.

The earlier builds from the isolated v6 branch at the same commit are recorded
separately as **ERROR**: their prebuild checks rejected missing required Supabase
environment variables before application compilation. No variable values were
retrieved, configuration changed or failed check bypassed. Source equivalence
does not establish environment or backend-data equivalence, and the current
ignored builds are not new successful builds at this SHA.

[Current deployment and input-equivalence receipt](live-app-20261031/deployment-review-f4c35f32.json)

## Published supporting baseline: 6878c384

The preceding follow-up is published at
`6878c384f4f2de8b4bcf2cf49e6597b250bd9bde`. Its tested PR merge is
`ba8d659c4b6172c1c4930cd6d348d627bdb1470f`; both have the verified tree
`bebc0e7bfa5a9a6b17e477a29b17fcd41c2ae27d`.
It combines the reviewed Android emulator correction, the exact iOS capture
confirmation, native film/export dismissal ownership, and two source-reproduced
QA capture setup repairs. It follows application head
`e173b2dbcf253342be5683fa85f102aa38065411` through the saved follow-up checkpoint
`a042acc7cf2ea2efaa690069162b2a2276414912`.

That baseline’s production change is confined to the film, movie-export
component and their shared dismissal hook. iOS retains each native modal while closing and completes
the parent handoff only after native acknowledgement. Playback/export cleanup
starts immediately. Duplicate, unmounted and old-account callbacks cannot
complete a later visit. Ordinary same-book refreshes preserve a legitimate
close. Android retains immediate completion because its Modal does not provide
the iOS acknowledgement.

The QA capture route replaces only navigation routes, removing a previous
screen-owned modal while keeping the existing app providers, stores, transport
and cumulative evidence. The fixture media adapter uses the installed public
Expo Asset API to materialize its three registered bundled assets on Android.
Actual installed JavaScript/router tests reproduce both previous mismatches.
No application/auth reset, new sign-in, network fallback, relaxed assertion,
longer deadline or production capability activation was added.

The baseline’s final local gate passed **all 169 selected files: 1,751 formal cases, zero
failures or skips**, plus the separate successful 33-check auth program. Its
formal cases include 21 new modal lifecycle, 13 new capture setup and five new
confirmation cases. The selected files and all snapshotted inputs stayed
unchanged through the run. Full native TypeScript, scoped lint, shell syntax
and whitespace checks passed. Independent reviews accepted the modal,
confirmation, asset and route changes.

The first restricted local run retained six failing file results: required
subprocess or loopback operations returned EPERM. That result is preserved.
The approved execution reran the identical source and assertions, using the
same per-file method and concurrency as the preceding verified local gate;
every file passed. Fresh root CI reports **1,752 passes** because it includes
one file-level wrapper for the standalone auth program. The local **1,751
formal passes plus 33 standalone auth checks** and the CI count describe
different reporting methods; they are not added together.

### Supporting verification on published 6878c384

The fresh [type and quality run](https://github.com/donadmiral/tbirds-nest/actions/runs/41179235474)
and [browser run](https://github.com/donadmiral/tbirds-nest/actions/runs/41179235074)
both completed successfully on the published source above.

| Gate on the published baseline | Observed result |
| --- | --- |
| Root regression CI | 1,752 passed; no failures or skips |
| Web and operations CI | 683 and 195 passed; no failures or skips |
| TypeScript and Edge | All three TypeScript stages passed; two Edge TLS cases passed |
| Backend fixtures | 314 Node and 883 RPC cases passed, with three conditional skips in each mode; all six skips have passing counterparts |
| Browser UI | 131 journeys passed: 37 admin, 41 web, 25 commerce, 25 Studio and three real-Next journeys |
| Browser media and layouts | 12 story, 25 memory, five music and five cover-editor cases passed; 288 layouts had zero measured overflow or overlap; CI reported 18 encoded outputs |
| Standalone native encoders | 58 passed, zero failures or skips: 39 Android, eight iOS story and 11 iOS memory cases |
| Standalone native compilation | Android and iOS Simulator passed in 620 and 957 seconds respectively |
| Complete installed native apps | Both Android and iPhone failed in [run 41179235060](https://github.com/donadmiral/tbirds-nest/actions/runs/41179235060), with the distinct evidence boundaries described above. Milestone 6 remains open |

The browser artifact ZIP digest and 24 source hashes were checked. The real
Next cold-route probe retained navigation across all 124 sampled frames,
including 43 fallback frames. Warm Home, Messages, Jobs and Profile probes
reported zero blank-content frames within their documented synthetic fixtures.
These observations establish visible continuity under the tested conditions;
they do not measure production network latency or physical-device/GPU speed.
The artifact retains reports, screenshots and logs rather than the encoded
movie binaries, so those movies were not independently decoded again.

The fresh encoder results come from authenticated completed CI logs and the
required platform harnesses. Their current archives were not downloaded or
independently rehashed. All 65 compared engine, integration, dependency and
harness/configuration inputs match the earlier source, supporting reuse of the
previous independent decoder evidence without claiming fresh binary equivalence.

Both standalone native compiler workflows also completed successfully. The
Android compiler log binds its checkout and postflight hashes to this source.
The single iOS compiler-log request returned `Transport closed`; its current
receipt therefore uses completed job/step status, exact run/head/tree binding,
unchanged-input checks and artifact metadata. It does not claim inspection of
the current iOS compiler archive.

Both current-source web/admin builds were intentionally ignored by the existing
build step. Their aliases still point to the READY web `ab281bca` and admin
`26e80ae9` deployments, with complete relevant application/shared/dependency
inputs equal to this candidate. The earlier hosted observations retain their
original scope; no repeated hosted journey was performed.

The published Android run now supplies real packaged-resource delivery,
saved-account readback and partial capture/cancellation evidence as described
above. Complete native settings/navigation, movie generation/save and
independent decoding still require successful installed-app acceptance. Passing
quality, browser and standalone encoder gates does not close that milestone.
The previous two-platform attempt below remains bound to its earlier source.

[Published source binding](live-app-20261031/publication-6878c384.json) ·
[Current quality receipt](live-app-20261031/ci-quality-6878c384.json) ·
[Current browser receipt](live-app-20261031/browser-quality-6878c384.json) ·
[Current deployment binding](live-app-20261031/deployment-review-6878c384.json) ·
[Current standalone encoder evidence](native-full-app-20261031/native-encoders-6878c384-status-and-source-equivalence.json) ·
[Current native compilation evidence](native-full-app-20261031/native-compile-6878c384-status.json)

[Final combined local gate](native-full-app-20261031/native-v5-final-root-regressions.json) ·
[Retained restricted-run result](native-full-app-20261031/native-v5-root-sandbox-attempt.json) ·
[Modal repair and source binding](native-full-app-20261031/native-memory-modal-dismissal-repair.json) ·
[Independent modal review](native-full-app-20261031/native-memory-modal-dismissal-independent-review.json) ·
[Capture setup repairs](native-full-app-20261031/native-capture-setup-repair.json) ·
[Independent capture setup review](native-full-app-20261031/native-capture-setup-independent-review.json)

## Previous complete two-platform attempt: e173b2db

Status snapshot: **2026-10-31 06:43 UTC**. Both complete-native jobs have
finished with failed acceptance. Android lost its host emulator process during
the first memory-book scroll. iPhone passed the main screens, shelf, two reader
pages, film and export entry, then failed settings presentation. Its independent
capture attempt was blocked by the exact iOS application-opening confirmation.
The iPhone script ran from 05:38:02 to 06:35:38 UTC, uploaded its evidence, and
the job finished at 06:35:56. The downloaded archive and its source hashes were
verified. Those failures led to the combined follow-up published above for the
next installed-app run.

That attempt used source `e173b2dbcf253342be5683fa85f102aa38065411`. Its tested PR
merge is `e6ca24e27b00207344eb7989ed53d2305cb04cf3`. Both have tree
`37ca8db90469d32a2a2d7b3069db54b522926530`. These identities were checked against
the fetched repository and the CI artifacts.

| Gate on that source | Observed result |
| --- | --- |
| Root regression CI | 1,713 passed; no failures or skips |
| Web and operations CI | 683 and 195 passed |
| TypeScript and Edge | All three TypeScript stages passed; two Edge TLS cases passed |
| Backend fixtures | 314 Node and 883 RPC cases passed, with three conditional skips in each mode; all six skips have passing counterparts |
| Browser UI | 131 scenarios passed; 116 real-Next transition samples retained navigation |
| Browser media and layouts | CI reported 18 encoded outputs and 288 cover layouts; the artifact retains reports rather than movie binaries |
| Standalone native encoders | 58 cases passed; artifact/source hashes and 57 media hashes and lengths verified |
| Swift and Kotlin integration | Both compilation jobs passed |
| Complete installed native apps | Both failed: iPhone settings presentation and capture-link confirmation; Android host emulator SIGSEGV. Complete navigation, account readback and capture remain open |

The final local root gate passed all 166 selected files: 1,712 formal cases plus
the separate successful 33-check auth program. CI counts that program as one
wrapper case, explaining the 1,713 CI count; overlapping counts are not added
together. All 43 new timer, tab-ID, content-selector and required-flow cases are
included.

The current native compile receipt records authenticated CI status and artifact
metadata, not a fresh download of the compiler archives. The encoder archives
were downloaded and checked separately. Full native navigation, saved-account
readback and actual capture remain separate gates. Both navigation and capture
must pass, even though each is attempted independently to retain useful evidence
after a failure.

Both exact-source web/admin builds were intentionally ignored by the existing
build step. The aliases retain the READY web `ab281bca` and admin `26e80ae9`
deployments, whose complete relevant input sets match this candidate. The hosted
journeys below remain attached to those unchanged deployed builds.

[Current quality receipt](live-app-20261031/ci-quality-e173b2db.json) ·
[Current browser receipt](live-app-20261031/browser-quality-e173b2db.json) ·
[Current deployment binding](live-app-20261031/deployment-review-e173b2db.json) ·
[Current native compile status](native-full-app-20261031/native-compile-e173b2db-status.json) ·
[Current native encoder evidence](native-full-app-20261031/native-encoders-e173b2db-source-equivalence.json)

### Android complete-app result and emulator follow-up

The current Android app built successfully in 15 minutes 41 seconds. Home,
Latest/For You, Market, the return to Home, Jobs, Messages and Profile/Edit
profile all passed their required assertions. Five retained screenshots record
the loaded main screens. The new stable tab IDs selected the application tabs,
and the exact grouped-content selectors passed.

The first memory-book scroll began at 05:54:12 UTC. The emulator then became
unavailable, and the authenticated job log reports PID 7041 terminating with
`Segmentation fault (core dumped)` for the emulator command. That establishes a
host emulator-process crash. No retained stack identifies the internal fault,
and no out-of-memory cause is established. Capture was attempted once but could
not start on the disconnected device. Both flows and both existing verifiers
remain failed; saved-account readback and native movie capture are unverified.

All 495 source-manifest entries and all six overlays match the published source.
The four attempted auth/fixture exports are empty after device loss. The retained
application log contains no match for the earlier auth-lock warning, but the
missing diagnostic events cannot establish stable timer IDs or lock durations.
Its skipped-frame notices also prohibit a native speed-pass claim.

The follow-up changes one emulator argument from the deprecated
`swiftshader_indirect` mode to the supported `software` selector. Android's
[current graphics documentation](https://developer.android.com/studio/run/emulator-acceleration)
identifies that deprecation and the supported modes. This is a bounded
configuration correction and a discriminating next run, not a proven cure for
the specific crash. Application code, acceptance assertions, device profile,
memory, timeouts and runner tier are unchanged. This correction is included in
the combined follow-up above and requires its fresh emulator run.

[Android flow/source failure receipt](native-full-app-20261031/android-full-app-e173b2db-failure.json) ·
[Independent Android auth-log review](native-full-app-20261031/android-e173b2db-auth-independent-review.json) ·
[Emulator crash and one-flag follow-up review](native-full-app-20261031/android-full-app-e173b2db-emulator-disappearance.json) ·
[Memory-flow source preflight](native-full-app-20261031/native-memory-flows-source-review-e173b2db.json)

### iPhone complete-app result and presentation follow-up

The verified iPhone archive contains 59 files and has SHA256
`06c1849b074c079ebc70b5032ed4b7f7289650064ef62408f06359921250b5b0`.
All 495 source-manifest hashes and all six source-overlay pairs match the tested
merge. The simulator signature, generated application identity and embedded
entitlements passed verification. Two actual account-index writes completed
without a retained keychain write error; the dedicated readback has not run.
The retained iPhone auth trace uses stable timer function identities across all
616 retained lock events. Its 153 settled locks and 204 settled auth-storage
operations fulfilled, with no operation still active in the final snapshot and
no captured acquisition-timeout warning. Coverage is partial: the bounded trace
retained 1,024 events and discarded 658 middle events. These results do not prove
all-operation coverage, Android timer acceptance or SecureStore readback.

Navigation passed Home, Market, Jobs, Messages, Profile, the private memory
shelf, both exact reader captions, reflective film, export entry, return to
Page 2 and closing the reader. Maestro then tapped the correct enabled Edit
memory book control. The following Book settings assertion failed after
19.6 seconds, before any keyboard interaction. The failure accessibility tree
and PNG show the cover, while retained video contains a translucent settings
sheet and the fixture recorded the settings editor's audience lookup. This
establishes inconsistent native presentation. It does not uniquely prove its
UIKit/Fabric cause. The implemented bounded repair completes native modal
dismissal before unmounting film/export or changing the underlying reader.
Focused lifecycle verification passes; the next native run remains required.

The independent capture flow attempted its deep link once but stopped at the
system confirmation `Open in “Platinum QA”?`. The target capture route never
mounted, so neither saved-account readback nor movie generation ran. The
follow-up handles only that exact prompt on iOS using its semantic Open button.
All 18 original capture commands and their required assertions remain intact.
Its five retained-evidence/condition cases and the existing 28 required-flow
orchestration cases pass locally. A passing capture, independent movie decode
and final full-app verifier are still required.

One earlier large job-log request returned `Transport closed`. That terminal
tooling error returned no log, was not retried, and does not establish the cause
of an app failure or of the user's chat connection interruption. The archive
supplied the bounded evidence above.

[iPhone full-app/source/signing review](native-full-app-20261031/ios-full-app-e173b2db-review.json) ·
[Bounded iPhone auth runtime review](native-full-app-20261031/ios-e173b2db-auth-runtime-review.json) ·
[Memory navigation evidence](native-full-app-20261031/ios-e173b2db-memory-navigation-review.json) ·
[Capture confirmation repair](native-full-app-20261031/ios-capture-open-link-repair.json) ·
[Independent confirmation review](native-full-app-20261031/ios-capture-open-link-independent-review.json)

## Preceding checkpoints

The preceding completed type/quality and browser CI checkpoint is
`26e80ae96647884e7f2764bdbb1884fd5aabcff5`. Its tested PR merge is
`6373021f8dcbb2bc614039e74937d2acb0ff2d3e`. Both have tree
`1c10d4cc20fcfd5a0d4e82ba0121c51e90274c03`. Complete native application
acceptance is tracked separately below.

### Published baseline and follow-up history

The additional native-tab, simulator-storage and cold-web-navigation repairs are
previously published at `ab281bcaab525331930f6238f97e46c169eee1ee`. The fetched PR merge
`f033c50196f6f5f115f451247073ccdb357025d4` has the same tree,
`8e03d00ee3cd707f4095134b5d5c0eec79f5ef19`.

The browser workflow is green, including the new actual-Next loading-navigation
gate. Web quality passed 683 cases, operations passed 195 and Edge TLS passed
two. The root CI suite passed 1,669 of 1,670 cases; its sole failure was a legacy
test harness without the installed React Native style flattener and valid tab
descriptors. The narrow test-only correction retains the original accessibility,
scroll and reduced-motion assertions and passes both the full local root suite
and the separate CI validation described below.
The dependent backend CI steps did not execute after that failure and are not
reported as successful. The correction is saved separately at
`9622cf3076e5eecd8aa14621ee8f5ad6dcc59ff6`, tree
`9bffd16d30397022e6530288475b28cb40783996`. Its one-file validation PR targets the
existing review branch and ran Type/quality without replacing the active native
builds. That run completed successfully: 1,670 root cases, 683 web cases, 195
operations cases and two Edge TLS cases. Its backend Node suite passed 314 cases
with three conditional skips, and isolated RPC TAP invocations passed 883 cases
with three conditional skips. All six skips have observed passing counterparts.
All three TypeScript checks passed. The checkout merge
`76254973415e4123a130647cdb7f1abc0843bf13` has the same tree as the test-only
candidate. Those CI results remain bound to that exact test-only candidate.

The unchanged-source backend fixtures also pass locally: 314 Node cases and 883
isolated RPC TAP cases, with three conditional skips in each invocation mode and
observed passing counterparts for all six. Local execution is recorded separately
from the skipped backend steps in the original CI run.

Complete native acceptance remains open. The iPhone job passed dependency
installation, built, signed, launched and passed Home, Latest and For You. Market
opened with the expected listing, but its exact child-title assertion failed:
iOS exposes the existing grouped card label `View listing: Travel journal`.
All five tab nodes are now present with 72 by 64 point bounds. The Android app
built and reached Market, establishing that the repaired tab geometry permits
the semantic Market tap. The subsequent ambiguous `Home` test selector selected
Android's system Home button and opened the launcher. The retained Maestro log
names `com.android.launcher3:id/home`, and the Android activity log confirms the
launcher transition. This is a test-targeting defect; it does not establish a
crash or a failed app Home transition. Stable app tab identifiers and the
source-reproduced Android timer-bootstrap repair are implemented locally for
the next acceptance attempt. After the subsequent content-selector and required
capture-flow follow-ups, the final combined local root gate passed all 166
selected files: 1,712 formal cases and the separate 33-check auth script. These
new changes are not covered by the earlier PR 6 CI result; fresh native and CI
results must be bound to the published follow-up source.

The current standalone iOS encoders passed all 19 story/memory cases, and both
full integration compiles passed. A separate Android encoder job stopped before
compilation because its emulator ZIP download was corrupt. One retry request
returned no GitHub result before the local wait was interrupted after 1,551.9
seconds. The 05:18:50 UTC metadata still showed only the original jobs. No remote
cancellation, successful retry or encoder acceptance is inferred, and no second
retry was issued.
These are distinct from the successful preceding source checkpoint above.

The verified `ab281bca` web deployment is READY. Admin's build was intentionally
ignored because its entire admin/shared/package input set is unchanged, and the
previous verified READY admin deployment remains in place.

[Current quality receipt](live-app-20261031/ci-quality-ab281bca.json) ·
[Corrected quality CI receipt](live-app-20261031/ci-quality-9622cf30.json) ·
[Current browser receipt](live-app-20261031/browser-quality-ab281bca.json) ·
[Current deployment binding](live-app-20261031/deployment-review-ab281bca.json) ·
[Test-only correction](https://github.com/donadmiral/tbirds-nest/pull/6) ·
[Independent local backend checks](live-app-20261031/backend-fixtures-local-ab281bca.json)

## Changes already implemented

| Area | Resulting behavior |
| --- | --- |
| Native startup | Saved-profile storage starts alongside authentication. Cached content remains hidden until its owner is established. Existing deadlines and session-generation checks are retained. |
| Session continuity | Ordinary token renewal preserves the navigator and warm content. Sign-out and genuine account/session changes invalidate old requests and caches, including A to B to A transitions. |
| Home and Messages | Warm navigation preserves content, scroll, conversation search and drafts. The story strip no longer produces the delayed layout movement found during review. |
| Native Profile | Cached posts are scoped to the current session. Refreshes retain the full loaded list, and delayed media work cannot replace newer captions or counts. |
| Jobs | Cached filters and rows are available on the first render. Results from an obsolete filter or account cannot replace the current list. |
| Notifications | Text and actions become usable before optional media decoration. Invitation cleanup follows actual invitation IDs and does not interpret a failed lookup as permission to remove invitations. |
| Chat | Authorized message history becomes usable before reactions, status and saved/starred metadata finish. Stale work is fenced by the active account and request generation. |
| Incoming calls | Early native answer/end events are replayed once. A final end event supersedes an earlier queued answer. Expiry, current recipient and session authorization are rechecked before opening a call. |
| Android native calls | CallKeep is pinned to 4.6.1 after the complete app exposed the older duplicate native-method startup failure. The dependency is an upstream release, with its locked integrity retained. |
| Memory books | Cover writing, framing, design, movie settings and revision conflicts have connected UI and backend contracts. Text-only books omit photo-framing controls. Small native screens can scroll the closed cover and reach the editor actions. |
| Native verification | Disposable iPhone Simulator and Android Emulator workflows build and launch the complete app with its production screens and native modules. Their isolated transport fixture cannot forward external network traffic. |

At that checkpoint, CI passed 1,638 root/native/shared cases, 672 web cases and
195 operations-app cases. The backend Node suite passed 314 cases with three
conditional skips; isolated SQL TAP invocations passed 883 cases with three
conditional skips. Each conditional skip has a named passing counterpart in the
retained receipt. These overlapping categories are not combined into a unique
test total. All 33 committed startup/auth regression checks pass,
including the two new parallel-cache cases. An independent review also exercised
the actual native navigation-cache reset callback and navigator key across token
renewal and genuine session replacement.

The [navigation evidence](navigation-20261031/resumed-navigation-verification.json)
and [startup follow-up](navigation-20261031/auth-cache-parallel-followup.json)
retain the commands, source hashes and fixture limits. The preceding `26e80ae9`
[CI receipt](live-app-20261031/ci-quality-26e80ae9.json) and
[browser receipt](live-app-20261031/browser-quality-26e80ae9.json) bind all jobs to
the matching source tree. Development browser frame
sampling observed no blank Home or Messages content during the sampled warm
returns. Those samples are not a physical-device or production latency guarantee.

That preceding browser run passed 128 UI workflow scenarios, 18 encoded and decoded
media outputs, and 288 cover layouts with no measured overflow. Its retained
artifact contains measurements and screenshots, not the exported movies; an
independent decode of absent artifact movies is not claimed. Home/Messages,
Jobs and Profile continuity checks retained their expected content across 113,
44 and 45 destination samples respectively. Nested checks are not counted twice
in the 128 parent scenarios.

## Direct checks against the deployed QA app

The existing signed-in QA sessions remained available. The following checks used
the actual branch deployments and hosted QA data, without replacing browser
transport or database responses.

Both primary previews are READY for `26e80ae9`, and their branch aliases were
verified against the exact deployment IDs. A fresh live check on that build kept
Jobs search `design`, Remote location, Freelance type and Highest Pay sort after
Home-to-Jobs navigation. Its genuinely empty dataset remained an empty result
state. Returning from Release gallery to the owner's profile showed both books
and all seven posts in the first captured accessibility view. These observations
are ordinary UI sampling, not a frame-by-frame hosted latency benchmark. The
admin dashboard also showed the rounded data-read label, `395 ms`, correctly
described as current-page reads rather than service-wide health.

The first cold Jobs-to-Profile transition still displayed only the root loading
fallback while the server route resolved. That is distinct from the repaired
warm content caches and led to the additional follow-up below. No
application-origin console error appeared in the retrieved live log.

[Exact preview binding](live-app-20261031/deployment-review-26e80ae.json) ·
[Live follow-up receipt](live-app-20261031/live-navigation-followup-26e80ae.json)

![Jobs filters retained after returning from Home](live-app-20261031/jobs-filter-return-live-26e80ae.jpg)

The published `ab281bca` follow-up was also checked directly against hosted QA.
Both cold Notifications and Home transitions visibly retained passive navigation
around the loading view. The Home screenshot below records that actual state.
All four Jobs filters survived a subsequent return; the intermediate Jobs
accessibility snapshot had incomplete text during rendering, so no first-paint
claim is made. The first captured Profile view after returning from Release
gallery retained both books and the seven-post profile. No application-origin
error appeared in the retrieved log for these journeys, and no hosted content
write was submitted.

[Current hosted navigation receipt](live-app-20261031/live-navigation-followup-ab281bca.json)

![Navigation stays available during the live Home route wait](live-app-20261031/cold-home-navigation-live-ab281bca.jpg)

### Cold-route navigation continuity follow-up

The root loading view now restores passive navigation from the current session's
last committed, server-verified standard app shell. It keeps links usable and
shows an `Opening page…` status without caching page content or mounting unread
queries, calls, lightboxes, scroll listeners, or editable search/compose controls.
The exact owner, scope and revision must still match. Changed or unresolved
sessions and public/auth/professional/unknown routes use neutral loading. A
server-verified guest result clears only the captured session's navigation
snapshot. The temporary avatar accepts only canonical first-party public avatar
URLs; other locators use initials.

Four production web files implement this change. Fourteen focused cases pass,
with clean TypeScript and scoped lint. A separate browser probe used the actual
Next 16.4.3 App Router, proxy, server viewer, async app shell and root loading
component against a synthetic loopback Supabase server. During a deliberately
held profile response, all 136 sampled transition frames retained visible
navigation: 93 outgoing Jobs frames and 43 loading frames. No extra unread query,
editable fallback input, signed-avatar replay or browser error was observed.
The fallback Jobs link interrupted the pending Profile route, and releasing the
late response did not replace Jobs. Collapsed sidebar/content geometry remained
aligned at 76 pixels during the cold Notifications transition.

An independent touch-emulation check also passed at 390 × 844 and 360 × 800.
All five navigation links remained within the viewport with no horizontal
overflow: targets measured 68 × 52 and 62 × 52 CSS pixels respectively, separated
by four pixels. Each center hit test passed, and Jobs interrupted the held
Profile response at both widths. The probe dismissed Next's development badge
through its own preferences after retaining the initial obstruction screenshot;
no application geometry was altered. Physical Safari and nonzero safe-area
behavior are outside that check.

This establishes visible and usable navigation during a real router wait. It does
not claim lower network latency, persistent navigation DOM or a GPU frame-rate
measurement. The same real-Next probe is registered as a separate required
browser CI step, with screenshots, JSON and server logs retained. Existing gates
and the 20-minute job limit are unchanged. Its first published-build CI execution
passed in 13 seconds, and the direct hosted check above confirms the deployed
fallback is visible.

[Follow-up and source hashes](navigation-20261031/cold-shell-followup.json) ·
[Actual Next routing probe](navigation-20261031/cold-shell-next-browser.json) ·
[Independent review](live-app-20261031/navigation-loading-independent-review.json) ·
[Mobile geometry and interaction](navigation-20261031/cold-shell-mobile-independent.json) ·
[CI registration](navigation-20261031/cold-shell-ci-registration.json)

### Web navigation and books

Home and Messages opened successfully. A conversation search remained unchanged
after navigating to Home and returning to Messages. The temporary search text was
cleared after the check.

The existing four-page Release gallery opened from the profile. The reader turned
to its second page. Continuous-film playback could pause and advance manually.
The cover editor exposed its saved title, style, inscription, photo framing,
movie timing and audience controls.

That gallery contains an animated sticker. Its export dialog correctly disabled
creation and identified the unsupported animation. This is an unfinished export
capability, not a successful movie export. The separate single-video QA memories
book was supported and completed the full export and authorized download flow.

| Independent inspection of the downloaded file | Result |
| --- | --- |
| Container and video codec | WebM, VP9 |
| Resolution | 720 × 1280 |
| Duration | 12.001199 seconds |
| Decoded video frames | 360 |
| Reported frame rate | 30 fps |
| Largest observed frame gap | 37 milliseconds |
| Audio | Stereo Opus, 48 kHz, non-silent decoded samples |
| Full-file decoding | Exit 0, no decode errors |
| File size | 3,440,137 bytes |
| SHA256 | `91e2b6fda2dba487268464449fcdfe573d1b6927b243a82b35eb248cbcd2c07f` |

The decoded frame preserved the synthetic source video, its aspect ratio and the
saved caption. The actual UI reported the original audio and the built-in Quiet
light soundtrack. This establishes a real hosted-QA browser export using the
existing synthetic video, rather than physical iPhone or licensed-catalogue
acceptance.

[Export receipt](live-app-20261031/live-memory-export.json)

![Completed live movie export](live-app-20261031/memory-movie-ready.jpg)

### Operations app

The deployed dashboard loaded its QA activity and current daily analytics. Its
top-content link opened the staff Post review route. The protected photo loaded
at 1080 × 1920, opened fullscreen and returned focus to its originating button
when closed. The next attachment loaded its saved three-second trim and played
with the saved artwork inside the operations app.

No application-origin error appeared in the captured console errors for these
targeted web/admin journeys. The browser extension emitted metadata errors, which
are counted separately in the receipts. No moderation action, message, post,
profile edit or saved-book change was submitted during these checks.

[Operations receipt](live-app-20261031/live-admin-review.json)

![Live staff post review](live-app-20261031/admin-post-review.jpg)

### Own-profile return continuity

The live check found that returning from a book to the viewer's own web profile
recreated empty posts and shelf state. The follow-up now restores only the current
owner's in-memory snapshots, refreshes all loaded pages in the background and
invalidates saved-book revisions when content changes off-route. Other people's
content still waits for current server visibility. Expired signed media locators
are stripped, and account/session changes cancel obsolete work.

The actual-component browser suite passed all 41 social scenarios, including five
new profile cases. Across 44 destination-profile samples during held refreshes,
the existing post and four books remained present with no loading or blank
profile sample. The first profile observation was 65 milliseconds after Back.
This is component continuity evidence using synthetic transport and route
adapters, not a hosted routing or physical-device latency benchmark. The actual
editor also saved a new title and private visibility, and the returned shelf used
the new revision. Eight rapid shelf changes cancelled the stale read and
coalesced into one replacement read. Focused Node execution passed 33 cases,
with clean TypeScript and scoped lint results.

[Profile follow-up and source hashes](navigation-20261031/warm-profile-followup.json)

The additional hosted checks found a separate web Jobs continuity defect:
search, location and job type reset after Home-to-Jobs navigation. Its follow-up
now restores filters, loaded rows, saved IDs, city and scroll under the original
navigation session. It preserves successfully loaded empty results and keeps
usable content while an unsuccessful refresh offers retry. Unused poster-profile
enrichment was removed.

Independent review reproduced two save races. A confirmation from the previous
page instance could lose to a stale replacement-page read, and an implicitly
authorized write could obtain a newer session token after A to B to A. Scoped
confirmation events and mutation revisions now protect the replacement page.
Save requests check their original session, pin authorization and cancel on a
session change. Already-dispatched same-session saves may finish after ordinary
route navigation. Cancellation cannot undo a write already committed by the
server.

Final verification passed 23 focused/parity Node cases and all 25 commerce browser
scenarios, with clean TypeScript and scoped lint. Seven focused Jobs browser cases
include held-refresh navigation, empty results, cross-mount save confirmation,
failed-refresh retry and account replacement. Across 43 destination samples,
eight rows, search, location, type, sort and scroll remained present. The first
Jobs observation was 51.5 milliseconds after return. These component-fixture
measurements have the same routing and device limitations as the profile proof.

[Jobs follow-up and source hashes](navigation-20261031/warm-jobs-followup.json)

Notifications and Messages also loaded their genuine hosted-QA empty states
without an application-origin console error. Immediate automated navigation
showed a root loading fallback while some server routes resolved. Those
observations are retained without a blanket navigation-speed claim.

[Additional live navigation observations](live-app-20261031/live-extra-navigation-before-jobs-fix.json)

## Native acceptance

The current `e173b2db` standalone encoder jobs passed all 58 cases, and both
Swift/Kotlin integration compilation jobs passed. Source and fixture hashes,
archive digests, and 57 retained media hashes and lengths are verified in the
current receipts linked at the top of this report. Those source-equal outputs
were not independently decoded again. The complete iPhone job is still running;
the current Android result is recorded at the top of this report. The history
below explains earlier defects and repairs; each result remains bound to its
named source.

The preceding `26e80ae9` standalone encoder jobs passed 58 CI cases: 11 iOS memory, 8 iOS
story and 39 Android cases. ZIP digests, 57 retained media hashes and sizes, and
the recorded implementation/acceptance source hashes were verified against
`26e80ae9` and its identical merge tree. Those encoder and acceptance sources
equal the preceding `341395c6` sources. The new artifacts were not independently
decoded again. The earlier independent decoding verified cadence, duration,
color and alpha, timed artwork, voiceover silence and audio timing/pitch.

[Preceding encoder receipts and source equivalence](native-full-app-20261031/native-encoders-26e80ae9-source-equivalence.json)

- [iOS memory receipt](native-full-app-20261031/ios-memory-341395c6-receipt.json)
- [Independent iOS memory decode](native-full-app-20261031/ios-memory-341395c6-independent-decode.json)
- [iOS story receipt](native-full-app-20261031/ios-story-341395c6-receipt.json)
- [Independent iOS story decode](native-full-app-20261031/ios-story-341395c6-independent-decode.json)

These standalone checks use the arm64 iOS 26.2 simulator toolchain. The complete
app acceptance uses an Intel iPhone 16 Simulator running iOS 18.5 and a separate
Android Emulator. Full Swift and Kotlin integration compiles are green at both
`341395c6` and `26e80ae9`. Complete-app runtime acceptance remains separate from
those compiles and the standalone encoders.

The `ab281bca` complete integration compile jobs also passed on both platforms.
Their diagnostic ZIP hashes, embedded tested merge and all seven recorded native
source hashes were verified. The Android compile receipt continues to advertise
memory-movie capability zero. The current standalone iOS story/memory jobs passed
19 cases; the separate Android encoder job stopped at the emulator download.

[Current integration compile receipt](native-full-app-20261031/native-compile-ab281bca-status.json) ·
[Current iOS encoder source binding](native-full-app-20261031/ios-encoders-ab281bca-source-equivalence.json) ·
[Android emulator installation failure](native-full-app-20261031/android-encoders-ab281bca-install-failure.json)

The earlier `341395c6` iPhone app built, installed, signed in and passed its Home,
Latest and For You assertions. The `26e80ae9` Android app also built and passed
those assertions. Its former CallKeep bridge crash and unsolicited microphone
prompt no longer blocked Home. Neither run could make the next semantic Market
tab tap: the icons were visible, but the native accessibility tree omitted the
whole bottom bar. Book navigation and capture were therefore not reached.

[Native compilation status](native-full-app-20261031/native-compile-26e80ae9-status.json) ·
[iPhone runtime failure](native-full-app-20261031/ios-full-app-341395c6-failure.json) ·
[Android runtime failure](native-full-app-20261031/android-full-app-26e80ae9-failure.json)

![Actual iPhone Simulator Home before the tab repair](native-full-app-20261031/ios-341395c6-home.png)

The `26e80ae9` iPhone full-app job stopped during `npm ci` with `ETIMEDOUT`, before
native preparation, compilation or app runtime. The other iOS dependency install
completed. An exact-job retry was attempted once; GitHub rejected it because the
sibling Android job was still running. This is a recorded infrastructure failure,
not evidence of a new native source defect. Android and the earlier iPhone
baseline were preserved through completion. The iPhone install step now retries
the same locked install once only when npm reports the exact observed timeout
code. Five shell-executed cases distinguish success, retry success, repeated
timeout, integrity failure and incidental timeout text. Dependency integrity and
all app assertions remain unchanged.

[iPhone install failure](native-full-app-20261031/ios-full-app-26e80ae9-install-failure.json) ·
[Bounded install retry](native-full-app-20261031/ios-install-timeout-retry.json)

The Android source follow-up separates passive native registration from media
permission requests. Microphone/camera access remains tied to an explicit call
action. Disabled phone accounts use the existing notification fallback. Cold
Android native events also subscribe before registration drains the queue. The
focused checks pass 15 native-event cases, 23 calling cases and 19 recipient/access
cases. Seven new cases execute the installed CallKeep facade. The corrected
Android complete-app run now establishes the absence of the unsolicited prompt
in this synthetic sign-in flow; physical incoming-call delivery is still separate.

### Bottom navigation geometry repair

The absolute BottomTabBar was drawn outside an animated parent with zero height.
The repair gives that parent explicit bounds around the existing floating bar.
The shown bar position and available content height stay unchanged. Ordinary
non-absolute bars retain their natural layout. Existing tab labels, roles and
press handlers remain the acceptance targets.

Twelve focused actual-component cases pass. A probe compiled the installed React
Native Yoga implementation and verified the before/after layout at four native
viewport sizes, plus default and relative tab styles. The iPhone portrait parent
changes from zero to 108 points while the bar stays at the same screen position.
The native-driver hide/reveal settings remain; the larger parent changes the
scale pivot slightly. The subsequent `ab281bca` Android run successfully tapped
Market and reached its expected listing. The iPhone run also opened Market and
exposed all five tab nodes in its native accessibility tree with 72 by 64 point
bounds. These observations resolve the earlier missing-tab issue for the
observed journeys. They do not establish all animation behavior or later
navigation acceptance.

[Geometry proof](native-full-app-20261031/native-tab-wrapper-geometry-repair.json) ·
[Independent native-tab review](live-app-20261031/native-tab-independent-review.json)

The Android run's next label-based Home tap selected the system navigation
control, not the application tab. Both the Maestro-selected resource ID and the
system HOME activity transition are retained, along with the Market and launcher
screenshots. The local correction adds the installed navigation version's
`tabBarTestID` option and changes eight main-tab actions to those identifiers.
All page assertions, accessibility labels, event handlers and deadlines remain.
Five new cases execute the actual navigator functions and installed tab views
for personal/business branches on both platforms; they verify identifiers reach
the native Pressable, labels and activation remain intact, and every parsed flow
selector names a rendered tab. These pass alongside 29 existing related cases.
The corrected native flow still requires a new complete-app execution.

[Selector repair and source hashes](native-full-app-20261031/native-tab-selector-repair.json) ·
[System Home collision evidence](native-full-app-20261031/android-tab-selector-system-home-evidence.json)

The iPhone Market assertion failed after successful navigation because its
expected standalone title is a child of an accessible card. The existing
production card exposes `View listing: Travel journal`, and the screenshot shows
the loaded $12 listing. The failure is retained as a failed run. A read-only
follow-on audit found the same grouping risk in the unreached Jobs and Messages
rows and the icon-bearing Edit profile button. The next required selectors will
retain the exact expected content while matching either its standalone node or
its complete segment within the native grouped label; the message's question
mark must remain literal.

[Current iPhone UI and source review](native-full-app-20261031/ios-full-app-ab281bca-review.json)

![Loaded Market and repaired tabs on the actual iPhone Simulator](native-full-app-20261031/ios-ab281bca/market-failure.png)

### Simulator account persistence

The earlier iPhone run also logged SecureStore failures caused by missing
entitlements. The disposable simulator build now uses Xcode's local ad-hoc
signing to generate its simulated application identity. A bounded Mach-O reader
checks the embedded XML and DER sections before and after the existing re-sign,
and separately verifies the host signature. This creates no signed physical-device
release and requires no Apple account login.

The full-app gate now requires successful account-index storage and reloads the
actual production account store through SecureStore after navigation reaches the
capture screen. It compares the synthetic account and current session in memory;
only pass/fail, reload status and account count enter the receipt. The production
account store is unchanged. The combined focused native checks pass 52 Node
cases, including six actual-account-store cases, and nine Python parser cases
invoked by one Node case. TypeScript, scoped lint and shell checks also pass.
The `ab281bca` Mac run now establishes actual Xcode ad-hoc signing, unchanged
embedded XML/DER entitlement sections after re-signing, an empty host-entitlement
dictionary and a successful strict signature verification. Its runtime logs show
two successful one-account index operations and none of the earlier save/index
or required-entitlement errors. The flow stopped before the dedicated reload
route, so saved-account readback, restart persistence and full capture remain
unproved by this run.

[Simulator signing and readback repair](native-full-app-20261031/ios-simulator-keychain-signing-repair.json) ·
[Independent signing/readback review](native-full-app-20261031/ios-signing-readback-independent-review.json)

[Current signing and account-storage review](native-full-app-20261031/ios-signing-account-ab281bca-review.json)

### Auth timing investigation

The earlier Android runtime emitted a five-second Auth lock warning. Its bounded
trace recorded 22 lock operations and 93 storage operations, all fulfilled with
no unfinished or dropped operation. Maximum measured lock wait was 293.071 ms,
hold was 389.205 ms and storage duration was 109.767 ms. That does not explain the
warning or establish a five-second blocked UI.

Independent review matched the installed Auth and Supabase files to their pinned
registry archive integrity and confirmed timer cleanup in those sources. The
published QA trace adds a wall-clock anchor and bounded identities for the timer
functions observed at lock phases. It reads property descriptors without invoking
accessors, replacing timers or modifying SDK locking. Fifteen diagnostic cases
pass, including the actual SDK, redaction, descriptor preservation and bounds.
The source receipt records installed dependency paths and hashes, not a final
Metro bundle attestation. Production Supabase source and deadlines are unchanged.

The new `ab281bca` trace records 25 lock and 99 storage operations, all fulfilled,
with no active or dropped operation. Its first acquisition requests with timer
identities 1/2 and completes with identities 3/4. Source inspection found the
existing Daily Android bootstrap replaces the global timer functions. Its
BackgroundTimer clear function only removes callbacks in its own registry, so
it cannot cancel an acquisition timeout created in the earlier React Native
registry. The trace's first lock fulfills at 106.622 ms; the later warning does
not establish a five-second UI stall.

An isolated reproduction uses the actual pinned Supabase lock, Daily bootstrap
and BackgroundTimer callback implementation. Starting auth before Daily leaves
one old-registry timer after successful completion and produces the observed
warning when that synthetic deadline is delivered. Starting Daily first retains
the same auth result and callback count, clears the callback and emits no false
warning. An iOS control retains its original timer functions. Native modules and
timer delivery are simulated in this source-level mechanism check.

The local repair initializes the already-used Daily module before production App
imports. The disposable QA entry does so after its configuration guard and
synthetic transport installation, before linking or App imports. Six functional
cases execute both entry files and the installed implementations, including
wrong-configuration rejection and a genuinely contended lock that still rejects
at its configured 5,000 ms deadline. The existing 15 diagnostic cases also pass.
No SDK lock, timeout, clock provider, warning behavior or native capability flag
is replaced. A fresh Android trace must verify stable timer identities and the
absence of this warning in the complete app.

A separate clock-origin switch can make the diagnostic observer clamp durations
in a synthetic VM. The new emulator snapshot spans 31.219 seconds, with 298
distinct increasing event timestamps through 30.992 seconds, and does not
exhibit that signature; the pinned React Native runtime
initializes Performance before app startup. That hypothetical mechanism does not
justify a clock change here.

These observations add instrumentation overhead and are diagnostic evidence,
not an uninstrumented production performance benchmark.

[Auth diagnostic candidate](live-app-20261031/native-auth-diagnostics-candidate.json) ·
[Independent warning investigation](live-app-20261031/native-auth-warning-26e80ae9-independent-review.json)

[Current artifact and timer investigation](live-app-20261031/native-auth-warning-ab281bca-investigation.json) ·
[Source-level timer reproduction](live-app-20261031/native-daily-timer-switch-repro.json) ·
[Clock-origin diagnostic boundary](live-app-20261031/native-auth-clock-source-switch-repro.json)

The initial combined candidate passed the full local root selection once after both
repairs were frozen: 164 files, including 1,680 formal passing cases and a
separate successful 33-check auth script. There were no formal failures, skips,
cancellations or todos. The CI wrapper counts that legacy script as one file
case. This initial 1,680-case local result precedes the later selector and
required-flow changes; it is retained as historical evidence. Before/after guards retained the same seven frozen
candidate hashes, every test-file hash, test selection and source diff. This
used local Node 24.22.1; the preceding CI checkpoint used Node 22.23.4. Independent
source review found no issue in the initialization order, guard ordering,
installed ID propagation or preservation of genuine timeout behavior.

[Combined candidate regression gate](live-app-20261031/native-v4-root-regressions.json) ·
[Independent entry and tab review](native-full-app-20261031/native-entry-tab-independent-review.json)

The final combined follow-up passed all 166 CI-selected root files in 51.922
seconds on Node 24.22.1: 165 formal-counter files produced 1,712 passing cases,
and the separate auth script passed its 33 checks. No formal failure, skip,
cancellation or todo occurred. This includes 43 new cases: six timer-bootstrap,
five tab-ID, four native content-selector and 28 required-flow orchestration
cases. All 18 frozen source/flow paths, every selected test-file hash, selection
and tracked code diff were unchanged before and after the run. CI's wrapper
counts the standalone script as one case; internal and wrapper counts are not
added together.

[Final combined candidate gate](live-app-20261031/native-v4-final-root-regressions.json) ·
[Content-selector repair](native-full-app-20261031/native-flow-content-selector-repair.json)

Both `26e80ae9` complete-app jobs finished before the `ab281bca` publication. The
existing stable concurrency group remains unchanged. Neither the runner tier
nor acceptance assertions were relaxed. The original iPhone full-app build needed
about 37 minutes, with additional preparation and simulator boot time; standalone
encoder success is not substituted for full-app navigation acceptance. Native
whole-book export remains gated until the actual full-app capture flow passes.

- [Android full-app failure evidence](native-full-app-20261031/android-full-app-341395c6-failure.json)
- [Android permission follow-up](native-full-app-20261031/android-permission-followup.json)
- [Android encoder receipt](native-full-app-20261031/android-encoders-341395c6-receipt.json)
- [Independent Android memory decode](native-full-app-20261031/android-memory-341395c6-independent-decode.json)

The full-app workflow checks actual Profile-to-book navigation, page reading,
film playback, entry to export, creative editing, owner revision persistence and
reopening the saved book. Its additional capture gate uses the production
MemoryMovieExport component and independently decodes the resulting native MP4.
It does not establish physical Photos-library behavior or provider push delivery.

The follow-up now runs navigation once and the unchanged capture flow once as
two required Maestro commands on the same installed app and device. Capture is
attempted even if an earlier navigation assertion fails. Both commands retain
separate logs, screenshots, JUnit and pipeline exit status. Missing, malformed,
empty, skipped, duplicate or incorrectly identified reports fail acceptance;
each report must contain its expected successful case. Failed logging and stale
result reuse also fail. The platform scripts still attempt evidence collection,
independent movie decoding and the complete-app verifier, and any failed phase
keeps the overall job failed.

No new sign-in, state reset, capture retry, timeout widening or runner/concurrency
change is introduced. Both memory-flow assertion files are byte-identical to the
baseline. A pinned Maestro 2.11.0 source review verified 22 official source files
and found that driver cleanup stops Maestro's own infrastructure rather than the
tested app. The next native execution still has to prove real process/session
continuity through the unchanged cumulative book/account/capture requirements.
The 28 actual-shell cases passed both owner and independent review; their
controlled Maestro responses verify orchestration rather than native runtime.

[Required-flow repair](native-full-app-20261031/native-required-flows-repair.json) ·
[Independent required-flow review](native-full-app-20261031/native-required-flows-independent-review.json) ·
[Pinned Maestro lifecycle evidence](native-full-app-20261031/maestro-2.11.0-lifecycle-review.json) ·
[Unconfirmed earlier Android retry](native-full-app-20261031/android-encoders-ab281bca-retry-unconfirmed.json)

## Hosted backend status

The latest saved read-only QA business-auth postflight observed private stage 3.
The catalogue check at 14:54:01 UTC and migration-history check at 14:53:56 UTC
on 2026-10-31 still matched the expected catalogue fingerprint
`2f92a9d038364736fa2413bb6d05a160`.

It verified 99 catalogue records, unchanged migration names/versions/SQL hashes,
no stage 4 private function, no music schema, no notification-event jobs or claim
function, and no active matching business-auth statement.

[Current read-only postflight](live-app-20261031/backend-stage3-postflight-f4c35f32.json) ·
[Previous read-only observation](live-app-20261031/backend-stage3-postflight-6878c384.json) ·
[Earlier read-only observation](live-app-20261031/backend-stage3-postflight-e173b2db.json)

Neither retained original stage-4 migration invocation has an independently
established terminal outcome. Interrupting a local wait did not prove remote
cancellation. The new independent postflight again found no stage 4 installation.
No alternate SQL bridge, confirmation bypass or downstream activation followed.

The unchanged catalogue and zero matching active statements establish the
observed database state, not a terminal connector outcome or the absence of a
queued request. Neither retained attempt exposes a provider request ID, recoverable
confirmation state, terminal result, or confirmed remote cancellation. The
exposed migration tool has no request-state/resume parameter. No approval
rejection or pending approval is established. The exact stage-4 SQL retains its
transaction and stage/fingerprint safeguards, but those do not demonstrate safe
concurrent retry. Another invocation is held pending resolution of the original
request states; the detailed assessment preserves the conditional next steps.

[Request-state and retry-safety assessment](live-app-20261031/backend-stage4-request-state-assessment.json)

Dependent business Edge rollout and music installation remain held. Commercial
music licensing remains disabled.

[Retained transport and postflight evidence](backend-acceptance-20261031/business-auth-retained-transport.json)

### Reviewed notification alternative

The inspected provider-owned pg_net queues remain readable by application roles,
and the connected database role cannot repair their ACLs. The earlier setup
refused to place a long-lived server credential there.

The new source-only QA candidate uses a private canonical event and a short-lived
one-use capability. The queue contains only the opaque job ID and token. A
service-only atomic claim selects the existing event. A final lease, expiry and
delivery-mode check precedes forwarding to the fixed QA handler. Existing live
recipient, call, account and preference checks remain in those handlers.

Independent execution passed 16 SQL and 14 handler cases. The candidate remains
outside automatic migrations and deployment. The provider's normal confirmation
classification remains intact.

This design avoids duplicate automatic retries after an uncertain outcome. A
worker failure after claim can still lose an attempt. Queue observers can advance
the legitimate event, and queue writers can suppress it. Those remaining limits
and the requirement to drain in-flight work before switching modes are explicit.

[Candidate procedure](../../supabase/ops/qa/notification-event-dispatch/README.md)
and [independent review](backend-acceptance-20261031/notification-event-root-review.json).

## Release boundaries

The web and admin aliases retain their verified READY deployments with relevant
inputs equal to the current source. The review branch remains a draft. No
production frontend promotion, merge, new signed build or new TestFlight
submission is claimed by this continuation.

The iPhone release configuration is prepared: version 1.1.0, project/app/team
identifiers, production submission profile, and remote build auto-increment.
The preview profile is a signed internal QA device build with the separate QA
bundle/backend. It is not a QA TestFlight submission profile. The current-source
signed artifact still needs its own build ID, exact source/profile/bundle,
versions and IPA digest. The historical build 16 receipt does not cover this
source, and the next remote build number is not inferred from that history or
the local buildNumber field.

Expo's [managed-credentials documentation](https://docs.expo.dev/app-signing/managed-credentials/)
allows stored signing credentials to be reused through an authenticated Expo
account. A fresh Apple sign-in is not inherently required for that route. The
supported read-only `eas whoami` check was performed with official EAS CLI 27.2.0
from an isolated temporary package cache; it returned exit 1 and `Not logged in`.
The current environment therefore has no usable logged-in Expo CLI session.
A subsequent read-only browser check found an existing authenticated session for
`donadmiral` and opened the Platinum Circles project. Its details drawer confirms
the same owner, slug and project ID as the repository configuration. The browser
session does not authenticate the CLI, and no cookies or credentials were copied.
The overview lists an earlier successful iOS build/submission on source
`1bb8246`, which does not cover the current candidate. A subsequent read-only
credential-metadata check showed Expo's distribution-certificate status as
**Valid**, with displayed expiration **Apr 21, 2027 10:53 PM**. The tooltip did
not state a timezone, so no UTC conversion is inferred. An App Store Connect
submission-key entry is present for the same configured Apple team.

A further read-only project check found the existing QA **Ad-hoc** association
for `app.platinumcircles.mobile.qa` and production **App Store** association for
`app.platinumcircles.mobile`. Expo displays both provisioning profiles and their
distribution certificate as **Valid** for the configured team. The QA device's
inclusion was not inspected, and displayed validity does not prove successful
signing or Apple acceptance of a new build/submission.

The CLI remains signed out. No private key material was read,
no browser credentials were transferred to the CLI, and no new login, project
link, signed build or submission was attempted. The earlier Apple sign-in was
not retried. Actual new build/profile validation, Apple processing and physical
installation remain unverified; simulator work continues independently.

[Signed-release configuration and exact handoff](native-full-app-20261031/ios-signed-release-handoff-e173b2db.json) ·
[Observed Expo session check](native-full-app-20261031/expo-existing-session-observation-e173b2db.json) ·
[Verified existing Expo browser access](native-full-app-20261031/expo-browser-existing-session-observation.json) ·
[Observed Expo signing metadata](native-full-app-20261031/expo-signing-metadata-6878c384.json) ·
[Observed project signing associations](native-full-app-20261031/expo-project-signing-associations-6878c384.json) ·
[Current-source signed-build readiness](native-full-app-20261031/ios-signed-release-readiness-6878c384.json) ·
[Bounded iPhone log-tool outcome](native-full-app-20261031/ios-e173b2db-log-transport-observation.json)

The remaining release work includes the blocked hosted installation, complete
native UI/capture results, physical-device Photos/camera/interruption and push/call
acceptance, and production private-media/erasure/provider configuration gates.
Animated/nested-video/dual-camera export and the previously documented unfinished
business-delivery features remain outside the verified capability set. No
universal speed, exactly-once provider delivery or whole-product completion claim
is made.
