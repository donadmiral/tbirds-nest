# Web and operations loading coverage, 2026-11-05

Base source: e221ffc18f70c36d1b279835a40fa57fc9446358, with this coordinated always-ready patch. This inventory reconciles all 105 member-web and 35 operations page routes against the filesystem. It carries forward the earlier route audit and identifies the changed shared mechanisms. It is source coverage, not 140 browser timing tests.

## Changes and boundaries

- Seven selected consumers of useAccountResource now share explicit session-memory keys: call history, message requests, weekly activity, blocked, muted, restricted and follow-request lists. The store holds at most 24 resources, 512,000 measured bytes total, at most half that per resource, and a 2-minute read TTL. Concurrent reads deduplicate. Mutation versions reject older responses. Account/login replacement and explicit denial discard incompatible values. SSR creates no cross-request singleton.
- Home public snapshots gain up to three JPEG previews, 24,576 characters total, at most 160 pixels on their longest side. AES-GCM encrypts the payload in IndexedDB with a non-extractable CryptoKey. A hash of the authenticated account/session identity gates restoration. No capability token or full-resolution source URL is stored. The selected retention is 24 hours. Confirmed loss of public eligibility, sensitive/view-once content, logout, account/session replacement and expiry purge or hide pixels. Capture attempts are capped at three, each network fetch has a two-second deadline, and storage operations have a two-second deadline. Save Data disables captures. Already-captured immutable objects reuse their pixels after fresh public eligibility checks.
- These are low-resolution previews, not offline full-resolution media or offline video. Private inbox and story bytes are not added to this durable cache. A video needs an existing authorized image cover to produce a preview. CORS, decoding, crypto and storage failures quietly retain the ordinary live-media path.
- Existing server-rendered feed rows remain the initial HTML. After browser identity and IndexedDB restoration, a matching preview fills the pending image background or video poster. An offline public feed snapshot can render a preview-only image using original geometry. It cannot open a fabricated full-resolution viewer. Auth, HTML delivery and the first-ever media download still have latency.
- Expired prepared feed cursors perform exactly one fresh-head read using null cursors. Existing posts retain order and scroll position. The reader rechecks retained visibility, deduplicates the new rows and adopts the new cursor. An ordinary invalid cursor or a failed restart remains a retryable inline failure. Account/route replacements fence old completions.
- Operations remains server-authoritative. Staff identity, permissions, finance and moderation decisions do not enter the member cache or browser persistence. Existing Live workspace tab retention and mutation pending states remain. No operations UI rewrite or dependency change was necessary.

## Verification

154 focused Node cases passed. Web TypeScript and targeted ESLint passed. A further four cache-integration cases passed after the final initialization/revision fence. The browser gate `web/tests/browser/feed-preview-persistence.cjs` is wired into `browser-quality.yml` for `codex/loading-foundation-20261105`. It runs actual cross-origin raster capture, IndexedDB non-extractable CryptoKey storage, a complete browser-process restart, CORS rejection fallback and logout purge. The local pinned Chromium executable is absent, so that new browser gate still requires CI completion before its behavior is claimed as verified.

## Reading the route tables

Preserves describes continuity during an ordinary same-scope refresh, or a server/static page with no client clearing phase. It does not assert an offline cache. Cold-only loader means a route may still need its first read on remount. Identity reset intentionally removes incompatible data. The complete route descriptions below are retained from the prior audited source except the newly opted-in resource routes.

## Member web routes

