# Platinum Circles interaction repair and music infrastructure

Date: 30 October 2026. Branch: `codex/app-quality-20261029`. Review: [draft PR #3](https://github.com/donadmiral/tbirds-nest/pull/3).

This report continues the earlier [design delivery](DESIGN_COMPLETION_20261030.md). Historical reports retain their original source identities and observations. The final implementation is published at `8591b1a36f0a47d6493af6f8fa0a336d7421ec92`, tree `873614d8f4ac64815417e06208008a070274b658`. CI checked PR merge `af66ad4914cb039e9058292607509389afc43103`; its tree is exactly the same. The final publication and hosted results are recorded in the [companion verification receipt](interaction-acceptance-20261030/final-hosted-verification.json). A later evidence-only commit does not change the tested implementation.

## Outcome and release decision

The reported admin Content photo error is fixed and verified against the actual signed-in QA account. The authenticated review route now opens the protected image and its context. Full-screen dismissal retains the selected record and restores keyboard focus. The public web, admin and native reliability repairs are saved on the review branch, with independent regression evidence.

Original-audio infrastructure now has Supabase schema, authorization, private Storage, file verification, playback delivery, revocation, erasure integration and matching web/native/admin clients. It includes microphone capture and actual web movie audio mixing. Commercial catalogue activation remains disabled, as requested.

**This is a tested review delivery, not final production acceptance. TestFlight remains on hold.** The new hosted music and business Auth installations are absent after the recorded migration-connector stalls. The app therefore keeps unavailable functions disabled. Physical devices, production privacy/erasure and real external-provider transactions are not established by these results. Native lint also retains warnings.

## Protected review applications

| Application | Verified address | What was observed |
| --- | --- | --- |
| Admin | [Content desk](https://admin-web-git-codex-app-quality-20261029-intobank.vercel.app/content) | Actual posts, protected full-resolution photo, mixed attachment selection and video playback, full-screen Escape/focus, protected review and return |
| Public web | [Home](https://platinum-web-git-codex-app-quality-20261029-intobank.vercel.app/home) | Actual feed and profile, full-resolution photo viewer, zoom/reset/Escape, Settings, Story Text cancellation, music availability, Studio and earnings |
| Original audio | [Audio library](https://platinum-web-git-codex-app-quality-20261029-intobank.vercel.app/settings/audio) | Management route, capability check, disabled upload/recording while QA backend is absent, Retry and return to the app |

These are protected branch aliases, not public bypass links. They follow the quality branch. No temporary review token was created and deployment protection remains enabled. QA accounts are separate from production accounts. The [walkthrough receipt](interaction-acceptance-20261030/live-qa-walkthrough.json) separates earlier and current source observations.

## Reported photo error and admin repairs

The old Content action sent staff into a public post route. That route could correctly reject an institution-scoped or private-community post even when the staff member had moderation authority. The repair adds `/content/[id]` inside the operations app, checks `post_moderate` before querying and uses current staff-session media delivery. It does not make the original post or its bucket public.

The actual affected QA post, `dd607e75-0383-4f75-9301-c2f96aa8ae7d`, was reviewed in the browser. Its 1080 × 1920 image decoded, its institution scope and audience remained visible, and author, caption, conversation, reports and deterministic return links loaded. Back to Content returned to the selected post.

A second defect appeared during interaction verification: Escape from full-screen media could close the parent record and lose focus. The photo trigger now remains mounted while hidden, focus is captured before hiding it, nested Escape is consumed correctly and dismissal restores the original trigger. The browser check confirms that only the media dialog closes. Gallery rendering also accepts a valid gallery without requiring a redundant single-media property.

The live mixed-media check selected the second attachment of `b531613a-9f36-4f86-82e7-f00e54b55f34`. The 720 × 1280 video loaded without a media error, retained its saved trim and actually played. These observations are separate from synthetic gallery and error-state tests.

The established admin visual system remains in place: consistent icons, navy navigation, champagne accents, light/dark/system appearance, role-filtered tools, breadcrumbs, selection controls, clear return paths and keyboard-contained dialogs. Creator finance now reads the real server snapshot with session/permission checks, exact monetary values, pagination and explicit recovery. The actual QA snapshot showed one enrollment and no payouts, with enrollment closed; stored records are not represented as proof that a payment provider is ready.

## Public web and native reliability

Public-web cleanup stabilizes browser clients, scopes reads and drafts to the current owner, and rejects delayed responses after account or filter changes. Failed reads retain useful context and offer Retry. Identity is rechecked before writes. Private and blob-backed images keep their authenticated delivery path. Nested page landmarks and stale error/type adapters were repaired without inventing empty backend success.

The current signed-in web pass verified a 1080 × 1920 photo, 150% zoom, reset to 100%, Escape and focus return. It also exercised More → Settings, Home → text Story, Story Text Cancel, the music picker → Manage audio, the unavailable-upload Retry and the exit back to Home. Creator Studio and its earnings, payouts and payout-account tabs showed real account state and the unconfirmed IntoBank connection. No content, message, payment or privileged command was submitted during this walkthrough.

The final native follow-ups address concrete reproduced behavior:

- Email verification checks the expected email and confirmed Auth identity. Account changes, sign-out, unmount and overlapping foreground polls cannot install stale verification results.
- Counter-offers use a native review/cancel dialog on both platforms. Exact amount validation, current-offer checks and duplicate-tap locking precede submission. An uncertain response offers Check status without replaying the mutation. The new flow requires the serialized backend capability and stays unavailable until it is installed.
- Feed draft hydration no longer overwrites words or switches changed while storage is loading. Persistence waits for hydration, and account/unmount changes invalidate old reads and pending writes.
- Follow/unfollow checks Supabase's returned error, rolls back the matching operation and offers a visible Retry. Retry first reconciles possible server success. Reads started before or during the mutation cannot overwrite its newer result.
- Authentication callbacks, private media failures and push-registration diagnostics no longer log raw tokens, signed URLs or unfiltered provider errors.

These are source/component and hosted quality checks. No physical iPhone or Android device was available. Neither the simulator build nor browser fixtures establish which native binary is installed on a phone.

## Music infrastructure and licensing boundary

| Layer | Implemented behavior |
| --- | --- |
| Library and picker | Search, originals, server-persisted favorites, preview, excerpts, saved music/source levels and owner-scoped management |
| Upload | Current-session reservation, stable retry identity, non-upsert private object path, byte/hash/version checks and service-only finalization |
| Accepted originals | WAV, MP3 and audio-only M4A; 1 second to 10 minutes; maximum 50 MiB; publication-rights attestation |
| Recording | Web microphone capture to bounded PCM WAV; existing native Expo recorder to the same verified upload pipeline; 30-second bound and resource cleanup |
| Consent | Publication rights and permission for others to reuse are separate; reuse defaults off |
| Posts and stories | Verified sound identity, bounded excerpt, music level and original-video level stored with the actual recipe |
| Memory books | Ownership-checked book soundtrack; continuous playback, retained story excerpts, source-video sound and ducking |
| Web movie export | Actual audio decoding/mixing into the encoded file; ownership/export checks before delivery and again before offering download |
| Delivery | Private `music-audio` bucket, current-session/current-rights no-store proxy, direct app Storage read/update/delete denied |
| Revocation | Permission checked at delivery, periodically during playback and on foreground return; revoked export does not offer a download |
| Erasure | Music objects participate in the existing Storage-first erasure queue, owner write fences and metadata/Auth deletion ordering |
| Admin preparation | Original review/revocation, provider preparation and rights/territory/use/window/export draft metadata with audit history |
| Activation | Upload readiness defaults off; missing capability is unavailable; catalogue activation is absent from the admin command contract |

The final retention guard adds a 1 GiB per-account allocation bound and a maximum of 1,000 retained reservations across all ages and states, in addition to the daily limits. An unverified reservation is charged the full 50 MiB bucket limit, including when expired or revoked; this prevents a false small byte declaration from reserving unbounded uploaded storage. Only service-verified originals are charged their verified bytes. Exact same-request retries retain their existing allocation. Revocation alone does not promise to free stored bytes.

The audio backend is independently reviewed against both supported prerequisite states. Tests exercise actual SQL policies and grants, current Auth/session checks, business-session denial, revoked/expired reads, service-only finalization, erasure races and retained capacity. The previous policy-OID binding issue was repaired by recreating the sound SELECT policy after renaming the legacy helper. The finalizer has bounded Auth, download, body-read and completion deadlines.

**Licensing remains the intended commercial boundary.** No commercial catalogue has been acquired, scraped or enabled. Provider and agreement drafts cannot activate it. Future activation requires actual agreements, provider integration, territory decisions and the agreed rights/reporting controls. Existing unverified legacy audio is not automatically promoted into verified originals.

Provider-specific catalogue ingestion, delivery and usage/rights reporting are also unimplemented. The provider and agreement preparation screens do not constitute those services. This delivery therefore does not claim that every music capability is complete with only a licence signature remaining.

The [music infrastructure report](music-infrastructure-20261030/README.md) and [candidate manifest](music-infrastructure-20261030/backend-candidate.json) contain the exact migration/Edge hashes, contracts, installation order, tests and limits. The last stalled hosted attempt used the previous candidate; its historical receipt is not evidence that the final revised candidate was applied.

## Verification and interpretation

The final companion receipt identifies the exact tested source, GitHub runs/jobs, program counts, encoded-media measurements and preview versions. Evidence uses three distinct levels:

1. Source and component/database regressions execute the implementation with stated fixtures.
2. Hosted Chromium tests execute actual components and encoders with synthetic transport and accounts; FFmpeg decodes the generated movies.
3. Authenticated QA walkthroughs use real sessions and existing authorized QA data.

| Final verification | Result | Evidence boundary |
| --- | --- | --- |
| Native, web and admin TypeScript | All three passed | Exact published implementation tree |
| Native registered Node cases | 1,236 passed; zero failed or skipped | Source/component regressions |
| Public web registered Node cases | 621 passed; zero failed or skipped | Source/component regressions |
| Admin registered Node cases | 183 passed; zero failed or skipped | Source/component regressions |
| Supabase database/Edge baseline | 296 passed, zero failed, three complementary-mode skips | Synthetic data and provider transport |
| Music database contracts | 31 passed in each of two prerequisite modes | Executable SQL policies/ACLs; no hosted installation or real concurrent sessions |
| Serialized offer response | 15 passed | Compatible RPC contract and row-lock plan; no hosted installation |
| Edge pinned-IP TLS/cancellation | Two passed | Actual local HTTPS within the pinned Edge runtime |
| Browser and encoded-media gates | All seven passed | Actual Chromium/components/encoders with synthetic account transport |
| Final unsigned iOS Simulator compilation | Passed; required Swift objects compiled and the x86_64 app executable linked | Compilation only; no physical device, signed archive or TestFlight submission |

The [type and quality workflow](https://github.com/donadmiral/tbirds-nest/actions/runs/41120017613) completed all four jobs successfully. Database suites intentionally exercise multiple prerequisite modes, and some cases overlap between runners; these counts must not be added together as unique end-to-end journeys. The companion receipt retains every Node summary block and the complementary skips.

The final [iOS compiler run](https://github.com/donadmiral/tbirds-nest/actions/runs/41120017251) used Xcode 16.4, iOS Simulator SDK 18.5 and the locked Expo/CocoaPods dependencies. Its downloaded artifact digest was verified; the required native source hashes match the published workspace, and the compiler log contains `BUILD SUCCEEDED`. See [the compiler receipt](interaction-acceptance-20261030/final-ios-compile.json). No archive, IPA, device installation or upload was performed.

The original-music browser test verifies upload/finalizer behavior, preview, continuous book audio, retained audio ending at its memory boundary, revocation during export, microphone verification, cancellation cleanup and a narrow viewport. Its analyzer resamples to 48 kHz and measures exactly 19,200 samples. It distinguishes an ended audio stream from a failed decode and also decodes a frame at 5.2 seconds to prove the second memory exists. Audible/silent thresholds remain unchanged. Synthetic transport does not establish hosted Auth/Storage acceptance.

The final [browser workflow](https://github.com/donadmiral/tbirds-nest/actions/runs/41120017245) passed all seven substantive gates: admin 37, public web 38, commerce 24, Studio 25, graded-story export 8, full-memory movie 19 and original music 5 named cases with additional upload, preview and narrow-viewport assertions. Its 56 retained evidence files and exact measurements are indexed in [final-browser-export.json](music-infrastructure-20261030/final-browser-export.json).

The actual 720 × 1280 book movie lasted 6.0065 seconds and retained audible music in both memories. The retained-story movie lasted 6.0137 seconds, contained the second memory's video frame, and its soundtrack was silent after its own memory ended. Revocation during export prevented a download; microphone capture produced a verified 2.322-second recording; cancelling another recording ended its resources without uploading it. These are actual encoded-file checks with synthetic account transport.

Web and admin strict lint are clean. Native/root has zero lint errors but **462 warnings across 117 files**. These include 223 hook-dependency and 222 unused-declaration warnings. Some hook findings refer to stable animation values or refs; they require individual lifecycle review. Counts alone do not identify exploitable bugs, and blanket suppression or dependency insertion was not used. See the [native review receipt](frontend-reliability-20261030/native-warning-review.json).

Recorded 30 October registry audits are zero for native/root, web and admin; the same result appears in the subsequent hosted locked installations. The two local decoder/deepmerge adaptations still require manual maintenance outside npm's advisory coverage. See [the dependency audit](DEPENDENCY_SECURITY_AUDIT_20261029.md).

## Remaining release gates

| Gate | Concrete position |
| --- | --- |
| Hosted music installation | Last checked QA music schema, bucket, capability and reserve/finish contracts were absent after a stalled `apply_migration`. No dependent Edge rollout or upload activation followed. The revised candidate is source-tested, not installed. |
| Business authentication | QA business Auth schema/owner contract remain absent after connector stalls; eight dependent Edge deployments and actual reserve/create/bind/finish/device acceptance remain open. |
| Offer response installation | The compatible serialized migration and 15 database cases are included. Hosted installation and real competing-session contention have not been performed. |
| Production privacy and erasure | Five relevant production buckets remain public. Production erasure schema/worker are absent. Installed-client compatibility, expired/revoked access, warmed caches and a disposable Storage/CDN/Auth erasure remain required. |
| Production admin and database | QA central commands, provisioning, deletion queue and hardening are installed. Their production rollout/postflight remains open; production still lacks those three central admin contracts. |
| External providers | Leaked-password protection, provider database patch, actual multi-account/device journeys, real payments/payouts, calls/push and other external integrations require operating-environment acceptance. |
| Physical devices | Exact failing files, Photos export, camera/HEIC/HDR, Story Text/crop/keyboard, sticker gestures, interruptions/audio routes, two-device delivery, offline/cold-launch and accessibility/palettes remain unverified on an installed phone. |
| Composition and professional features | Native whole-book movie encoding, animated/nested-video/dual-camera export, cross-platform publishing, full ad-set delivery, private deliverable-file exchange, automatic creator payments and finalized statements remain unfinished. |
| Catalogue services | Provider-specific ingestion, delivery and usage/rights reporting are not implemented. Provider/agreement metadata and disabled activation are preparation, separate from obtaining commercial licences. |
| Audio storage maintenance | Retained capacity is bounded. An automatic abandoned-upload cleanup worker is not implemented; account erasure includes abandoned objects. |
| Native maintenance | The 462 warnings need individual review. They are not hidden by clean web/admin lint or passing builds. |

The migration interruptions were **connector stalls, not automatic approval rejections**. Read-only postflights found no matching installed migration, active candidate transaction or waiting lock. The [backend coverage map](backend-acceptance-20261030/final-backend-coverage.json) records source, local, QA and production positions separately with their observation times. No alternate DDL bypass, production privacy switch or TestFlight release was used to conceal the blocker.

## Evidence index

- [Authenticated walkthrough](interaction-acceptance-20261030/live-qa-walkthrough.json)
- [Admin photo review](interaction-acceptance-20261030/admin-authenticated-post-review.jpg)
- [Current web Home](interaction-acceptance-20261030/web-authenticated-home.jpg)
- [Final lint](interaction-acceptance-20261030/final-lint.json)
- [Exact final hosted verification](interaction-acceptance-20261030/final-hosted-verification.json)
- [Final iOS compiler receipt](interaction-acceptance-20261030/final-ios-compile.json)
- [Decoded browser exports](music-infrastructure-20261030/final-browser-export.json)
- [Published source comparison](interaction-acceptance-20261030/source-publication.json)
- [Protected review deployment identities](interaction-acceptance-20261030/review-deployments.json)
- [Music implementation and installation](music-infrastructure-20261030/README.md)
- [Backend deployment coverage](backend-acceptance-20261030/final-backend-coverage.json)
- [Native verification and counter-offer repair](frontend-reliability-20261030/native-verification-counter.json)
- [Native draft/follow repairs and residual warnings](frontend-reliability-20261030/native-warning-review.json)
- [Earlier complete design and workflow scope](DESIGN_COMPLETION_20261030.md)

The records preserve what was checked and what is still blocked. They do not claim zero defects, a self-assigned 10/10 rating, remote recall of downloaded media, or physical-device acceptance.
