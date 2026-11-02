# Controlled capacity rollout — 2026-11-02

This records the controlled production rollout and acceptance checks on 2 November 2026. It does not establish a measured DAU capacity or a public mobile-store release.

**Follow-up at 18:45 UTC:** the production worker now runs the verified 512 MiB Sandbox controller, hosted launch/cleanup/reaping passed, and iOS build 19 is expired under the user's TestFlight hold. See [the final resource rollout record](capacity-resource-rollout-20261102.md). The earlier acceptance observations below retain their original scope.

## Production releases

| Surface | Release | Recorded state |
| --- | --- | --- |
| Web | `dpl_2bc54J3tDSajMe4wGWoF54ik2Jvn` | Promoted to `platinumcircles.app` and `www.platinumcircles.app`; public HTTP and browser login rendering passed |
| Admin | `dpl_DncqiTY9TZBCddGg21KYjiov1tgJ` | Promoted to `admin.platinumcircles.app`; staff sign-in rendered, unauthenticated capacity request returned 401 with private/no-store caching |
| iOS 1.1.0, build 19 | Build `59831393-6f85-4755-94cc-2668295e953f` | Uploaded before the later hold; exact App Store Connect build expired at 17:47:46 UTC, internal/external state EXPIRED; no further build or upload started |
| Android 1.1.0, version code 8 | Build `83bc69b6-ba50-42f3-bca0-fc51624950a3` | Build processing; exact-build submission scheduled for the existing internal track |

Both web deployments use commit `69097b41936a685f56d6e6302f9450b6c7cd6187`, target `production`, and production Supabase project `prlkikhckbifseosbukl`. Their production domains were verified after promotion. Normal automatic domain assignment is enabled again following the explicit promotions.

Native builds use `af986ab7244415e316cda0eb19d48aeb35140e13`. The only differences between that commit and the deployed web release are the two Vercel build configuration files; native runtime source is identical. The build rules now retain preview change detection while allowing explicit production builds within Vercel's command-length limit.

The exact mobile submissions were scheduled using existing credentials, without selecting an older or latest build:

- [iOS upload](https://expo.dev/accounts/donadmiral/projects/platinum-circles/submissions/6fab3e5b-19d2-4dca-bf33-75dca3cabba9): App Store Connect app `6764038613`; upload finished. No new TestFlight group or public release was created.
- [Android submission](https://expo.dev/accounts/donadmiral/projects/platinum-circles/submissions/596032e4-5c2b-4c12-8c36-2c8e02ff74bf): awaiting its exact build, existing `internal` track and `COMPLETED` release-status configuration. That configuration value is not evidence that the submission itself has finished.

## Production backend actions

- Enabled bounded capacity monitoring at one sample per minute. A real scheduled run succeeded, subsequent samples were fresh, and the post-web-promotion sample had no active alerts.
- Deployed compatible ordinary push version 33 and VoIP version 22. Every packaged source file matched its hosted readback. Missing and forged credentials returned 401 for these handlers and the outbox consumer.
- Completed an authenticated, single-use notification-worker acceptance check with empty queues. The completion receipt succeeded and no notification was sent. Restored the scheduled consumer to disabled with its original parallel limit of eight.
- Preserved original Storage bucket visibility and the legacy signed-media handler. Production does not activate the newer content-ticket or adaptive-delivery path in this release.

Optional counter, indexed ranking, broadcast, maintained reporting, notification admission/dispatch, paged reader, media processing and delivery switches remain **off**. Monitoring and the compatible handlers operate independently of those opt-ins. Installation, acceptance and activation are distinct states.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Real authenticated QA API flow | 11 checks passed: feed visibility, like/unlike, idempotent sharing, exact counts, author-view exclusion, card hydration, book paging/window/continuation, inbox paging and capability negotiation |
| QA admin reporting | Maintained dashboard and analytics results matched retained canonical JSON at the same timestamp |
| Book compatibility | 17 focused cases passed, plus existing creative-plan and native-save regressions |
| Account deletion compatibility | 15 focused worker/client cases passed |
| Business compatibility | 65 actual native service/screen cases and 65 actual web-page cases passed |
| Media relay routing | 8 focused cases passed; QA `media-content` version 5 deployed |
| Real QA media delivery | 17 HTTP checks passed, including signed original ranges, adaptive redirects, manifests, segment ranges, ETags and rejected forged capabilities |
| Browser media playback | Chromium decoded 96 frames across an HLS stream with two available levels, completed a seek to 2.5 seconds and reported no fatal playback errors |
| Media revocation and cleanup | Original access returned 403; cached HLS and segment access returned 403 after 32 seconds. One attempt was marked cleaned, zero adaptive objects remained and cleanup backlog was zero |
| Type checking | Final native and web TypeScript checks passed |
| Public production smoke | Web home, login, business login, deletion-status, privacy and terms returned 200 without a server error. Admin home/sign-in returned 200; protected routes redirected to sign-in and `/api/capacity` rejected unauthenticated access |

QA's six new cron registrations were refreshed through the supported `cron.alter_job` API after installation-time registrations did not execute. Subsequent executions and protected worker ticks succeeded. All temporarily enabled QA features were restored off. The book/feed/inbox fixtures were removed, and the original shared media fixture was preserved.

The real media encode/publication used the exact checked-in one-shot consumer locally against the hosted QA broker and Storage. It produced six validated immutable assets in about 15 seconds. Protected QA container-host execution was not verified; its deployment protection remained in place. The hosted gateway, content relay and actual browser playback were verified.

Signed-in hosted web/admin browser acceptance was not established through the protected preview. Automatic approval review rejected creation of its 23-hour share link; that action was not bypassed. The authenticated acceptance reported above used real QA API sessions. Public production browser checks happened after the authorized promotions.

## Compatibility corrections included

The complete candidate expected newer creative-book, bound business-session and durable account-erasure contracts that the production visual baseline does not contain. The release now selects the existing production contracts only from precise missing-endpoint evidence. Authorization failures, malformed responses, outages and partial installations do not downgrade.

Book writes retain the server's actual UUID/void acknowledgements and do not discard requested creative settings. Legacy business sign-in exchanges its token in an isolated Auth client and verifies both the business identity and the unchanged current account. Account deletion stays bound to the captured identity and JWT; its synchronous legacy acknowledgement does not claim physical Storage erasure. See [release operations](capacity-release-operations.md) for these boundaries.

The pre-existing production `business-owner-access` endpoint is absent and remains denied. Existing profile-view/manage navigation is retained separately from the new Studio handoff; no member binding or authority was fabricated.

## Remaining capacity gates

The original release used the 128 MiB media profile. The follow-up provisioned and measured a 2-vCPU/4-GB Sandbox with a durable FFmpeg runtime and deployed the 512 MiB controller to production. A real 536,375,042-byte video produced 18 assets in 38.418 seconds. The normal hosted dispatcher then passed launch, cleanup and automatic shutdown against that durable runtime. See [the acceptance receipt](media-sandbox-512-acceptance-20261102.json) and [final rollout record](capacity-resource-rollout-20261102.md). Optional processing and delivery gates remain off.

The database connection setting was observed as 60 and recorded as an observed limit only. A bounded mixed QA run measured 600 requests at approximately 10 requests/second with zero errors; this is a calibration, not a supported-capacity ceiling. Provider reservations, approved operating budgets and sustained database/network/realtime/media fleet throughput remain unestablished. Vercel Hobby and Supabase Pro are confirmed account plans. No measured five-million-DAU claim is supported by this rollout. The remaining account and procurement gates are described in [the infrastructure budget](capacity-infrastructure-budget-20261102.md).