| Route | Verdict | Source behavior |
| --- | --- | --- |
| `/` | Intentional identity reset | Server auth redirect selects /home or /login. Source: `web/app/page.tsx`. |
| `/[username]` | Preserves | Server-rendered profile. ProfilePosts uses own-profile navigation memory and paged refresh. Other profiles have cold route loading. Source: `web/app/[username]/page.tsx`. |
| `/[username]/follows` | Intentional identity reset | Username and follows-tab keys reset the directory. Pagination retains existing people. No per-tab warm cache. Source: `web/app/[username]/follows/page.tsx`. |
| `/about` | Preserves | Static informational page. No remote content loader. Source: `web/app/about/page.tsx`. |
| `/account-deletion` | Preserves | AccountErasure retains the saved request while status revalidates and reports failure inline. Source: `web/app/account-deletion/page.tsx`. |
| `/ads` | Preserves | Promotion rows render while refreshing. Only promos===null uses a loader. Account change clears rows and charts. Source: `web/app/ads/page.tsx`. |
| `/ads/new` | Cold-only loader | Creation form retains entered fields during async validation and submission. Initial eligible content read has local state. Source: `web/app/ads/new/page.tsx`. |
| `/album/[id]` | Preserves | MemoryAlbum retains a valid displayed album during refresh, scopes by session and album, and clears invalid access. Source: `web/app/album/[id]/page.tsx`. |
| `/archive` | Preserves | Fixed shared useAccountResource keeps same-scope stories/drafts on reload. Initial load and identity changes still hide old content. Source: `web/app/archive/page.tsx`. |
| `/business-login` | Intentional identity reset | Business session handoff intentionally changes the active account. Form busy state is local. Source: `web/app/business-login/page.tsx`. |
| `/businesses` | Preserves | Same-account reload keeps business rows visible with an inline loading notice. applyAccount clears on identity change. Source: `web/app/businesses/page.tsx`. |
| `/businesses/apply` | Preserves | Application rows remain while loading and the form retains input. Owner changes reset account-owned work. Source: `web/app/businesses/apply/page.tsx`. |
| `/businesses/new` | Cold-only loader | Creation form and local submission state. No background collection refresh. Source: `web/app/businesses/new/page.tsx`. |
| `/calls` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/calls/page.tsx`. |
| `/channels` | Preserves | Fixed W07: joining or updating uses forced same-query refresh that retains directory cards. New account/search query still resets the reader. Source: `web/app/channels/page.tsx`. |
| `/channels/[id]` | Preserves | Message refresh merges rows. Channel access/account changes clear messages and media. Pagination appends without replacing the main list. Source: `web/app/channels/[id]/page.tsx`. |
| `/communities` | Preserves | Fixed W07: directory reload keeps existing cards while the complete current-query replacement loads. Identity/query changes and denial clear them. Source: `web/app/communities/page.tsx`. |
| `/communities/[id]` | Preserves | Fixed W07: metadata and post reload retain current community content. Paged refresh reconciles local edits; membership/authorization loss removes private rows. Source: `web/app/communities/[id]/page.tsx`. |
| `/communities/join/[token]` | Intentional identity reset | Invitation is keyed by token and verifies membership before showing join actions. Source: `web/app/communities/join/[token]/page.tsx`. |
| `/discover` | Cold-only loader | DiscoverFeed uses paged collections and empty-only initial skeleton. New category creates a new reader, with no category memory. Source: `web/app/discover/page.tsx`. |
| `/explore` | Cold-only loader | One initial parallel lookup. loaded gates initial loader. Retry follows a failed initial read; no routine warm-refresh loop. Source: `web/app/explore/page.tsx`. |
| `/forgot-password` | Preserves | Static recovery form remains rendered during its request. Source: `web/app/forgot-password/page.tsx`. |
| `/home` | Preserves | Server seed plus account-scoped HomeFeed navigation memory. Warm refresh retains rows and reserves media layout. Identity change discards private memory. Source: `web/app/home/page.tsx`. |
| `/jobs` | Preserves | Jobs navigation cache restores rows. Refresh uses loading&&!loaded and retains current jobs during same-query revalidation. Source: `web/app/jobs/page.tsx`. |
| `/jobs/[id]` | Cold-only loader | Server-rendered detail with route loading boundary. No client clear-on-refresh branch in the page. Source: `web/app/jobs/[id]/page.tsx`. |
| `/jobs/[id]/applicants` | Preserves | Fixed W02: same-account/job/filter revalidation retains cards, counts and cursor, with nonblocking retry errors. Route/filter changes hide old cards before effects, and empty or denied responses clear them. Source: `web/app/jobs/[id]/applicants/page.tsx`. |
| `/jobs/applications` | Preserves | Existing applications remain while loading. Cold loader requires an empty list; account changes reset private data. Source: `web/app/jobs/applications/page.tsx`. |
| `/jobs/messages` | Preserves | Shared MessagesApp has account-scoped inbox/thread memory and context-specific reads. Source: `web/app/jobs/messages/page.tsx`. |
| `/jobs/new` | Cold-only loader | Creation form uses local state and guarded submission. Initial account eligibility has no shared warm cache. Source: `web/app/jobs/new/page.tsx`. |
| `/jobs/saved` | Preserves | Fixed W02: a retained route keeps its current shortlist while revalidating and shows retry errors beside it. Account changes, denied access and confirmed empty results clear rows. This is component-state continuity, with no persisted saved-list navigation cache. Source: `web/app/jobs/saved/page.tsx`. |
| `/live` | Preserves | LiveDirectoryView keeps same-key items during refresh. Account, audience and topic changes invalidate the key. Source: `web/app/live/page.tsx`. |
| `/live/[id]` | Preserves | LiveSessionView retains detail/player during normal refresh. Explicit access failures clear detail and close playback. Source: `web/app/live/[id]/page.tsx`. |
| `/live/[id]/clips` | Preserves | LiveClipEditor shows initial loader only while no detail. Session/account changes reset editor authorization and context. Source: `web/app/live/[id]/clips/page.tsx`. |
| `/live/[id]/settings` | Preserves | LiveClipSettings retains loaded settings on same-session reload. Session/account changes clear authorization state. Source: `web/app/live/[id]/settings/page.tsx`. |
| `/live/clips` | Preserves | LiveClipLibrary keeps rows during manual refresh and pagination. Account and sort changes deliberately reset the collection. Source: `web/app/live/clips/page.tsx`. |
| `/live/clips/[id]` | Intentional identity reset | Clip, format and account changes reset player capability. Media renewal retains a working asset until replacement, then fails closed on access failure. Source: `web/app/live/clips/[id]/page.tsx`. |
| `/live/clips/[id]/captions` | Preserves | Fixed W08: current-scope caption workspace remains on transient refresh failure. Clip removal/denial clears it. Read and session generations fence obsolete responses. Source: `web/app/live/clips/[id]/captions/page.tsx`. |
| `/live/clips/[id]/publish` | Preserves | Publishing-history refresh keeps history. Clip/account/reload identity resets publication options and consent deliberately. Source: `web/app/live/clips/[id]/publish/page.tsx`. |
| `/live/connections` | Preserves | Same-account refresh retains connection rows; identity changes clear them before new provider status arrives. Source: `web/app/live/connections/page.tsx`. |
| `/live/connections/callback` | Intentional identity reset | OAuth callback binds account/selection and clears obsolete consent selections. No retained content feed. Source: `web/app/live/connections/callback/page.tsx`. |
| `/live/new` | Cold-only loader | Broadcast creation form with account capability check. Submission keeps local fields and reports errors inline. Source: `web/app/live/new/page.tsx`. |
| `/live/settings` | Preserves | Platform connection/history reads retain rows on same-account refresh. Identity changes clear history. Source: `web/app/live/settings/page.tsx`. |
| `/login` | Preserves | Sign-in form stays mounted during authentication. Source: `web/app/login/page.tsx`. |
| `/market` | Preserves | Fixed W01: same-query refresh retains listings and image objects with inline retry. Account/query changes hide old results immediately. Denial and confirmed empty clear them. Source: `web/app/market/page.tsx`. |
| `/market/[id]` | Intentional identity reset | Listing keyed by id. Account change resets listing and transactions. Cold detail read has no client navigation memory. Source: `web/app/market/[id]/page.tsx`. |
| `/market/messages` | Preserves | Shared MessagesApp preserves inbox/thread state under the marketplace context. Source: `web/app/market/messages/page.tsx`. |
| `/market/new` | Cold-only loader | Initial Market capability read gates form. Draft fields remain through upload/submission; identity ownership is checked before writes. Source: `web/app/market/new/page.tsx`. |
| `/market/orders` | Preserves | MarketOrders renders existing rows while refreshing. Account switch clears orders and pending review state. Source: `web/app/market/orders/page.tsx`. |
| `/market/saved` | Cold-only loader | Initial saved collection read and explicit account reset. Retry starts an empty load after failure; no warm navigation cache. Source: `web/app/market/saved/page.tsx`. |
| `/messages` | Preserves | MessagesApp uses account/session/context-scoped navigation memory and reading-window state. Authorization changes discard private caches. Source: `web/app/messages/page.tsx`. |
| `/messages/requests` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/messages/requests/page.tsx`. |
| `/monetization` | Preserves | Fixed W03: explicitly tagged transient snapshot read failures retain the last confirmed account snapshot. Denied/malformed responses clear it and enrollment waits for current verification. Source: `web/app/monetization/page.tsx`. |
| `/music` | Preserves | AppleMusicPicker keeps existing tracks during pagination. Search/country changes explicitly reset result identity. Source: `web/app/music/page.tsx`. |
| `/notifications` | Preserves | Same-account notification refresh merges rows and does not set the initial loader. Account change clears notifications and thumbnails. Source: `web/app/notifications/page.tsx`. |
| `/post/[id]` | Cold-only loader | Server page resolves authorized post/media before rendering PostCard. Route loading boundary applies on uncached entry. Source: `web/app/post/[id]/page.tsx`. |
| `/privacy` | Preserves | Static policy content. No remote data reset. Source: `web/app/privacy/page.tsx`. |
| `/reset-password` | Intentional identity reset | Recovery-session verification gates sensitive password form. Local submission does not blank the page. Source: `web/app/reset-password/page.tsx`. |
| `/saved` | Preserves | Fixed W04: same-collection refresh retains saved posts and pictures with inline retry. Collection/account changes, denial and successful empty clear them. Confirmed unsave wins over an older read. Source: `web/app/saved/page.tsx`. |
| `/search` | Intentional identity reset | SearchResults is keyed by submitted query. New queries reset result identity; vertical pagination retains earlier results. Source: `web/app/search/page.tsx`. |
| `/settings` | Preserves | Local preference toggles render directly. AccountStatus now retains same-account data on refresh and separates refresh errors. Source: `web/app/settings/page.tsx`. |
| `/settings/account-type` | Cold-only loader | Account form initializes once and retains selected form state during mutations. Source: `web/app/settings/account-type/page.tsx`. |
| `/settings/activity` | Preserves | Fixed shared resource retains current tab on retry. A different activity loader/filter clears previous-tab values immediately. Source: `web/app/settings/activity/page.tsx`. |
| `/settings/archive` | Preserves | Fixed shared resource retains archived posts and images on same-scope refresh; confirmed unarchive updates rows in place. Source: `web/app/settings/archive/page.tsx`. |
| `/settings/audio` | Cold-only loader | Initial original-audio read. Upload and soundtrack controls keep local state; no shared collection navigation cache. Source: `web/app/settings/audio/page.tsx`. |
| `/settings/blocked` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/settings/blocked/page.tsx`. |
| `/settings/delete-account` | Preserves | AccountErasure retains the saved deletion request and verification status on transient refresh failure. Source: `web/app/settings/delete-account/page.tsx`. |
| `/settings/download` | Preserves | Export request controls remain visible. Processing status is local; no content collection reset. Source: `web/app/settings/download/page.tsx`. |
| `/settings/follow-requests` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/settings/follow-requests/page.tsx`. |
| `/settings/help` | Preserves | Static help navigation. No async list reset. Source: `web/app/settings/help/page.tsx`. |
| `/settings/hidden-words` | Cold-only loader | useWordPreferences scopes saved values and editable words to identity. Form remains while save completes. Source: `web/app/settings/hidden-words/page.tsx`. |
| `/settings/login-activity` | Preserves | Fixed shared resource retains devices while retrying after sign-out-others. Explicit authorization denial clears device history. Source: `web/app/settings/login-activity/page.tsx`. |
| `/settings/muted` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/settings/muted/page.tsx`. |
| `/settings/muted-words` | Cold-only loader | Same useWordPreferences editor as hidden-words. Input is local after initial account read. Source: `web/app/settings/muted-words/page.tsx`. |
| `/settings/notifications` | Preserves | Notification preference editor retains loaded profile and pending edits through save/refresh. Session scope is bound to navigation identity. Source: `web/app/settings/notifications/page.tsx`. |
| `/settings/profile` | Cold-only loader | Initial profile read gates form. Same-account edits/uploads and failed saves retain the draft. Source: `web/app/settings/profile/page.tsx`. |
| `/settings/restricted` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/settings/restricted/page.tsx`. |
| `/settings/standing` | Cold-only loader | Initial strikes/profile status read. Retry follows initial error; no background refresh cycle or shared route memory. Source: `web/app/settings/standing/page.tsx`. |
| `/settings/support` | Preserves | Ticket collection and draft remain through normal reads/submission. Missing identity clears account-owned tickets. Source: `web/app/settings/support/page.tsx`. |
| `/settings/support/[id]` | Preserves | Fixed W05: transient ticket/history refresh failures retain the visible thread. Route changes, missing/denied ticket and denied/malformed history clear incompatible content. Source: `web/app/settings/support/[id]/page.tsx`. |
| `/settings/two-factor` | Preserves | Fixed shared resource retains loaded factors through refresh. Account-keyed security editor still discards secrets on identity change. Source: `web/app/settings/two-factor/page.tsx`. |
| `/settings/username` | Preserves | Availability checks and save state do not replace the editor. New query generations reject old availability results. Source: `web/app/settings/username/page.tsx`. |
| `/settings/verification` | Cold-only loader | Initial application/profile read and local evidence form. Submission status remains in the same form. Source: `web/app/settings/verification/page.tsx`. |
| `/signup` | Preserves | Registration form keeps input during async authentication and error recovery. Source: `web/app/signup/page.tsx`. |
| `/story/[id]` | Intentional identity reset | StoryLink resolves the authorized owner for the requested story and discards state when identity/story changes. Source: `web/app/story/[id]/page.tsx`. |
| `/story/new` | Cold-only loader | StoryComposer initializes its camera/upload workspace. Local draft and processing controls are separate from route loading. Source: `web/app/story/new/page.tsx`. |
| `/studio` | Preserves | Business overview keeps last confirmed summary/scheduled content during refresh. Creator overview is static after StudioShell identity resolves. Source: `web/app/studio/page.tsx`. |
| `/studio/ads` | Preserves | Campaigns use loading&&!loaded. Loaded creative/selection stay present during list refresh; account is scoped by StudioShell. Source: `web/app/studio/ads/page.tsx`. |
| `/studio/audience` | Preserves | Initial loader is loading&&!loaded. Existing audience rows remain during same-view revalidation. Source: `web/app/studio/audience/page.tsx`. |
| `/studio/commerce` | Preserves | Catalog uses loading&&!loaded; orders use MarketOrders retained rows. Filters and account identity remain separate. Source: `web/app/studio/commerce/page.tsx`. |
| `/studio/content` | Preserves | Loaded content library stays visible during refresh and retains preview rows until replacement. Source: `web/app/studio/content/page.tsx`. |
| `/studio/earnings` | Preserves | Same-account snapshot remains on refresh failure. StudioShell/account changes reset account-owned earnings. Source: `web/app/studio/earnings/page.tsx`. |
| `/studio/inbox` | Preserves | Inbox keeps last loaded items on refresh failure and retries failed auxiliary sections independently. Source: `web/app/studio/inbox/page.tsx`. |
| `/studio/insights` | Preserves | Existing analytics report remains during reload; initial report absence gates loading. Preview hydration is independently retried. Source: `web/app/studio/insights/page.tsx`. |
| `/studio/newsroom` | Preserves | Loaded newsroom rows remain while refreshing, with StudioLoadError outside the data branch. Source: `web/app/studio/newsroom/page.tsx`. |
| `/studio/partnerships` | Preserves | Loaded partnership list remains while refreshing. Selecting a different brief deliberately replaces detail identity. Source: `web/app/studio/partnerships/page.tsx`. |
| `/studio/planner` | Preserves | Planner uses loading&&!loaded and keeps scheduled rows and draft while background data revalidates. Source: `web/app/studio/planner/page.tsx`. |
| `/studio/recruiter` | Preserves | Job loader requires an empty list. Existing jobs remain during refresh; selected job/applicant query is separately scoped. Source: `web/app/studio/recruiter/page.tsx`. |
| `/studio/reviews` | Preserves | Loader requires loading&&!d. Confirmed review data remains available during refresh. Source: `web/app/studio/reviews/page.tsx`. |
| `/studio/settings` | Preserves | Loaded business info remains rendered while retrying; initial absence gates the loader. Source: `web/app/studio/settings/page.tsx`. |
| `/studio/settings/organization` | Preserves | Fixed W06: organization desk and members remain during transient refresh failure. Confirmed missing organization or authorization denial clears them. Identity is keyed by StudioShell. Source: `web/app/studio/settings/organization/page.tsx`. |
| `/studio/team` | Preserves | Alias renders organization settings and inherits fixed W06, including inline transient retry and explicit missing/denied clearing. Source: `web/app/studio/team/page.tsx`. |
| `/terms` | Preserves | Static terms content. No remote content loader. Source: `web/app/terms/page.tsx`. |
| `/topic/[tag]` | Cold-only loader | Initial topic post/author lookup uses local state. No shared topic navigation memory or periodic refresh. Source: `web/app/topic/[tag]/page.tsx`. |
| `/watch` | Cold-only loader | DiscoverFeed video mode uses paged rows with an empty-only initial skeleton. New category creates a new query reader. Source: `web/app/watch/page.tsx`. |
| `/write` | Preserves | Article/composer draft and submission state stay mounted through upload, preview and publication actions. Source: `web/app/write/page.tsx`. |

