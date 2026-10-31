# App reliability and performance continuation

This report records the continuation of the app-wide reliability, navigation and
native acceptance work. It separates implemented changes, observed results and
remaining release gates. It does not claim that every product feature or every
physical-device flow is complete.

The completed automated CI checkpoint is `341395c68cfc0bf74527bcf23e0dced3813e9225`.
Its tested PR merge is `1ca98984eec5d0912d510da9e565a84a8d5aacfd`. Both have tree
`ca36583e931756f2d9ea98fdaf3c9869ee4daf8f`.

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

At that checkpoint, CI passed 1,604 root/native/shared cases, 647 web cases and
195 operations-app cases. The backend Node suite passed 314 cases with three
conditional skips; isolated SQL TAP invocations passed 867 cases with three
conditional skips. Each conditional skip has a named passing counterpart in the
retained receipt. These overlapping categories are not combined into a unique
test total. All 33 committed startup/auth regression checks pass,
including the two new parallel-cache cases. An independent review also exercised
the actual native navigation-cache reset callback and navigator key across token
renewal and genuine session replacement.

The [navigation evidence](navigation-20261031/resumed-navigation-verification.json)
and [startup follow-up](navigation-20261031/auth-cache-parallel-followup.json)
retain the commands, source hashes and fixture limits. The current
[CI receipt](live-app-20261031/ci-quality-341395c6.json) and
[browser receipt](live-app-20261031/browser-quality-341395c6.json) bind all jobs to
the matching source tree. Development browser frame
sampling observed no blank Home or Messages content during the sampled warm
returns. Those samples are not a physical-device or production latency guarantee.

## Direct checks against the deployed QA app

The existing signed-in QA sessions remained available. The following checks used
the actual branch deployments and hosted QA data, without replacing browser
transport or database responses.

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

The current iOS standalone memory and story encoder jobs passed 11 and 8 cases.
Their retained output and source hashes match the tested commit. Independent
decoding verified cadence, duration, color and alpha, timed artwork, voiceover
silence and audio timing/pitch.

- [iOS memory receipt](native-full-app-20261031/ios-memory-341395c6-receipt.json)
- [Independent iOS memory decode](native-full-app-20261031/ios-memory-341395c6-independent-decode.json)
- [iOS story receipt](native-full-app-20261031/ios-story-341395c6-receipt.json)
- [Independent iOS story decode](native-full-app-20261031/ios-story-341395c6-independent-decode.json)

These standalone checks use the arm64 iOS 26.2 simulator toolchain. The complete
app acceptance uses an Intel iPhone 16 Simulator running iOS 18.5 and a separate
Android Emulator. The Android full-app build completed, and the previous
CallKeep bridge crash no longer occurred. The runtime then exposed an unsolicited
microphone permission dialog immediately after sign-in. That blocked Home
acceptance. The iPhone full-app runtime result is still pending. Native
whole-book export remains gated until the actual full-app capture flow passes.

The Android source follow-up separates passive native registration from media
permission requests. Microphone/camera access remains tied to an explicit call
action. Disabled phone accounts use the existing notification fallback. Cold
Android native events also subscribe before registration drains the queue. The
focused checks pass 15 native-event cases, 23 calling cases and 19 recipient/access
cases. Seven new cases execute the installed CallKeep facade. The corrected
complete-app run must still establish the OS behavior. A separate five-second
Auth lock warning in the earlier cold start remains under investigation.

The disposable follow-up adds bounded timing observation around the unchanged
SDK lock and its storage adapter. Eleven diagnostic cases pass, including real
SDK mutual exclusion, redaction and bounded disk writes. The retained trace
contains numeric operation IDs and timings rather than credentials or session
contents. Its extra microtasks and disk writes mean it diagnoses phases rather
than proving uninstrumented production performance. Production Supabase source
and timeout configuration are unchanged.

[Auth diagnostic candidate](live-app-20261031/native-auth-diagnostics-candidate.json)

The next run uses one new stable concurrency group so the already-running iPhone
baseline can finish alongside the repaired build. Later edits within that group
still replace obsolete runs. Neither the runner tier nor acceptance assertions
were relaxed. The original iPhone full-app build needed about 37 minutes, with
additional preparation and simulator boot time; standalone encoder success is
not substituted for full-app navigation acceptance.

- [Android full-app failure evidence](native-full-app-20261031/android-full-app-341395c6-failure.json)
- [Android permission follow-up](native-full-app-20261031/android-permission-followup.json)
- [Android encoder receipt](native-full-app-20261031/android-encoders-341395c6-receipt.json)
- [Independent Android memory decode](native-full-app-20261031/android-memory-341395c6-independent-decode.json)

The full-app workflow checks actual Profile-to-book navigation, page reading,
film playback, entry to export, creative editing, owner revision persistence and
reopening the saved book. Its additional capture gate uses the production
MemoryMovieExport component and independently decodes the resulting native MP4.
It does not establish physical Photos-library behavior or provider push delivery.

## Hosted backend status

The QA business-auth installation is safely private at stage 3. The read-only
postflight at 03:23:43 UTC still matched the expected catalogue fingerprint
`2f92a9d038364736fa2413bb6d05a160`.

The next migration invocation never returned a success, error, approval form or
rejection. Interrupting the local wait did not prove remote cancellation. The
independent postflight found no stage 4 installation. No alternate SQL bridge,
confirmation bypass or downstream activation followed.

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

The four preview deployments are ready for the published checkpoint. The review
branch remains a draft. No production frontend promotion, merge, new signed
build or new TestFlight submission is claimed by this continuation.

The repository retains the Apple team and App Store Connect identifiers and the
historical build 16 receipt. The attempted current App Store Connect browser
check did not complete, so current signed-release access and Apple processing
state remain unverified. Simulator work continues independently.

The remaining release work includes the blocked hosted installation, complete
native UI/capture results, physical-device Photos/camera/interruption and push/call
acceptance, and production private-media/erasure/provider configuration gates.
Animated/nested-video/dual-camera export and the previously documented unfinished
business-delivery features remain outside the verified capability set. No
universal speed, exactly-once provider delivery or whole-product completion claim
is made.
