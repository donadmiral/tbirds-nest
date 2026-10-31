# Original audio and catalogue readiness — 30 October 2026

This change connects original music and voice recordings to the existing post, story and memory-book products. Commercial catalogue playback remains disabled. The licensed-provider screens store preparation metadata; they cannot grant playback rights or activate a catalogue.

The current database and Edge candidate is revision 3 in `backend-candidate.json`. It includes the retained-storage quota repair described below and has not been submitted to a hosted migration tool. The earlier **revision 2** QA migration attempt stalled without a success, error or approval rejection. Its historical postflight at 17:20:06 UTC found no music schema, bucket, RPCs or migration-history entry, with the old definitions unchanged and no active transaction or lock. No Edge rollout or readiness activation followed. Those historical receipts preserve the revision 2 hash; they are not evidence of a revision 3 installation. Hosted music installation and production acceptance are not complete.

## What is connected

| Surface | Implemented path |
| --- | --- |
| Web and native music pickers | Actual library search, originals, server-persisted favorites, private original upload, excerpt selection, playback preview and saved volume controls. Empty libraries remain empty. |
| Original upload | Auth-bound reservation, private non-upsert Storage upload, server byte inspection, SHA-256 and object-version verification, idempotent finalization and retry. |
| Voice recording | Web microphone capture produces a bounded PCM WAV; native recording uses the existing Expo recorder and uploads its M4A through the same verified pipeline. Recording stops and releases its media resources when the editor is closed or interrupted. |
| Stories | Publication resolves the verified sound on the server, stores its ID and bounded excerpt, and preserves start time and mix in the recipe. Story readers carry the verified ID without changing their table-returning RPC signature. |
| Posts | Existing soundtrack recipes retain verified sound ID, start, duration, music level and source-video level. Audience playback and permission to reuse the recording are separate checks. |
| Memory books | A saved book soundtrack is persisted through an ownership-checked RPC. Continuous film playback supports the book track, retained story excerpts and source-video audio, with background ducking. |
| Web movie download | The existing movie encoder mixes a verified owned book soundtrack and retained story excerpts into the encoded file. Rights are checked before access and again before the download is offered. Music is decoded and mixed into the recording, rather than represented by metadata alone. |
| Library management | Web `/settings/audio` and the native picker’s audio-library sheet expose preview, reuse permission and revocation. Account changes discard old results and pending controls, including an A → B → A change. |
| Admin | `/music` supplies an original-audio review queue, authenticated no-store playback, moderation revocation, provider preparation, territory/use/window and export-rights draft metadata, and an audit trail. Admin navigation and permissions are maintained by the admin lane. |

Soundtrack and story readers require capability version 1 before calling any legacy playable-sound RPC, and independently reject non-original sources. A missing migration cannot expose a legacy catalogue through the new UI. This support check is separate from upload readiness, so verified playback can continue during an upload maintenance window.

Original uploads accept WAV, MP3 and audio-only M4A, from one second to ten minutes, with a maximum of 50 MiB. Microphone capture is limited to thirty seconds. Uploads require the owner’s publication-rights attestation. Reuse is a separate, explicit choice and defaults to off. The legacy integer sound-duration contract conservatively rounds verified duration down; excerpt editors stay inside that bound.

## Supabase contracts

`20261030153811_original_music_library_and_delivery.sql` adds the private `music_library` schema and a private `music-audio` Storage bucket. There are no direct application grants on internal tables. New write tables carry the existing account-erasure actor fences. Service finalization locks/asserts that the owner remains writable before creating audio metadata.

The library stores upload reservations, verified file identity, reuse consent, favorites, provider preparation, license drafts, audit events and service readiness. Reservations are bound to the expected Auth owner, request UUID, canonical object path, MIME, byte count and content digest. A verified object is bound to its exact Storage ID and version. Account limits are checked in the reservation transaction.

New reservations retain the rolling limit of 100 uploads and 1 GiB of declared bytes per 24 hours. Separately, an account can retain at most 1,000 reservation records and 1 GiB of accounted Storage capacity across **all ages and statuses**. Each unverified reservation reserves the bucket's full 50 MiB limit, including expired or revoked unverified entries. This prevents a small declared byte count from understating the capacity a still-unverified object can occupy. Only successful byte verification reduces that charge to the verified file size. Verified originals keep that charge after revocation, because revocation does not delete their bytes. With no verified originals, the capacity limit admits at most 20 unfinished upload slots.

The existing account advisory lock serializes new allocations. An exact retry returns or renews its existing reservation before checking capacity for a new slot. Waiting until tomorrow, expiring a reservation or revoking a sound does not release retained capacity. The app distinguishes `AUDIO_STORAGE_LIMIT` from the rolling `AUDIO_UPLOAD_LIMIT` and directs storage cleanup to support without promising automatic cleanup. Storage remains private, non-overwritable and restricted to each reservation's canonical path.

