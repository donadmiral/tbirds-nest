# Platinum Circles design and connected-workflow delivery

Date: 2026-10-30. Branch: `codex/app-quality-20261029`. Review: [draft PR #3](https://github.com/donadmiral/tbirds-nest/pull/3). This delivery continues the verified `32ee0a5373dd5ebcddae92ca5145f9bf7293c9c9` checkpoint. The commit containing this report is the source of record for these changes.

## Release decision

The supplied navy, white and champagne concepts have been implemented across the public navigation, principal social screens, Jobs, Market, professional Studio and admin operations. Actions use existing or newly implemented authorized contracts, with explicit review, pending, cancellation, failure and return paths. The branch also adds complete supported memory-book movie download and local audio-file mixing.

**This is a review delivery, not final production or physical-device acceptance. TestFlight remains on hold.** No claim of zero defects or equivalence to Meta's or X's internal systems follows from screenshots, compilation or synthetic tests. The reference accounts, events, follower counts, ad spending and financial examples have not been inserted into real application data.

The original missing-QA-configuration blocker was resolved at the preceding checkpoint. Authenticated protected-web access and actual provider/device workflows remain distinct from a successful preview build. No temporary protected-preview review link has been created for this delivery.

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

Business entry now binds the actual Auth session to an active team seat and approved device. Unknown and denied devices cannot be automatically approved by the sign-in path. The verified personal owner can explicitly set up the first owner seat and device. Owned businesses also have an Open Studio action, including businesses transferred to the current owner or created without an application. Web and native clients verify the destination account before installing the session, reject the old unbound token response, and discard work after cancellation or account changes. Authentication transport deadlines cover response bodies as well as headers, preventing a stalled response from leaving the handoff waiting indefinitely. Live provider acceptance is recorded separately from these synthetic client and SQL checks.

The three reviewed Studio/reserved-route migrations were applied to **isolated QA only**, with exact-definition, ACL, RLS and preservation postflights. The associated business Auth repair is documented separately in `STUDIO_SECURITY_20261030.md` and its machine-readable evidence. The broad production database has not received this Studio cutover.

**QA business Auth installation is blocked by the migration connector.** The exact candidate was independently reviewed and authorized for QA, but two apply attempts stalled without returning success, an error, or an approval rejection. The final read at 04:42:50 UTC confirmed that the new schema and owner contract were absent, no matching migration transaction remained, and the latest installed migration was still `20261030033815`. No associated Edge deployment was started. Auth/profile/staff counts remained one each, with 13 Auth sessions and 15 Storage objects. The new business sign-in source is therefore not a completed hosted QA workflow. See `studio-workflows-20261030/business-auth-qa-connector-blocker.json` for the exact recovery evidence.

Details: [STUDIO_DESIGN_20261030.md](STUDIO_DESIGN_20261030.md).

Business-session client evidence: [BUSINESS_SESSION_CLIENTS_20261030.md](BUSINESS_SESSION_CLIENTS_20261030.md).

## Memory movie and audio export

Download memory movie composes every supported page in book order into one portrait 720 × 1280 file. Photos, text, saved video excerpts, speed, framing, color adjustments, drawings and static/timed artwork are included. The selected browser codec determines the truthful file extension. The verified Linux Chromium outputs are VP9/Opus WebM; native Photos and Safari/MP4 acceptance remain separate.

The original instrumental score can run continuously and duck below original video audio. A local audio/voiceover file can be mixed into the movie or composed story video with level, start position and once/loop behavior. Selecting that file does not publish it, upload it or modify a saved story soundtrack. The commercial catalogue remains disabled.

Limits are explicit: 30 memories, five minutes, 120 captured artwork states and 160 MiB of output. Missing originals, overflowing captions, unsupported compositions and resource limits fail the complete export with recovery guidance. Cancel, backgrounding, calls, unmount and account changes do not offer partial output as a finished movie. Tracks, contexts, object URLs and temporary capture resources are released.

Actual encoding checks caught and fixed transparent offscreen artwork and incorrect audio gain. A later independent review found that filename-only animation detection could flatten APNG/WebP. The shared image reader now inspects bounded bytes, including photo stickers, CSS backgrounds and data/blob URLs, and rejects animation before recording. It aborts unfinished reads on cancellation.

Details, decoded frames and small synthetic output videos: [MEMORY_EXPORT_20261030.md](MEMORY_EXPORT_20261030.md).

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

| Source/behavior gate | Result |
| --- | --- |
| Native/root regressions | 127 files passed; 1,194 reported cases passed, no skips |
| Web regressions | 54 programs passed; 607 reported cases passed, plus two successful legacy Studio programs without case totals |
| Admin regressions | 20 programs passed; 155 registered cases passed, plus a legacy program reporting 13 assertions |
| TypeScript | Native/root, web and admin projects passed |
| RPC authorization | 550 registered Node cases: 549 passed and one intentional release-variant skip; 117 custom checks also passed |
| Supabase Node | 296 registered cases: 293 passed and three complementary release-variant skips |
| Auth transport and SDK handoff | 17 focused cases passed, including stalled response bodies, late results, retry and native Studio landing |

Every intentionally skipped release-variant case passed in its complementary invocation. The final client runs used unchanged source manifests throughout execution. The Auth transport additions preserved the existing media transport checks. These local gates use synthetic data and do not establish hosted or physical-device acceptance.

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
5. **Hosted protected-web review.** Use an authorized authenticated Vercel session or an explicitly approved temporary review link. Automatic approval review previously rejected the temporary share-link action; that restriction has not been bypassed.

The QA admin walkthrough and exact-commit deployment status are recorded in the published PR update. Production promotion and TestFlight remain separate decisions after these gates close.
