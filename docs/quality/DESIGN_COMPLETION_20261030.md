# Platinum Circles design and connected-workflow delivery

Date: 2026-10-30. Branch: `codex/app-quality-20261029`. Review: [draft PR #3](https://github.com/donadmiral/tbirds-nest/pull/3). The tested implementation is source commit **`b7a37a7a1e271e1ec037798a39772e151fbcc318`**, continuing the verified `32ee0a5373dd5ebcddae92ca5145f9bf7293c9c9` checkpoint. The later evidence-only update changes reports and receipts, not the tested implementation.

## Release decision

The supplied navy, white and champagne concepts have been implemented across the public navigation, principal social screens, Jobs, Market, professional Studio and admin operations. Actions use existing or newly implemented authorized contracts, with explicit review, pending, cancellation, failure and return paths. The branch also adds complete supported memory-book movie download and local audio-file mixing.

**This is a review delivery, not final production or physical-device acceptance. TestFlight remains on hold.** No claim of zero defects or equivalence to Meta's or X's internal systems follows from screenshots, compilation or synthetic tests. The reference accounts, events, follower counts, ad spending and financial examples have not been inserted into real application data.

The original missing-QA-configuration blocker is resolved. Both exact-source previews are READY, all three hosted workflows passed, and authenticated read-only admin/public-web walkthroughs completed. Vercel protection remains in place; no temporary protected-preview review link was created. Actual provider and physical-device acceptance remain distinct from these verified results.

## Review this delivery

| Surface | Exact-source preview | Verified scope |
| --- | --- | --- |
| Admin operations | [Workspace overview](https://admin-fopoftjyg-intobank.vercel.app/dashboard) | Authenticated dashboard, tools directory, deletion queue, staff role guide, support, businesses, seller reviews, account menu and return paths |
| Public web | [Home](https://platinum-o4c94mgb4-intobank.vercel.app/home) | Authenticated feed/media, composer cancellation, owner profile editor, memory reader/film, messages, communities, channels, Jobs, Market and creator Studio |

Both deployments identify source `b7a37a7a1e271e1ec037798a39772e151fbcc318`. The live walkthrough used existing authorized QA accounts and data. It did not create staff, publish content, send messages, approve moderation, transfer money or erase an account. [Walkthrough and preview receipt](design-completion-20261030/live-qa-walkthrough.json).

## Admin: visual system and operational connections

The operations app now has one 63-icon system with consistent 24-pixel geometry and 1.75-pixel strokes. The navigation, search, account controls, headings, refresh, sharing, data views and workflow controls share that system. Navy navigation, champagne selection accents, restrained borders and consistent spacing carry through light, dark and system appearance.

All tools is a searchable, keyboard-contained directory filtered by the authenticated staff role. It reaches deletion requests, orders/disputes, seller-review reports, creator finance, presentations and the existing optional authenticator setup. Contextual breadcrumbs and deterministic parent links give directly opened records a reliable exit. Menus close on Escape and restore focus. Unavailable pages and 404s offer actual retry or workspace destinations.

The staff editor now begins with the selected staff member's confirmed role. An uninitialized control can no longer misleadingly display Super Admin. Staff creation defaults to Read-only Auditor, labels its fields, and accurately explains that it creates an account rather than sending an invitation email. The role guide is derived from the real permission policy. Actor-filtered audit links preserve restricted reviewers' own-record scope.

Offline admin forms retain their values, reject submission before dispatch and offer an explicit retry after connection returns. Reconnection never silently replays a moderation, provisioning, financial or account command. The previously restored command/provisioning/deletion contracts and their authorization, replay/version and audit protections remain included.

Details: [ADMIN_DESIGN_20261030.md](ADMIN_DESIGN_20261030.md).

## Public web and professional accounts

The public shell uses a full desktop rail, a compact rail at intermediate widths, a sticky search/action header, and responsive content and recommendation columns. Navigation uses exact/prefix-aware route definitions. Global search, Create, More, account controls, profile routes and mobile destinations connect to actual application pages.

Home uses large media and readable action rows, while Discover and Watch show real filtered data and distinguish failed reads from empty results. Personal and creator profiles expose their real identity, cover, links, memory books and posts. Private collections, drafts and editing appear for the verified owner. Business profiles present actual products, reviews, contact information, hours and safe website links.

The new profile editor validates fields, links and actual image bytes before writing. Selected images remain local previews until Save. Retrying uses the same owner-scoped paths, failed saves preserve the form, and stale account responses cannot install another account's result. Browser Back retains one verified owner's draft and selected files in tab memory for explicit Restore/Discard on return. Reload is guarded; file persistence across reload is not promised.

Messages now has a designed inbox, search and filters, new-recipient search/review, named call controls and a conversation detail panel. Profile links and shared items refer to the actual participant and currently loaded authorized messages. Closing or returning to the inbox preserves the appropriate unsent draft. Selecting a person does not send a message automatically. Failed search and conversation opening retain their review context. The mobile conversation uses an opaque theme surface and makes background navigation inert until the chat is closed.

Communities and Channels have responsive search/directories, actual membership and creation flows, designed details, About/rules, and keyboard-contained dialogs for members, requests, invitations and settings. Settings photos are previewed locally and uploaded only after Save. Failed saves retain the selected image and use the same upload path on retry. Cancelling a creation dialog preserves its current draft without publishing it.

Jobs and Market retain their real server contracts while adding independent card links/actions, readable full-width workspaces, reviewable applications and offers, useful filters, image selection and clearer tracking. Application review precedes CV upload/submission. Order changes keep their immutable retry keys and version checks. Cancelling native sharing does not silently copy a link. Payment/provider restrictions remain visible in their relevant flow.

Details: [WEB_DESIGN_20261030.md](WEB_DESIGN_20261030.md), [JOBS_MARKET_DESIGN_20261030.md](JOBS_MARKET_DESIGN_20261030.md), and its receipts in `commerce-design-20261030/`.

## Studio: publishing, approvals and partnerships

The professional shell is a separate full-width workspace with a navy rail, account/workspace context, scoped search, mobile navigation and a clear return to Platinum Circles. Business and creator overviews use actual publishing queues and account capabilities.

Newsroom brings assignments, versions, rights ownership, territory, expiry, embargo, sponsorship labels, review and scheduling together. Team approval is distinct from advertising review. An approver sees the current version; stale versions cannot silently approve newer content. Scheduling obeys the reviewed content and embargo rules.

Planner exposes the real drafts, scheduled work and failed publishing state with defined editing/retry paths. Ads Manager offers real campaign filtering, review steps, previews, safe export and status controls. Funding and recorded campaign spending are presented separately. Campaign delivery features that lack a backend are not represented by active mock switches.

Partnerships record briefs, deliverables, versions, feedback and creator permissions. Publication approval and permission for paid promotion are separate, with expiry and revocation. Mutation identity is persisted before dispatch so an uncertain response can be retried after reload. Changing an approved source post invalidates the effective permission until the creator submits an appropriate new version.

Insights use actual available date ranges and data, with accessible table alternatives. Earnings show known balances and provider readiness. Team exposes active seats, permissions and devices through the reviewed governance rules. Account/member changes remount scoped workspaces, so a previous member's form cannot remain active in the new context.

The implemented business-entry candidate binds the actual Auth session to an active team seat and approved device. Unknown and denied devices cannot be automatically approved by the sign-in path. The verified personal owner can explicitly set up the first owner seat and device. Owned businesses also have an Open Studio action, including businesses transferred to the current owner or created without an application. Web and native clients verify the destination account before installing the session, reject the old unbound token response, and discard work after cancellation or account changes. Authentication transport deadlines cover response bodies as well as headers, preventing a stalled response from leaving the handoff waiting indefinitely. This candidate is not installed in QA; live provider acceptance is recorded separately from these synthetic client and SQL checks.

The three reviewed Studio/reserved-route migrations were applied to **isolated QA only**, with exact-definition, ACL, RLS and preservation postflights. The associated business Auth repair is documented separately in `STUDIO_SECURITY_20261030.md` and its machine-readable evidence. The broad production database has not received this Studio cutover.

**QA business Auth installation is blocked by the migration connector.** The exact candidate was independently reviewed and authorized for QA, but two apply attempts stalled without returning success, an error, or an approval rejection. The final migration read at 04:42:50 UTC confirmed that the new schema and owner contract were absent, no matching migration transaction remained, and the latest installed migration was still `20261030033815`. No associated Edge deployment was started. At that observation, Auth/profile/staff counts remained one each, with 13 Auth sessions and 15 Storage objects; subsequent authorized browser sign-in can change session counts. The new business sign-in source is therefore not a completed hosted QA workflow. See `studio-workflows-20261030/business-auth-qa-connector-blocker.json` for the exact recovery evidence.

Details: [STUDIO_DESIGN_20261030.md](STUDIO_DESIGN_20261030.md).

Business-session client evidence: [BUSINESS_SESSION_CLIENTS_20261030.md](BUSINESS_SESSION_CLIENTS_20261030.md).

## Memory movie and audio export

Download memory movie composes every supported page in book order into one portrait 720 × 1280 file. Photos, text, saved video excerpts, speed, framing, color adjustments, drawings and static/timed artwork are included. The selected browser codec determines the truthful file extension. The verified Linux Chromium outputs are VP9/Opus WebM; native Photos and Safari/MP4 acceptance remain separate.

The original instrumental score can run continuously and duck below original video audio. A local audio/voiceover file can be mixed into the movie or composed story video with level, start position and once/loop behavior. Selecting that file does not publish it, upload it or modify a saved story soundtrack. The commercial catalogue remains disabled.

Limits are explicit: 30 memories, five minutes, 120 captured artwork states and 160 MiB of output. Missing originals, overflowing captions, unsupported compositions and resource limits fail the complete export with recovery guidance. Cancel, backgrounding, calls, unmount and account changes do not offer partial output as a finished movie. Tracks, contexts, object URLs and temporary capture resources are released.

Actual encoding checks caught and fixed transparent offscreen artwork and incorrect audio gain. A later independent review found that filename-only animation detection could flatten APNG/WebP. The shared image reader now inspects bounded bytes, including photo stickers, CSS backgrounds and data/blob URLs, and rejects animation before recording. It aborts unfinished reads on cancellation.

Details, decoded frames and small synthetic output videos: [MEMORY_EXPORT_20261030.md](MEMORY_EXPORT_20261030.md).

## Dependencies and database hardening

The recorded 30 October dependency audits report **zero known registry vulnerabilities for native/root, web and admin**, and all three lockfile hashes still match that receipt. The earlier native count of 24 is superseded. The old `decode-uri-component@0.2.2` is absent. Two locally maintained decoder/deepmerge adaptations remain outside npm advisory coverage and retain their provenance, regression and manual-maintenance requirements; the deepmerge repair is a local backport, not an upstream-approved release. These retained audit results are not a new advisory query or a whole-app security guarantee. See [the dependency audit](DEPENDENCY_SECURITY_AUDIT_20261029.md) and [matching lockfile receipt](DEPENDENCY_SECURITY_AUDIT_20261029.json).

Actual QA postflight verifies pinned application search paths, selective execution-grant removal and `pg_trgm` in `extensions`. Production installation and postflight remain outstanding. Leaked-password protection and the recorded production PostgreSQL patch upgrade still require provider work. Intentionally private tables and identity-checked definer APIs retain advisor findings; those counts are not demonstrated vulnerabilities. See [the database hardening report](DATABASE_HARDENING_20261029.md) and [actual QA postflight](QA_DATABASE_HARDENING_POSTFLIGHT_20261029.json).

## Reference collection: implementation boundaries

| Reference area | Current source delivery | Remaining boundary |
| --- | --- | --- |
| Home, light and dark | Shared shell, actual feed, large media, navigation, composer and appearance | Physical-device and every-palette acceptance |
| Discover/search | Connected search, filtered discovery, failure/retry | Real provider and account-specific result review |
| Personal/creator profile | Real covers, identity, memory books, posts, links and owner editing | Creator subscriptions/live-provider acceptance |
| Major-brand profile | Real business profile, products, reviews, contact and Studio connection | No invented league schedule or external ticketing feed |
| Composer/editor/story viewer | Existing repaired editing, review/cancel, full-image sharing and composed-video pipeline | Physical iPhone keyboard, gestures, Photos and unsupported export layers |
| Memory book | Reader, continuous film, original score and supported whole-book download | Animated/nested/dual-camera export; commercial catalogue |
| Messages/calls/Chat Pay | Designed actual conversation UI, durable message engine and existing provider controls | Two-device delivery, live calls/audio routes and real payment-provider acceptance |
| Watch/Live | Video discovery and existing live destination | Real capture/broadcast/provider walkthrough |
| Communities/channels | Directory, membership, details, settings, reviewable creation and actual moderation routes | Real moderator/host multi-account walkthrough |
| Jobs/applications | Search/saved/detail, review before CV submission, tracking and withdrawal | Real applicant/employer and document-access walkthrough |
| Market/checkout | Real listings, offers, order requests, action review and tracking | Actual payment, fulfilment, dispute and provider behavior |
| Settings/privacy | Searchable actual controls and owner editor | Production privacy cutover and installed-client compatibility |
| Studio/newsroom | Actual queues, assignments, rights, versions, approvals and scheduling | Hosted owner/editor/approver walkthrough; cross-platform publishing |
| Ads/campaign review | Campaign operations, preview, objective/audience/funding/review flow | Full ad-set/audience-delivery engine and external-provider acceptance |
| Analytics | Available real organic/paid/partnership data and accessible charts | Watch-retention and unavailable attribution metrics |
| Partnerships | Briefs, deliverable versions, feedback, approval and separate expiring paid permission | Private deliverable-file exchange and automatic creator payment |
| Earnings/IntoBank | Known balances, transfer state and actual provider readiness | Finalized financial/tax statements and live payout acceptance |
| Team/brand/access | Roles, seats, device governance, organization settings and activity | Real reserve/create/finish, owner bootstrap and device approval acceptance |

## Verification and evidence

The full final inventory is recorded under `design-completion-20261030/`. Test receipts identify their source, runtime, timestamps, file/case counts and intentional skips. Counts from overlapping runs are not added as independent end-to-end coverage.

### Hosted results on the published implementation

| GitHub workflow | Result |
| --- | --- |
| [Type and quality gates](https://github.com/donadmiral/tbirds-nest/actions/runs/41004627752) | Passed: native, web, admin and Edge jobs |
| [Browser interaction and video gates](https://github.com/donadmiral/tbirds-nest/actions/runs/41004627684) | Passed: connected app, Studio, admin and encoded movie stages |
| [iOS native compile](https://github.com/donadmiral/tbirds-nest/actions/runs/41004627751) | Passed: unsigned Simulator target; no physical-device or TestFlight claim |

All three workflows and six constituent jobs completed successfully for `b7a37a7a1e271e1ec037798a39772e151fbcc318`. Their exact run IDs, timestamps and source association are preserved in [the hosted CI receipt](design-completion-20261030/hosted-ci-b7a37a7.json). The documentation follow-up does not change application source or substitute a later commit for that evidence.

### Authenticated QA observations

The admin walkthrough verified actual data loading, the role-filtered All tools directory, deletion-queue and parent navigation, the selected staff member's real role, the separate role-access guide and Escape/focus return, support/business/seller-review pages, and account-menu closure. Privileged commands and actual provisioning were not submitted. A privacy-safe screenshot is retained as [live-admin-tools.jpg](design-completion-20261030/live-admin-tools.jpg).

The web walkthrough verified protected edited-image decoding and trimmed-video playback, viewer closure, composer Cancel, owner profile editing and Back to profile, and an existing memory-book reader and continuous film with the original score. That book contains animated sticker artwork: its movie preflight correctly blocked export and explained how to recover. No movie was claimed for that unsupported book. Supported movie encoding remains separately verified with synthetic fixtures.

Messages loaded its real empty inbox and opened/cancelled New message. Communities opened/cancelled creation; an existing channel loaded its host announcements. Jobs showed the actual empty result state. Market loaded an existing listing and returned through Back to Market. Creator Studio, Partnerships and Earnings loaded, and Back to Platinum Circles returned to Home. Earnings reported an **unconfirmed IntoBank connection** and unavailable creator payouts; provider completion remains unverified.

These are observed read-only journeys, not all-role transaction acceptance. Console samples contained browser-extension metadata errors (100 sampled admin entries and 57 web entries), so this walkthrough is not labeled a zero-console-error test. One final admin navigation wait timed out; a fresh URL and DOM observation showed the dashboard had loaded without another navigation or reload. Full observations and limits are recorded in [live-qa-walkthrough.json](design-completion-20261030/live-qa-walkthrough.json).

### Local regression inventory

| Source/behavior gate | Result |
| --- | --- |
| Native/root regressions | 127 files passed; 1,194 reported cases passed, no skips |
| Web regressions | 54 programs passed; 607 reported cases passed, plus two successful legacy Studio programs without case totals |
| Admin regressions | 20 programs passed; 155 registered cases passed, plus a legacy program reporting 13 assertions |
| TypeScript | Native/root, web and admin projects passed |
| RPC authorization | 550 registered Node cases: 549 passed and one intentional release-variant skip; 117 custom checks also passed |
| Supabase Node, before the final Edge-fetch delta | 296 registered cases: 293 passed and three complementary release-variant skips |
| Final business Edge-fetch delta | 21 targeted cases passed; all eight changed Deno entrypoints checked |
| Auth transport and SDK handoff | 17 focused cases passed, including stalled response bodies, late results, retry and native Studio landing |

Every intentionally skipped release-variant case passed in its complementary invocation. The final client runs used unchanged source manifests throughout execution. The Auth transport additions preserved the existing media transport checks. The final Edge-fetch run repeats 18 earlier business-session cases and adds three deadline/cancellation cases; it is recorded separately from the earlier full Node inventory. These local gates use synthetic data and do not establish hosted or physical-device acceptance.

| Browser/encoding scope | Result | Evidence limit |
| --- | --- | --- |
| Actual admin components | 35 named cases; zero captured browser errors | Synthetic staff records and navigation adapter |
| Actual public web | 38 named cases; zero captured browser errors | Synthetic Auth/database, local media and Next navigation adapters |
| Actual Studio | 25 named cases; zero captured browser errors | Synthetic businesses, creators and workflow responses |
| Actual Jobs/Market | 24 named cases; zero captured browser errors | Synthetic CV, listing, offer and order records |
| Full movie/animation inspection | 19 cases; six decoded movies; zero captured browser errors | Generated image/video/audio inputs; Linux Chromium |
| Shared story export | 8 cases, including audio mixes, timing, failure and cancellation | Encoded files inspected with ffprobe/ffmpeg |
| Image-byte inspection | 12 cases | Real static/animated container fixtures and bounded stream controls |

The browser workflow now runs the admin, public web, Jobs/Market and Studio journeys plus actual story/movie encoding. It retains visibly synthetic screenshots/receipts. It does not collect real browser authentication state. Source checks include all three TypeScript projects, existing behavioral regressions, and authorization/SQL/Edge tests with their fixture conditions stated separately.

Strict lint is not represented as globally clean: the older large message/community/channel modules retain React Compiler/ref and typing diagnostics, though this pass adds no new error-category diagnostics in those seven reviewed modules and reduces the older count from 57 to 44. New dialog modules have zero errors. The specific frontend reviews and image-generation/ref warnings are documented in their scoped reports.

## Gates still required for final acceptance

1. **Production privacy and erasure.** Confirm compatible installed clients, unrelated-user/expired/revoked access, warmed caches and a disposable-account Storage/CDN/Auth erasure before converting production buckets. Earlier QA known-URL denials are useful evidence, not the whole production proof.
2. **Actual provider workflows.** Complete real reserve/create/finish, owner/device entry and the remaining role journeys. The provider leaked-password setting still requires provider configuration access. Local provider stubs and SQL fixtures do not establish actual Auth or payment behavior.
3. **Physical iPhone.** Replay the exact previously failing files; verify Photos, camera/lenses/HEIC/HDR/large files, story text/crop/keyboard, sticker gestures, calls/audio/interruptions, two-device delivery/push, feed/offline/cold launch, VoiceOver, Dynamic Type and every appearance palette on the installed candidate.
4. **Product capabilities still unsupported.** Licensed catalogue music, animated/nested-video/dual-camera composition, direct microphone voiceover capture, cross-platform professional publishing, the full ad-set delivery engine, private deliverable exchange, automatic creator payment and finalized statements need their own implemented contracts and provider/legal setup where relevant.
5. **Production database/provider maintenance.** Apply and postflight the reviewed production hardening and the provider database patch upgrade. Resolve leaked-password protection. Retain manual maintenance of the two local dependency adaptations and permission-based review of the remaining advisor findings.

Authenticated access to the exact-source admin and public previews is now verified through normal sign-in. The earlier rejected temporary-share-link action was not retried or bypassed. Multi-account business, staff, moderation and provider transaction journeys remain part of gate 2. Production promotion and TestFlight remain separate decisions after these gates close.