## Operations routes

| Route | Verdict | Source behavior |
| --- | --- | --- |
| `/` | Intentional identity reset | Server sign-in form redirects an authenticated staff identity to /dashboard. Source: `admin-web/app/page.tsx`. |
| `/ads` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/ads/page.tsx`. |
| `/analytics` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/analytics/page.tsx`. |
| `/audit` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/audit/page.tsx`. |
| `/businesses` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/businesses/page.tsx`. |
| `/calls` | Session memory and background refresh | Explicit account resource key. Warm remount draws a bounded 2-minute session-memory value immediately, then revalidates. Denial or session replacement clears it. No durable private data. Source: `web/app/calls/page.tsx`. |
| `/content` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/content/page.tsx`. |
| `/content/[id]` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/content/[id]/page.tsx`. |
| `/dashboard` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/dashboard/page.tsx`. |
| `/jobs` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/jobs/page.tsx`. |
| `/live` | Preserves | Fixed A01: visited Broadcasts and Clips desks remain mounted, retaining rows, selection and local form state. Inactive desks start no new reads, discard obsolete completions and omit video playback. Re-entry refreshes the retained desk. The HTTP read boundary preserves authoritative denial/removal. Source: `admin-web/app/live/page.tsx`. |
| `/market` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/market/page.tsx`. |
| `/market/orders` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/market/orders/page.tsx`. |
| `/market/orders/[id]` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/market/orders/[id]/page.tsx`. |
| `/market/reviews` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/market/reviews/page.tsx`. |
| `/music` | Preserves | Server-authorized music/license snapshot feeds OperationsPanel; command pending state is local. Source: `admin-web/app/music/page.tsx`. |
| `/organizations` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/organizations/page.tsx`. |
| `/p/[id]` | Cold-only loader | Server share route resolves its presentation and media before returning HTML. Source: `admin-web/app/p/[id]/page.tsx`. |
| `/payments` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/payments/page.tsx`. |
| `/payments/creators` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/payments/creators/page.tsx`. |
| `/present` | Preserves | PresentBuilder operates on local presentation state after staff authorization. No primary collection loader. Source: `admin-web/app/present/page.tsx`. |
| `/queue` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/queue/page.tsx`. |
| `/reports` | Preserves | Server-authorized report snapshot feeds ReportsDesk. Local filters/selection keep the loaded reports. Source: `admin-web/app/reports/page.tsx`. |
| `/reset-password` | Intentional identity reset | Recovery verification gates the password/MFA form. Source: `admin-web/app/reset-password/page.tsx`. |
| `/reset-password/request` | Preserves | Recovery request form remains rendered during its server action. Source: `admin-web/app/reset-password/request/page.tsx`. |
| `/security` | Intentional identity reset | Staff assurance/MFA check intentionally gates access to operations. Source: `admin-web/app/security/page.tsx`. |
| `/signin` | Intentional identity reset | Redirect alias to the canonical staff sign-in page. Source: `admin-web/app/signin/page.tsx`. |
| `/staff` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/staff/page.tsx`. |
| `/stories` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/stories/page.tsx`. |
| `/support` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/support/page.tsx`. |
| `/support/[tid]` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/support/[tid]/page.tsx`. |
| `/system` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/system/page.tsx`. |
| `/users` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/users/page.tsx`. |
| `/users/[uid]` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/users/[uid]/page.tsx`. |
| `/users/deletions` | Preserves | Server-rendered authorized desk/detail. No client set-loading/reset branch or app loading.tsx. CommandForm keeps current content while its action completes. Source: `admin-web/app/users/deletions/page.tsx`. |
