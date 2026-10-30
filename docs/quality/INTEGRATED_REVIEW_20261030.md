# Platinum Circles integrated review checkpoint, 30 October 2026

This checkpoint continues the previous quality branch and recovers its unpublished link-preview, deletion-review and feed-restoration work. It is prepared for review through draft PR #3 in `donadmiral/tbirds-nest`, on `codex/app-quality-20261029`. The final published commit and hosted gate results belong to the PR and deployment records; this document records the source and hosted QA evidence available before publication.

The app is not accepted as universally complete. Physical-device and provider acceptance, the production private-media cutover and the existing TestFlight hold remain explicit release boundaries. No zero-defect guarantee or self-assigned design rating is claimed.

## Implemented and repaired

- Continuous native and web memory films include the original instrumental score, looping progression, accessible playback controls, saved video excerpts and timed artwork. This checkpoint repairs paused/background loading deadlines, stale media callbacks, post-readiness video stalls and terminal native player recovery. Photo artwork now follows the same paused playback clock.
- Native graded MP4 and browser composed-video export are implemented. The browser export now measures the recorder timeline correctly, verifies the selected first frame and rejects an oversized final chunk. The encoded-output fixture preserves pixel, sound, timing and duration assertions and supports actual range seeking.
- The admin uses the redesigned operations layout, table/detail review, search, responsive navigation, light/dark/system appearance and presentation/export controls. This checkpoint adds keyboard-safe unclipped menus, truthful clipboard/storage failures, identity-scoped presentation storage, bounded collection behavior, spreadsheet-formula-safe CSV output, explicit sampled export counts, accurate failed-read states, business pagination and preserved organization filters. New staff invitations default to Read-only Auditor.
- The three admin contracts are present: general commands/support operations, staff/business provisioning and deletion requests. Retryable deletion review is available, and ordinary restore commands cannot reactivate an account with pending or held erasure. Newly reserved staff identities are socially isolated before Auth creation, including failed setup, while their verified operations sessions remain valid.
- Link previews use the authenticated, pinned-IP server transport and verified cache. The native composer preserves a deliberate dismissal against late refreshes and refuses to publish an old preview URL with changed text. Feed tab restoration preserves confirmed ordering and scroll state.
- The business application form now exposes read failures, rejects stale username results, fences account changes/unmounts, prevents duplicate operations and supplies persistent labels for all eight fields.
- The old vulnerable decoder dependency path is replaced by the reviewed compatibility adaptation, not merely protected by a deep-link guard. Fresh root/web/admin registry audits report zero findings. The local decoder and merge adaptations still require the separate manual provenance and consumer tests described in `vendor/README.md`.

## Verification

`COMPLETION_GATES_20261030.md` and its JSON distinguish full-run evidence from later focused additions. The final inventory contains 193 application test files and 1,785 reported passing cases, plus three separately reported assertion suites. Root, web and admin typechecks pass. The RPC baseline plus focused additions account for 414 registered cases, 413 passes and one intentional fixture skip; the complementary Supabase Node gate has 275 passes and three explained skips. The two Deno 2.1.4 HTTPS transport cases pass in their actual runtime. These overlapping gates are not summed into a unique test count.

The admin browser fixture passes 24 interactions with no runtime errors. Its desktop light, desktop dark, mobile and presentation screenshots are in `admin-ui-20261030/`; these are real production components with visibly labeled synthetic records. They are not live-member screenshots.

The browser video fixture passes five cases on exact CI Chromium 153 and Chromium 156. The earlier native hosted log shows successful compilation, followed by a failed postflight. This checkpoint corrects the architecture-check argument order and retains its diagnostics. The complete native gate must pass on the published checkpoint; compilation is not device acceptance.

## Hosted QA changes and access checks

The connected QA project is usable through the SQL and Edge tools despite its absence from the project listing. Branch-specific QA preview settings already exist. The old configuration-validation blocker is therefore no longer the current source-build blocker.

Root applied and verified these exact forward migrations on QA only:

| Migration | Verification receipt |
| --- | --- |
| Account erasure operator review | `QA_ERASURE_OPERATOR_POSTFLIGHT_20261030.json` |
| Account erasure restore guard | `QA_ERASURE_RESTORE_POSTFLIGHT_20261030.json` |
| Future staff social isolation | `QA_STAFF_SOCIAL_SHELLS_POSTFLIGHT_20261030.json` |

Postflight checks confirm the reviewed definitions, closed execution/table permissions and unchanged 1 Auth identity, 1 profile, 1 staff record and 15 Storage objects. No Auth identity, erasure job or provisioning reservation was created by this review. No production migration or bucket transition was performed.

An anonymous byte request to an inspected existing QA object was denied through both its public and authenticated Storage routes. Both returned JSON errors with no image/video/audio bytes. The receipt hashes the path instead of publishing it: `QA_KNOWN_MEDIA_URL_DENIAL_20261030.json`. This is an anonymous-denial check for that known QA object, not a claim covering every object, unrelated authenticated identity, warmed cache or copied valid capability.

The existing authenticated owner browser session successfully opened the real dashboard, staff directory, support inbox, moderation posts, user directory, deletion-request queue and business desk. The empty support/deletion/business queues matched the inspected QA data. A private moderation image rendered at 1080×1920, and the video attachment loaded with valid dimensions/duration, no media error and working play/trim controls. The media elements used `/api/moderation-media`. The inspected browser log contained no application errors; browser-extension diagnostics were kept separate. One user-directory navigation exceeded the initial 15-second wait and then loaded, so this is not a performance acceptance claim.

That live walkthrough used deployment `dpl_DYW2Dt96kdr7YjfcDFn3mmciaK9K`, source `18dd2b3db9975eb529599702c8e300e165eeadac`, with the updated QA database. It does not substitute for a walkthrough of the new source checkpoint. The new source's UI behavior is covered by the distinct component/browser fixtures and upcoming build gates.

The web preview required Vercel authentication. Automatic approval review rejected creating or reusing a temporary share URL because possession would grant access to the protected preview. No protection setting was weakened, and the rejected operation was not retried through another tool. Continuing that browser path requires an authenticated Vercel session or explicit approval of the scoped temporary sharing step.

## Remaining acceptance

1. Verify all hosted quality, browser and native compile checks for the published source and the two new QA review deployments.
2. Complete real Auth reserve/create/finish with disposable identities and a verified cleanup route; exercise allowed and denied staff commands, support writes, moderation, verification and operator deletion actions against suitable QA records.
3. Execute actual Storage/CDN/Auth account erasure, including interrupted retries and held requests. Prove expired/revoked delivery, unrelated authenticated access denial, warmed caches and installed-client compatibility before making production media buckets private.
4. Replay the user's exact failing iPhone media and the physical story/edit/export, sticker, camera/HEIC/HDR, messages/two-device/push/calls/audio, feed/offline/cold-launch and accessibility/palette journeys. The currently installed binary does not establish acceptance of the new native modules.
5. Complete external-provider configuration and behavior, role journeys and the outstanding provider Auth leaked-password setting. Intentional closed RLS tables and security-definer grants require their permission-based review; advisor counts alone are not exploit counts.

Licensed catalogue music, whole-album movie download, animated GIF/sticker export, nested-video/dual-camera export and export of added songs/voiceover are not supplied by the current visual composition path. They must not be represented as finished. The original memory score and source-video audio are the verified available audio features.

TestFlight stays held. The broader quality branch has not been promoted to production.
