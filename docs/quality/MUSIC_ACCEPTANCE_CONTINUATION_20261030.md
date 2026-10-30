# Music infrastructure and acceptance continuation

Date: 30 October 2026. Review branch: `codex/app-quality-20261029`. [Draft PR #3](https://github.com/donadmiral/tbirds-nest/pull/3).

This report continues and supersedes the current-state statements in [the earlier interaction and music report](INTERACTION_MUSIC_DELIVERY_20261030.md). Historical receipts keep their original source identities. In particular, generic catalogue ingestion/delivery/reporting, automatic abandoned-audio cleanup, and native iOS story-audio encoding now have implementations and executable evidence. Commercial licensing remains disabled.

## Delivery and operating state

The additional music backend, operations interface, native picker repairs and initial Android compilation gate were published at `f25a0263ee08dee8e589feee6479f0e357085c45`, tree `b8e69a3c40f66a1e3de197b206eeddd2313b6aac`. The preceding native encoder and client authorization checkpoint is `ddc968bd11be40d37af7a5aeff1c134e53c397d8`. The later candidate adds the Android production renderer, Android instrumentation harness and the client repairs described below; its runtime acceptance remains pending until the resulting CI receipts are verified.

**Hosted QA music and business authentication remain uninstalled.** The supported Supabase migration connector stalled again. An independent read-only check found no matching schema, capability, migration-history entry or active candidate transaction. No dependent Edge rollout or readiness activation followed. This was a connector stall, not an approval rejection. The exact attempt, preflight, postflight and available recovery transports are recorded in [the installation receipt](backend-acceptance-20261030/continuation-installation-attempt.json).

The source therefore has substantially more working infrastructure than the currently installed QA service. Missing hosted contracts remain visibly unavailable in the apps. Passing local SQL fixtures, a successful web deployment and a native compile do not establish that hosted Auth, Storage or external-provider journeys work.

An [independent 21:46 UTC QA postflight](backend-acceptance-20261030/continuation-hosted-postflight.json) again found both schemas absent and zero of the five candidate migrations installed. The latest admin preview and its retry continued to show the unavailable-contract state. Production rollout remains a separate held gate.

## Music backend completed in this continuation

| Layer | Implemented contract |
| --- | --- |
| Catalogue preparation | Immutable provider/track/revision metadata, bounded manifest import, exact-request replay and atomic conflict rejection. |
| Binary ingestion | Provider-neutral push endpoint for validated WAV, MP3 and audio-only M4A, up to 50 MiB and 1–600 seconds. It never fetches an arbitrary submitted URL. |
| Provider authority | Scoped provider credentials, licensed-provider state, immutable versioned agreement evidence, explicit hosting permission and finite current rights dates are required before ingestion. |
| Stored-byte verification | Private non-upsert upload, independent stored-byte read, digest/container/duration checks, exact Storage version binding and a final current-rights check. |
| Playback and use | Current Auth and business-session authorization, verified source identity, permitted purpose, verified territory and current agreement window. User-editable profile metadata cannot supply territory authority. |
| Export | Capability-version checks and a generic export-authorization RPC preserve original owner-only rules while requiring a separate export grant for catalogue recordings. |
| Private delivery | Existing signer/proxy delivers the verified object through no-store tickets. Ticket redemption and later range requests recheck rights and object identity. Buffered or downloaded bytes cannot be recalled. |
| Retention | Separate original/catalogue abandonment queues, fenced reservations, bounded leases, backoff, fair scheduling and quota release only after actual Storage absence is acknowledged. |
| Operations | Real readiness switches, worker heartbeat, separate cleanup queues, immutable catalogue revisions and a protected UTC-window CSV report. |

The private journal records attachment, detachment, delivery authorization and export authorization. It does not measure completed listening, billable streams or royalties. The CSV is an operations export; an actual commercial statement format depends on the selected provider's agreement.

Catalogue sounds are platform-owned library records. Originals still require an owner and remain in the Storage-first personal-erasure chain. Original erasure removes its usage rows. The maintenance worker never selects verified or published sounds as abandoned uploads.

The cleanup review closed four concrete issues: late privileged Storage writes after cleanup, readiness checks that were not reading actual switches, operations starting after their inherited deadline, and starvation between original and catalogue queues. The narrowly scoped Storage write guard requires hosted acceptance against Supabase's managed Storage implementation; synthetic metadata does not prove provider-level deletion or concurrent live transactions.

All catalogue switches start false. The migrations create no provider credential, licensed provider or signed grant, and the admin command interface has no licensing activation action. The selected provider's adapter, feed mapping, credential exchange, territory-verification source and commercial reporting contract remain part of the licensing handoff.

See the [operations runbook](music-operations-20261030/README.md), [source manifest](music-operations-20261030/candidate.json) and [independent review](backend-acceptance-20261030/music-pipeline-independent-review.json). The manifest covers five pending QA migrations plus environment-specific prerequisite order, fourteen affected Edge bundles, two prerequisite media bundles and forty-two unique recursively bundled files. It identifies twelve already-installed QA prerequisites and thirteen production prerequisites; bulk migration replay or an unreviewed database push is prohibited. `node scripts/quality/build-music-candidate.mjs --check` verifies the exact saved hashes without changing hosted state.

## Client and native audio behavior

The shared capability reader recognizes the actual supported backend versions. Library results require an explicit version-2 catalogue capability. A missing contract is unavailable; an internal database failure remains a retryable error. Audio duration and maximum excerpt are separate, so a long recording is no longer incorrectly treated as only thirty seconds long.

Export checks the current sound identity, source, duration, maximum excerpt and requested use. Web exports and native Photos preparation reauthorize after encoding and before presenting the result. Native staging validates local bytes and cleans temporary media on cancellation, account changes and failures.

The iOS encoder now mixes the soundtrack into the actual movie. Music loops over the final visual duration, voiceover plays once, and original-video audio keeps its chosen level. Video speed changes the visual/source timeline without accelerating the added soundtrack. A photo or text composition carrying audio is exported as an MP4. Older native binaries cannot silently omit the audio: the bridge requires the actual supported export capability.

The native music sheet now has bounded availability/favorites retries, confirmed bookmarks, synchronous duplicate-tap locks, saved-ID resolution beyond the first browse page, partial-failure feedback and a single twenty-second Saved refresh deadline with four workers. Failed refreshes preserve checked rows and the attached selection. Preview generations, excerpt boundaries and periodic authorization prevent old loads or callbacks from controlling a newer preview. Account changes, dismissal, backgrounding and calls invalidate pending work.

Recording starts only after an explicit record action. Start, stop and cleanup retain their lock until native work settles. Audio-mode updates are serialized, active calls retain their audio-session mode, and abandoned local recordings are removed. These are source/component guarantees; actual microphone hardware, Bluetooth routes and call interruptions still need installed-device acceptance.

Story interaction scopes subscribe to session and profile identity. Even an account round trip before React renders invalidates an older operation and refreshes dependent reads. Poll and reaction updates retain pending/uncertain behavior rather than displaying an unconfirmed result.

The subsequent client review closed the remaining saved-sound and book-save gaps. Both generic pickers now reauthorize a reselected sound instead of remaining stuck in checking. Saved IDs resolve beyond the initial browse page, with a bounded four-worker queue and visible partial failures. Favorites requests subscribe before session lookup, pin the initiating owner token and accept only the actual boolean acknowledgment. Both memory-book surfaces serialize saves, retain the draft after failure, read back the actual book and require a status check after any uncertain dispatched write. A late response cannot reload a different book or account. Web story excerpts are checked against the latest duration and excerpt grant before private media hydration.

## Actual browser checks and admin repairs

The reported Content photo route remains repaired. A signed-in QA staff account opened the real selected photo at 1080 × 1920, entered full screen, dismissed with Escape and returned focus to the original photo button. Opening the post retains authenticated staff review context instead of depending on the public viewer's audience rules.

Admin navigation now shows actual router-pending feedback. Clicking Analytics exposed an `Opening Analytics` status, which cleared when the route and dated data loaded. No arbitrary delay is used to pretend navigation completed.

The QA Analytics desk had no daily summary rows and no daily summary cron. A guarded repair verified the existing function and timezone, rebuilt thirty days and installed the established daily schedule. Independent postflight found thirty dated rows and source/summary post counts in agreement. The current charts rendered in the browser. Production analytics were already populated and were not changed. The newly scheduled job's next future execution has not been observed. See [the analytics repair receipt](backend-acceptance-20261030/qa-analytics-repair.json).

The direct walkthrough covered all twenty-six admin destinations and selected real public-app flows: feed and photos, profile, memory collection/search, four-page book and film controls, discovery and categories, video/carousel/playback speed, marketplace, jobs, message filters and requests, call history, channels, communities, notifications, creator overview, partnerships and all earnings views. Data loading was allowed to finish before retrieval was counted. Payouts, empty queues and unavailable music were described by their actual service state.

The [route receipt](interaction-acceptance-20261030/continuation-live-routes.json) identifies the checks and their limits. This is not a claim that all 4,087 inventoried bindings or every possible data-dependent mutation were exercised. No other person was messaged, no real payment was made, no production privacy setting was changed and no commercial recording was activated.

## Evidence and acceptance boundaries

The `ddc968b` checkpoint passed all four hosted type/quality jobs, all seven browser/media groups, the full unsigned iOS Simulator app compilation and six actual iOS Simulator audio-export cases. The [audio receipt](native-audio-20261030/verification.json) measures decoded generated files; the [compiler receipt](native-audio-20261030/continuation-ios-compile.json) independently verifies the artifact digest, successful app link and matching native source hashes.

The six simulator cases cover trimmed/accelerated video with independently looping music, one-pass voiceover, original audio volume, still artwork with sound, invalid-range rejection and cancellation cleanup. They check duration, decoded audio frequency/level and later video frames. This proves more than a source-text assertion, but it does not prove physical Photos-library writes, installed-device behavior or a signed release.

All hosted gates at `f25a0263` subsequently completed successfully: four type/quality jobs, seven browser/media groups, the iOS compilation/audio jobs and the first full Android native compilation. The [checkpoint receipt](interaction-acceptance-20261030/operations-checkpoint-ci.json) verifies that the tested PR merge has the same tree. Its root suite has 1,329 cases, web 621 and admin 189; those counts describe that checkpoint only.

The later complete local client verification using Node 24.22.1 passes 1,390 native/root cases and 621 web cases, with zero failures, cancellations or skips. Native and web TypeScript pass. Web and admin strict lint each have zero errors or warnings. Native/root has zero errors and 432 warnings across the inspected source inventory. The [client receipt](native-audio-20261030/client-followup-verification.json) includes exact changed-file hashes and an aggregate fingerprint; it explicitly excludes the removed, inadequate JavaScript file-copy helper and its superseded tests. These local results are separate from the candidate's hosted Node 22 checks.

New backend verification includes nineteen operations SQL cases, twenty-two catalogue SQL cases, thirty-one original-library compatibility cases, eleven ingestion-handler cases, fourteen maintenance-handler cases and six admin report/action cases. The business/music integration suite executes against both supported prerequisite shapes. Both Edge entrypoints pass the actual pinned Deno 2.1.4 dependency check with TLS verification retained. Counts across fixture modes overlap and are not summed into a unique end-to-end total. See [the verification receipt](music-operations-20261030/verification.json).

The Android production renderer now implements trim and speed, original audio level, looping music, one-pass voiceover, still-to-video encoding, full color matrices and timed flattened artwork. Native source staging bounds document-provider input to 512 MiB and owns cancellation and temporary-file cleanup. Preview remains on Expo Video on Android; the app does not request an iOS-only native view. Android export capabilities remain zero until actual generated-file acceptance succeeds. Android composer video color-editing controls remain unavailable until an accurate native preview is implemented; the encoder can render existing saved color recipes.

The [local packaging receipt](native-audio-20261030/android-local-compile.json) proves that the exact renderer and all twenty-two instrumentation methods compile and package. Its resolved runtime graph has ten Media3 components, all at the reviewed 1.8.1 patch. The [independent source review](native-audio-20261030/android-encoder-independent-review.json) records the resolved lifecycle, input, output and resource findings. Neither receipt claims that an emulator or physical device has executed the test cases.

The full-app Android gate generates an isolated QA project from locked Expo dependencies and compiles the real local Kotlin/native integration. Its acceptance requires the compiled module and renderer, autolink registration, expected application ID and native libraries, an intact APK, and proof that the artifact is unsigned. No APK is uploaded or installed by that gate. A separate Android Emulator job runs the actual production renderer against synthetic local fixtures, checks the executed case inventory, decodes output audio and pixels, verifies source-copy hashes and records the resolved Media3 runtime graph. It uploads diagnostics and synthetic output for seven days. These gates have distinct compile and runtime receipts.

## Release gates that remain separate from source completion

| Gate | Current limitation |
| --- | --- |
| Hosted business/music installation | The supported authenticated migration transport must work before installation, exact postflight, dependent Edge rollout and actual Auth/Storage journeys can be established. |
| Serialized offer response | Candidate migration `20261030181000` is also absent from QA. Native counter-offer capability remains unavailable, and actual competing-session offer acceptance remains unverified. |
| Licensing | Actual agreements, provider-specific integration details, verified territory authority and required commercial report formats remain pending. Catalogue activation stays off. |
| Hosted cleanup and erasure | Actual disposable original upload/finalization, abandoned-upload cleanup, revocation and Storage/CDN/Auth erasure must run against the installed service. |
| Production privacy and administration | The private-media/client compatibility cutover, production administration/erasure rollout and postflight remain open. No production bucket was changed in this continuation. |
| External services | Real business/device approvals, payment and payout confirmation, calls/push, provider database patch and leaked-password-protection settings remain operating-environment acceptance work. |
| Native devices | No physical iPhone or Android surface is connected. Exact failing media, Photos permissions/export, camera/HEIC/HDR, interruptions, offline recovery and accessibility remain unverified on installed devices. |
| Wider composition/product scope | Native whole-book movie encoding, animated/nested-video/dual-camera composition, cross-platform publishing, full ad-set delivery, private deliverable exchange, automatic creator payments and finalized statements remain distinct unfinished capabilities. |
| Native maintenance | Native/root strict lint is not globally clean. Existing warnings require individual lifecycle review; clean web/admin lint and passing builds do not erase them. |

The recorded 30 October dependency audits continue to show zero known registry findings for the unchanged root, web and admin lockfiles. The two local decoder/deepmerge adaptations still need manual maintenance beyond registry advisory coverage, as documented in [the dependency audit](DEPENDENCY_SECURITY_AUDIT_20261029.md). The Android Media3 patch has a separate [primary-source compatibility review](native-audio-20261030/android-media3-patch-review.json) and [direct-coordinate advisory lookup](native-audio-20261030/media3-advisory-review.json); those checks do not constitute a complete Gradle or Android platform security audit.

This branch remains a reviewed implementation and acceptance candidate. It has not been merged, promoted to production, signed for release or submitted to TestFlight.