The finalizer is `supabase/functions/music-asset-finalize`. Its handler performs actual Auth and reservation checks before downloading bytes, checks the complete file, and then calls a service-only completion RPC. Auth reads, streamed body reads, Storage download and service completion share a 45-second deadline. A stalled stream or cancellation promise cannot hold the handler beyond that deadline. The handler returns retryable failure rather than creating an unverified sound. Its `verify_jwt=false` configuration does not skip authentication: the handler explicitly validates the bearer user and the database requires a current Auth session.

All app music entry points require an active profile and a live Auth session. For a business identity, `public.business_session_allowed()` must exist and return true. A missing business Auth contract is a denial. The new public sound-visibility helper also applies this guard to direct `story_sounds` reads, including the owner branch. The SELECT policy is recreated after the legacy rights function is renamed, avoiding PostgreSQL’s retained-OID policy binding.

The database separates three permissions:

1. **Playback:** the viewer owns the original, has reuse permission, or can see the post/story/book that contains it.
2. **Attachment:** the owner or an explicitly permitted reuser may attach the recording to new content.
3. **Export:** the current implementation allows library export only for original audio owned by the exporter. Reuse permission alone does not grant export rights.

The client stores sound IDs and recipes, never a permanent playback capability. Audio is hydrated through authenticated `content-media-sign` requests with `delivery: 'no-store'`, then delivered through the current-session, current-rights media proxy. The signer rejects the old reusable Storage-signing mode for this bucket. Direct Storage SELECT, UPDATE and DELETE are denied to app clients. A canonical public-shaped URL is an object identifier; it does not make the private bucket public.

Revocation is checked when a capability is redeemed. Players also recheck current rights at least every thirty seconds and when returning to the foreground, so a previously buffered recording is paused when its permission is lost. Downloaded bytes cannot be recalled. No-store delivery and revocation checks do not constitute DRM.

The existing erasure worker and review allowlist include `music-audio`. The migration requires the established erasure and media-delivery prerequisites, checks the exact supported allowlist anchor, and fails if those contracts differ. Tests exercise the real queue progression: false Storage acknowledgements are denied; actual Storage-row deletion permits acknowledgement; app metadata and Auth deletion then cascade through the music records. A service finalizer is rejected once erasure has been accepted.

## Licensing boundary

`MUSIC_CATALOG_ENABLED` stays false. Provider rows can be awaiting licensing or suspended; draft license records can be awaiting licensing or rejected. The admin command contract deliberately has no license-activation command. Adding a provider name or draft contract reference cannot enable audio.

The preparation form records provider, rights holder, contract reference, territories, permitted uses, rights window, requested export permission and review evidence. Later licensing work must supply and verify the actual agreements, provider ingestion/delivery contract, territory determination, reporting obligations and activation authorization. No commercial catalogue was fetched, scraped, embedded or represented as licensed by this change.

Provider-specific catalogue ingestion, delivery and usage/rights reporting are not implemented by these preparation forms. They remain technical work against the selected provider contracts, separate from signing a licence. This report does not claim that the entire catalogue service is finished with only licensing left.

Existing unverified legacy sounds are not silently promoted into the new library. They require verified re-upload or a separately reviewed import. The independent QA compatibility preflight on 30 October at 17:06 UTC found zero legacy sound rows or story/post/book audio references in that isolated environment. Production compatibility still needs its own inventory.

## Installation and rollout

1. Confirm the exact project and candidate SHA-256 from `backend-candidate.json`. Inspect active locks and transactions, existing migration history, the prerequisite `media_delivery` and `account_erasure` functions, affected function/policy definitions and Storage ACLs. Do not apply this candidate alone to a database missing those prerequisites.
2. Apply the reviewed transaction once to isolated QA. Check that the migration history, private schema, bucket, policies, function ACLs and business-session denial match the candidate. Do not infer success from a connector timeout.
3. Deploy the exact finalizer and the reviewed media signer, media-content and erasure-worker bundles, including their shared imports. Verify deployment versions and actual authentication failures before activating uploads.
4. The migration installs `music_library.service_state.uploads_enabled=false`. Authenticated clients read `get_original_audio_capabilities()` and show an explicit unavailable state until the service is ready. Ordinary app users and the music admin screen cannot change readiness.
5. After the worker rollout is verified, a service operator can use `set_original_audio_service_ready(true, reason)` for the isolated acceptance environment. This is a logged operation. Perform the actual authenticated upload → verification → preview → publication → audience → revoke → erase journey there. Turn readiness off if that journey fails.
6. Production rollout is a separate reviewed cutover. It must account for installed-client compatibility, existing legacy audio, production privacy prerequisites and real provider behavior. The current music work does not switch unrelated production media buckets to private.

Turning readiness off prevents new reservations and Storage inserts without discarding already verified owned audio. It is the immediate maintenance control. Schema rollback, erasure rollback or restoring revoked media is not implemented by deleting migration history.

## Verification

