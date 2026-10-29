# Platinum Circles app quality sweep — 29 October 2026

## Current decision

**TestFlight is on hold.** This pass repairs the reported issues, investigates neighboring paths, and produces a reviewable source branch. It does not claim that every feature has passed physical iPhone acceptance, and it does not create, submit or release a new iPhone build. The currently installed iPhone app does not contain these new client changes.

Source branch: `codex/app-quality-20261029`, based on production source `9906c187521c59254277a00571bded3c8db49b98` in [donadmiral/tbirds-nest](https://github.com/donadmiral/tbirds-nest). The branch contains native, web and admin changes. Three narrow database repairs are already live; client source publication is separate from a production frontend rollout.

This is the current quality decision. Earlier release-evidence files in this repository are historical checkpoints and are not evidence that this pass has reached the user's satisfaction or that its new source is installed.

## Each reported issue

| Report | Investigation and implemented repair | Evidence and remaining limit |
| --- | --- | --- |
| A shared post disappears when Text is opened in a story | The native text sheet covered the composition, and a reference card could enter the generic empty-text deletion path. The editor now preserves the composition, opens text editing only for text, and keeps reference cards in placement editing. Canceling or saving an empty new text sticker cannot delete the post. | Actual native and web editor handlers are tested. Physical keyboard presentation and card gestures still need an iPhone check. |
| Text-only post shares become blank | Share construction did not consistently fall back from `content` to `body`. The shared card also reserved blank media space. Both paths now preserve the text and author/source links, with a readable text-only layout. | Text/card geometry and publication regressions pass. Long text remains an excerpt with a link to its source rather than a promise to fit an unlimited post into one story frame. |
| Brightness and other story adjustments do nothing | Slider hit handling, replacement of the adjustment recipe during crop, incomplete viewer parsing and approximate overlays were separate causes. Photo adjustments now use actual color-channel processing through Skia on native and the matching sRGB matrix on web. Crop preserves the rest of the recipe. | Seven tests render actual Skia pixels. Save orchestration includes adjusted photos, text, cards, drawings and stickers. Real iPhone PNG capture, HEIC/HDR orientation and performance still need acceptance. Video color grading and composed video export remain unfinished. |
| Stickers should appear two side by side and move properly | The gallery now uses explicit two-item rows instead of a wrapping width calculation. Shared cards open placement tools; text editing cannot delete them. Existing move, pinch, rotate and delete controls remain available. | Editor/gallery tests pass. Multi-touch feel, precise hit areas and small-screen layout are not certified without hardware. |
| Profile says some media is unavailable | The reader confused pending signing with unavailable media, and did not consistently renew expiring media capabilities. Own/other profiles now distinguish loading from failure, retry failed reads, and renew visible media on foreground/minute checks while preserving list state. | Production inventory found all 22 inspected active attachment objects and all 26 inspected canonical visual references. This is not evidence that the reported device decoder/network failure is fully reproduced or eliminated. |
| Memory albums should move automatically with background music | Added optional **Play book** alongside the existing manual book, covers and page turns. Ordinary photo/video pages advance automatically, photos move gently, pause/resume and backgrounding preserve progress, reduced motion is respected, videos advance at the saved end, and Replay restarts from the first page. Soundtrack activation can remain continuous between pages. | Timing/lifecycle tests pass. Licensed music is still disabled pending the provider/rights contract. Embedded shared-post videos still use their full-view route. A single downloadable, fully composed memory movie is not implemented. |
| My Applications reports a missing function | Production lacked the applicant self-service migration already expected by the client. Applied the existing checked applicant page and withdrawal contracts, with audited, version-checked withdrawal and account isolation. | Exact-production-chain database tests reproduce the missing function before repair. Live metadata confirms `my_application_page` now exists and authenticated access is granted. No real application was withdrawn to test it. |
| Send to conversations cannot load | A revoked direct community-table read caused a whole-sheet failure. Both clients now load community destinations through the authorized API and isolate DM/group/community failures. Group identity uses the canonical group flag; request filtering and membership pagination are checked. | Shared loader tests cover partial failures, correct destinations, deadline, cancellation and retry. No real post/message was sent during tests. |
| Message exit, cancel and next are inconsistent | New message now opens recipient search, then the chosen Chat. Group completion uses deterministic navigation. Chat identity includes account, acting profile and destination. Back, Escape and cancel close the correct level and preserve drafts. | Actual web component and native navigation-helper tests pass. Hardware keyboard, swipe-back and deep-link navigation need final device acceptance. |
| Collaborations show confusing names such as Don × Don | Collaborators are deduplicated by account ID and the author is excluded. Labels use “with”; a same-name collaborator is disambiguated with a handle. Removed collaborations do not remain in the hydrated header. Web invitations appear once per thread, with checked responses. | Identity and interaction tests pass. Two distinct accounts with the same display name are preserved. |
| Liked by author and pinned comments | Author likes derive from the actual post author's positive reaction. Added one author-selected top-level pin per post, pin/unpin controls, stable pinned-first display, and author-like badges. The backend checks authorship and visibility; direct client pin writes are denied. | Database checks cover unauthorized writes, hidden/spam comments, safe replacement, stale unpin and cleanup. UI tests cover badges, ordering, reactions and failed/off comment loading. |
| Trending → For You/Latest/Discover briefly shows an empty feed | Added short-lived per-account tab state. Returning to a populated tab restores rows and scroll position while refreshing; a first visit has a loading state rather than a false “create a post” state. Account changes clear cached state. Disk-snapshot cursor recovery is distinguished from an already paginated tab. | Actual native mode-effect and web controller tests verify no transient empty result, stale response fencing, hidden rows, cursor continuity and restoration. |
| Bottom-right navigation should show my picture | Native and mobile web use the signed-in profile picture, an active outline and initials fallback when a photo is absent or fails. | Typechecks and navigation/component checks pass. Final visual inspection is still needed on representative iPhones. |
| Dark mode should match a polished social app | Added System, Light, Dim and Lights out choices, preserved preference hydration, and corrected theme-driven text, surfaces, inputs, separators, status bars, cards and menus across the touched journeys. Fixed an actual white-on-white comment popup in the media theater and fixed-color memory artwork/buttons affected by the global theme. | Contrast and preference tests exercise the real styles and all three palettes. This uses X's documented Dim/Lights out behavior as a reference; it is not a claim to have copied X's private implementation or completed visual acceptance on every screen. |

Detailed implementation and case lists: [stories](STORY_QUALITY_AUDIT_20261029.md), [profile/memory/dark mode](PROFILE_MEMORY_AUDIT_20261029.md), [jobs/messages/RPC contracts](RPC_CONTRACT_AUDIT_20261029.md).

## Additional bugs repaired in the wider sweep

- **Saved Posts:** authorized signing and renewal, truthful loading/error states, retry, account fencing and independent rollback for concurrent unsaves.
- **Search:** stale-result prevention, category-specific errors, block-setting failure handling, signed media, account-scoped recent searches and direct navigation to the selected job.
- **My Network:** replaced inaccessible community table operations with the existing authorized community APIs, added checked create/join/leave/cancel outcomes, independent directory retries and correct Community destinations.
- **Navigation fallbacks:** Search and Saved Posts now return to actual registered root/tab/child routes when no history exists. Tests execute the real Back handlers in both cases.
- **Edit Profile:** saves wait for uploads, duplicate writes are guarded, affected rows are checked, failed loads cannot become blank editable profiles, and late account responses cannot overwrite a later account/draft.
- **Seller history:** a failed read no longer means zero reviews, zero sales or a new seller. Reads have time limits, stay scoped to the seller and offer retry.
- **Comments:** drafts/GIFs/reply context survive failed sends; same-tick duplicate sends are blocked; moderation failures are visible; old callbacks cannot apply to a replacement thread/account; action rows wrap and have usable touch targets.
- **Story engagement:** corrected the missing sticker summary function; removed obsolete notification wiring; Add yours links only after confirmed publication; speed-only edits persist; denied/failed countdown scheduling cannot claim success; question drafts survive send failure; owner settings require a confirmed affected row.
- **Studio:** four native/web device actions now use the live `p_action: approve/remove` contract.
- **Diagnostics:** the missing redacted reporting RPC is installed. Identity is derived on the server, free-form message/stack content is discarded, direct device table access is revoked, and deduplication/rate limits are enforced.
- **Admin unavailable workflows:** deletion queue, provisioning, review moderation and support assignment now explain unavailable capabilities accurately. They do not imply empty queues, successful changes or endless retries when the endpoint is missing.
- **Settings truthfulness:** Rate the App identifies public-release availability. Account deletion no longer promises stored-file erasure that the current backend does not perform.

## Database changes already applied

Only these narrow repairs were applied in this pass. Their isolated tests first load the same 18 production and seven parity units already deployed, verify source hashes, and then apply the candidates.

| Production migration version (UTC) | Applied name | Source |
| --- | --- | --- |
| `20261029190648` | `platinum_app_quality_applicant_self_service_20261029` | `supabase/migrations/20261025073234_applicant_self_service_quality.sql` plus schema reload |
| `20261029190700` | `platinum_app_quality_comment_author_highlights_20261029` | `supabase/migrations/20261029190200_comment_author_highlights.sql` |
| `20261029192351` | `platinum_app_quality_redacted_client_diagnostics_20261029` | `supabase/migrations/20261023185734_redacted_client_diagnostics.sql` plus schema reload |

Postflight confirms the applicant page, withdrawal, pin and diagnostic functions exist. Pin writes are author-checked; anonymous execution/direct client pin writes are denied. Diagnostics allow authenticated RPC execution, deny anonymous execution and direct anonymous/authenticated table insertion, and retain service-role reading. Community table grants remain restricted; the client repairs use the authorized APIs. No real post, story, answer, message, withdrawal, review, payment, device approval or account deletion was performed as a test.

## Verification and actual coverage

The machine-readable results are in [APP_QUALITY_CHECKS_20261029.json](APP_QUALITY_CHECKS_20261029.json) and [RPC_DATABASE_GATE_20261029.json](RPC_DATABASE_GATE_20261029.json). Registered cases, custom assertions and structural migration checks are kept separate. The final targeted reruns after independent review supersede the earlier broad-run counts.

The final application suites pass **1,561 registered cases**: **961 native/shared, 501 web and 99 admin**, with zero failures or skips. Separate custom suites pass 31 named auth checks, 24 Studio assertions and 13 payment-reporting assertions. These are not added to the registered-case total.

Native, web and admin TypeScript checks pass. Both Next.js production builds compile using nonfunctional placeholder backend credentials; this verifies buildability and does not establish authenticated backend or provider readiness. `git diff --check` passes.

The full root database suite has 278 registered cases: 275 pass, three conditional skips. The RPC runner has 96 registered cases: 95 pass, one conditional skip, plus 117 named custom checks. The skipped root visual-release cases execute in RPC visual mode; its skipped soundtrack-publication case executes in root default mode. These local fixtures do not activate held provider features in production.

The route inventory covers **85 native screen files, 89 registered native route names, 268 literal navigation calls, 84 web page files and 32 admin page files**. All inventoried literal native navigation targets resolve after the fallback repairs. Counts exclude arbitrary array `push` and string `replace` calls. Dynamic routes and route payload validity require separate checks. See [APP_ROUTE_INVENTORY_20261029.json](APP_ROUTE_INVENTORY_20261029.json).

| Feature group | Evidence collected | Acceptance still needed |
| --- | --- | --- |
| Sign-in, sign-up, recovery, profile/account changes | Existing regression suites, auth custom checks, public route delivery | Real email/recovery delivery, sessions across devices, authorized role journeys |
| Feed, Discover, search, post interactions | Controller/callback tests, media and count reconciliation, tab restoration | Real-device scroll/keyboard performance and large histories |
| Story creation, saved story playback, engagement | Editor tests, actual photo pixel tests, publish/permission tests, RPC inspection | Camera/Photos/notifications, real gestures and final composed export |
| Profile, albums, saved media | Production object inventory, lifecycle/renewal tests, playback clocks | The originally failing iPhone photos/videos and continuous audible soundtrack |
| Messages and calls | Message outbox/navigation tests, call authorization/lifecycle/provider-worker tests | Two-device delivery, push/CallKit, interruptions, network transitions and audio routes |
| Market, reviews and orders | Existing transaction/review tests, signed media, seller error-state checks | Real buyer/seller roles and supported provider order/payment lifecycle |
| Jobs and recruiting | Applicant/withdrawal tests and live contract repair | Real applicant/employer workflows, CV access and intended notification delivery |
| Network, communities and channels | Contract inventory, directory tests and local authorization tests | Member/moderator/admin roles, invitations, leave/rejoin and push |
| Studio, business and moderation | RPC names/arguments, device fix, admin capability checks | Actual business/staff roles and missing admin deployment completion |
| Settings, privacy and accessibility | Theme/contrast/navigation checks, accurate unavailable states | VoiceOver, Dynamic Type, reduced motion across all journeys, complete erasure/private storage |
| Music, creator finance and commerce | Explicit disabled gates and regression tests | Provider rights/access, reconciliation and launch approval before enabling |

No complete authenticated production click-through or physical iPhone walkthrough occurred in this session. The available browser had no signed-in app session. Static route registration, unit tests and a successful build are not substitutes for those checks.

## Current web/admin delivery and review environment

Read-only checks confirm the existing production web deployment `dpl_9o59dELcmpdszidW1Xmz2kh6tALe` is READY at `9906c18`, and the active admin deployment `dpl_DisWDZrSVpgKZWpdu8h3w97WzFyS` is READY at `8a1f37d`. The later admin-only no-change deployment was canceled by its build guard; the READY admin deployment retains the production alias.

The web home, login, terms and privacy URLs returned HTTP 200. Admin signin/dashboard requests returned the public Operations entry page without an authenticated session. These are delivery checks of the existing production versions, not proof that this branch is deployed or that signed-in workflows pass.

The existing QA project `uaulhuelcfkjwojtymmw` currently returns “Project not found” through the connected Supabase service. Vercel preview variables are scoped to the old QA branch, and the admin QA service credential is stored as a non-readable secret. This pass does not substitute production server credentials into an unverified preview. Restoring/verifying the QA backend and branch configuration is an outstanding acceptance-environment task.

## Work still required before a complete release

### 1. Finish video and memory audio/export

The photo editor is materially repaired. Full native video color grading and encoding of video plus stickers/text/drawings/audio into one output movie are still missing. Saved embedded post videos are not yet an automatically composed memory-film sequence. These need an implemented media pipeline and real-device output comparisons. The app now describes the current limits instead of implying an edited export exists.

Licensed background music also remains unavailable. `MUSIC_CATALOG_ENABLED = false` stays in place. Continuous soundtrack coordination cannot supply licensed songs on its own. The outstanding work is the catalogue/rights/provider contract and audible native/web acceptance, including interruption, trim and background behavior. Apple Music subscription playback is not substituted for the requested social-app music catalogue.

### 2. Complete private media delivery and account erasure

The inspected `post-media`, `story-media` and `media` buckets are still public. Row authorization and newly signed client URLs do not prove that a known public object URL is inaccessible. A coordinated private-bucket cutover, client compatibility check, cache handling and unauthorized URL tests are required. Switching buckets during a hold while older installed clients still depend on them risks breaking those clients; this pass does not make that untested cutover.

The live `delete_user_account` function deletes database/account rows but does not erase Storage objects. Accurate UI copy is fixed; complete deletion is not. A retryable storage-erasure workflow, retention decisions, failure recovery and verification must be implemented and tested before claiming all stored files are removed.

### 3. Deploy the missing admin operations contracts through a reviewed path

Seven active admin contracts remain absent: seller-review report reading/moderation, central admin commands, provisioning, deletion-request queue, and support triage read/update. Finance-admin contracts are additionally absent behind their intentionally disabled gate. The broad admin/provisioning migration was rejected by automatic approval review earlier in this release; this pass does not retry or bypass it. Its operations, role changes and access boundaries need a narrower reviewed rollout. The source now handles absence accurately.

### 4. Verify provider and real-device behavior

Actual iPhone acceptance must cover the originally reported media, story Text/cancel/share, every photo adjustment after crop and reopening, Photos export, multi-touch stickers, automatic memory playback, send destinations, message Back/Cancel/Next, feed-tab changes, profile photo navigation, and all three color palettes.

CameraKit/lens entitlement, actual camera capture, APNs/notifications, CallKit/call interruptions, Photos permissions and external finance/music providers require their real environments. Configuration presence and simulated adapters do not prove provider completion. Two-device tests need intentional test conversations, not unsolicited messages to other people.

### 5. Close the remaining database hardening and product-quality checks

The current security advisor reports 61 functions with mutable search paths, 216 anonymous-executable security-definer entries, 377 authenticated-executable entries, one extension in the public schema and disabled leaked-password protection. These are audit candidates, not 655 proven vulnerabilities: many checked RPCs are deliberately executable, and trigger functions are not ordinary public commands. Fifty RLS-without-policy findings include intentionally private tables and the newly closed diagnostics table. Review exposed functions by their actual identity checks and privileges instead of granting access or changing them all indiscriminately.

Complete device measurements for cold launch, feed scroll, memory playback, large photos/videos, slow/offline recovery and accessibility. The current pass fixes concrete defects and strengthens regression coverage; it cannot certify every visual state, dynamic route or real-world race solely from this environment.

## Suggested acceptance order

1. Restore the isolated QA environment and load this exact reviewed source with the three required database repairs.
2. Run the reported scenarios in a permitted local/development iPhone environment and on web. Record the exact source/build identifier for every result.
3. Complete the media pipeline/music, private storage, erasure and admin gaps above; keep unfinished provider features visibly unavailable.
4. Exercise applicant/employer, buyer/seller, community member/moderator and staff roles using intentional test records. Check failed writes and offline recovery as well as success paths.
5. Have Don review the actual flows and visual result. Keep TestFlight on hold until the remaining criteria are closed and Don explicitly decides the app is ready.

## References

- X, [Accessibility resources](https://help.x.com/en/resources/accessibility) and [accessibility features](https://help.x.com/en/using-x/accessibility-features): documented display contrast, Dim/Lights out, motion and autoplay controls used as a design reference.
- Supabase, [mutable search-path advisor](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous security-definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated security-definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Repository evidence and detailed lane audits linked above contain the actual local test commands, contract names, checks and remaining acceptance scenarios.