The focused database suite is `supabase/tests/rpc-authorization/test-original-music-library.mjs`. It executes the migration against the deployed-schema fixture and the prior privacy/erasure chain, and also runs with the earlier sound-rights contracts installed (`MUSIC_FIXTURE_PREEXISTING=1`). Both modes pass **31 checks** and are registered in the persistent RPC CI runner. Nine quota cases cover expiry, underdeclared unverified files, verification credits, revoked verified and unverified entries, the retained-record cap, the separate daily limit, ordered competing allocations with owner isolation, and erasure of an unfinished expired object. PGlite has one connection; these cases do not establish real multi-session lock contention. These are executable database contract tests, not a substitute for hosted acceptance.

The **19** original-audio infrastructure cases cover actual WAV/M4A/MP3 parsing, malformed/truncated bounds, canonical private identities, finalizer ownership/version/hash checks, retry, revocation during verification, refusal of legacy signed audio, complete deadline behavior, readiness, upload account-generation fences and distinct storage/daily-limit recovery copy. The **8** library state cases exercise the real web/native component handlers for account changes, duplicate actions, stale completion, token refresh and stalled-read recovery. The existing focused soundtrack interaction and playback gates pass: **21** draft/picker cases, **14** native story-audio cases and **7** web story-audio cases, including missing-backend and catalogue-row rejection.

All eight affected memory/story harnesses pass after adapting their genuine component execution to layout effects, keyed lifetimes and the new audio hooks: web film 10, web film lifecycle 6, shelf refresh 3, story-quality 20, native/shared film 14, native film lifecycle 8, memory story presentation 17 and stability 14. Existing assertions about buffering, media clocks, teardown, navigation and private draft recipients remain intact.

Owned music runtime paths pass strict lint with zero errors and warnings. Native/root and web TypeScript checks pass at the source freeze. Global native warning counts, full repository CI and other product acceptance gates are reported by the parent delivery report rather than inferred from these scoped checks.

### Genuine browser gate

`web/tests/browser/music-library-export.cjs` compiles actual upload, player and movie components with synthetic account transport. It generates a test tone, runs the actual Edge finalizer, records microphone PCM through the browser, encodes book and retained-story audio, decodes the resulting media with FFmpeg, checks audibility across a page boundary, revokes rights during export, verifies no download is offered, and checks recording-resource teardown and a narrow viewport.

The final hosted Chromium run passed at source `8591b1a36f0a47d6493af6f8fa0a336d7421ec92`: [workflow 41120017245](https://github.com/donadmiral/tbirds-nest/actions/runs/41120017245), job `124284059637`, browser `153.0.8010.12`. CI checked the PR merge `af66ad4914cb039e9058292607509389afc43103`. All seven substantive gates passed: admin 37, public web 38, commerce 24, Studio 25, graded-story export 8 cases, full-memory movies 19 cases and original music 5 named cases with the upload, preview and narrow-viewport assertions. The workflow retained 56 JSON/PNG evidence files in artifact `13007777993`.

The actual 720 × 1280 book movie lasted 6.006500 seconds. Its decoded 440 Hz amplitude was 0.087070 in the first memory and 0.088294 after the page boundary. The retained-story movie lasted 6.013700 seconds; its amplitude was 0.087071 in the first memory and exactly zero after that memory ended. Both exports also produced a real frame at 5.2 seconds with the second memory's expected champagne background. Each audio measurement covers exactly 19,200 samples at 48 kHz; the original audible and silent thresholds remain unchanged. These are frequency amplitudes, not RMS values.

Revoking rights during rendering prevented a download link. Browser microphone capture produced a verified 2.321995-second recording. Cancelling another recording closed its audio contexts and tracks without another upload. The music run had no browser errors and no horizontal overflow at 390 pixels. Exact source identities, workflow steps, artifact digest, decoded media results and the fixture boundary are preserved in [final-browser-export.json](final-browser-export.json).

This is a completed **hosted browser** gate. Chromium is absent in the local execution environment, so no local browser run is claimed. The actual components, finalizer handler and encoder run with synthetic account transport; this success does not verify hosted Supabase Auth/Storage, install the music migration, or establish real-device behavior.

## Remaining operating-environment checks

- Actual hosted QA installation, finalizer deployment, readiness activation and authenticated acceptance are recorded separately. Production has its own prerequisites and cutover.
- Installed iPhone/Android microphone behavior, audio routes, interruption handling, file pickers, HEIC/HDR context, background/foreground changes and Photos export still require the real-device pass.
- Native whole-book composed movie encoding and animated-artwork, nested-video and dual-camera movie exports remain unsupported. The web encoder rejects these cases before silently dropping their content.
- The current original-upload retry retains a stable request within the active app runtime. Abandoned and expired reservations are not automatically garbage-collected. They continue to consume the retained-record and conservative Storage budget, so their accumulation is bounded. Account erasure includes their owned Storage objects even when no sound was finalized. Automatic cleanup remains an operational limitation; any later cleanup must delete and verify Storage bytes before releasing retained capacity, without granting app deletion privileges.
- Third-party catalogue agreements, activation, provider delivery and rights reporting remain the intended licensing handoff. No “fully licensed” or “all devices verified” claim is made.
