# Web loading and Studio return repair

Date: 2026-11-05 UTC

## Release

- Scope: the Platinum Circles web app. Native app sources and builds were not changed.
- Production source: `2289b232da4c32f25d4253978d76dcd0177f92ea`.
- Main repair: `bd431ce9eec3bcb53771eb25c23c85df73919b41`.
- Final production deployment: `dpl_CjGxTEnfeG4gUdou83iGTxjGzUzU`, READY at 21:28:11.714 UTC.
- Canonical application: https://platinumcircles.app/home
- Both platinumcircles.app and www.platinumcircles.app were attached to the final deployment.
- This evidence commit does not change the deployed application source.

## Observed problem

The reported feed failure was reproduced in production telemetry. Before this repair, three of ten recorded initial-feed outcomes exhausted the five-second feed deadline. Three more ended in media errors. The other four took 4.153 to 6.938 seconds. A separate get_feed request returned HTTP 500 with database error 57014.

The authenticated Home server component serialized feed, policy and media work before showing the page. Optional navigation profile reads also delayed the application shell. Studio waited for cosmetic profile and desk preferences after membership verification. A feed-history readiness request passed an empty ID list into an expensive visibility query instead of returning immediately.

These findings establish the observed blocking paths. They do not establish a persistent database capacity, CPU or connection-pool cause.

## Changes

1. Home still verifies the viewer on the server. It then opens the feed controller immediately instead of awaiting optional server feed and media work.
2. The controller starts current feed data, policy reads, disk restoration and optional history work concurrently. Same-account memory can render immediately when its policy is known.
3. Refresh keeps usable cards and media visible until their authorized replacements are ready. Media signing failures do not blank a populated feed. A cold signing failure can show authorized text and reserved media space without exposing protected source URLs.
4. Feed requests, policy reads and media signing have abort signals and bounded deadlines. Account, mode and session changes cancel outdated work.
5. Stable groups of five feed rows preserve image and parent nodes when history activates. An explicit history revision triggers measurement when a warm ledger binds to its replacement controller.
6. Optional profile data streams into small navigation boundaries. Authenticated page content and media stay outside those boundaries. Pending chrome preserves usable navigation and consistent geometry.
7. Studio opens after verified membership. Cosmetic profile and desk preferences load independently. Membership and account-generation guards remain in place.
8. Studio exposes its return link during client loading, verification errors and the earlier global route loading state. The global fallback carries no remembered identity or protected content.
9. The empty feed-history ID request returns immediately after the existing authentication and size checks. All nonempty query logic remains unchanged.

## Access and policy preservation

- Server viewer verification and login redirects remain intact.
- Unknown or failed mute preferences fail closed. Cache restoration does not bypass policy.
- Confirmed content access denials remove content before media renewal.
- A saved mute-word change invalidates current-account feed memory before the write, including ambiguous response failures.
- Browser return-state restoration is scoped by account and session revision.
- Studio membership, creator and permission checks remain in place.
- No database grants, row-level security policies or function ownership were changed.

## Database migration

File: `supabase/migrations/20261105210937_feed_restore_empty_ids_fast_path.sql`

- Applied to hosted QA and production.
- Migration SHA-256: `037e57275804e47b8845d8b1dd70bd014a54602e5717fbe39321b0295ff6fe56`.
- Function: `public.get_feed_rows_by_ids_v1(uuid[])`.
- Original function body MD5: `45186117b2564f3321ba6cd2a718e9b0`.
- Updated function body MD5: `b34929e4e14bd2aa2cb8481381983ff1`.
- The migration refuses an unexpected baseline body and verifies unchanged function metadata.
- Independent QA and production readbacks confirmed the body hashes and preserved invoker mode, stable volatility, non-strict behavior, search_path, ownership and ACL.
- A hosted QA authenticated empty-array read returned zero rows under a five-second statement deadline. Its transaction was rolled back.

## Automated verification

| Check | Result |
| --- | --- |
| Top-level web unit suite, `node --test --test-concurrency=4 web/tests/*.cjs` | 1,055 passed, zero failed or skipped |
| Final feed, scroll and real React continuity suites | 60 passed |
| Final navigation loading suite | 15 passed |
| Home server startup cases | 3 passed |
| Word-preference cache cases | 3 passed |
| Empty-ID database regression cases | 7 passed |
| Full web TypeScript | Passed |
| Local production web build | Passed, exit 0 |
| Exact final-source Vercel production build | READY |
| Changed-file whitespace check | Passed |

The 1,055-test full suite preceded two final feed regressions and the final Studio global-fallback case. The affected suites passed again after those changes. These counts overlap and must not be added together as a unique test total.

The real React continuity cases inspect actual image and parent-node identity through history activation and controller replacement. They also cover tab/account/access-denial removal and first warm-ledger measurement without relying on a later ResizeObserver notification. An SSR streaming case confirms that page media is emitted before optional navigation profile work completes.

The route census contains 105 page source files. Build coverage of these routes is not a claim that every route was exercised in the browser. Focused lint found an existing HomeFeed effect rule in the prior source. This release is not described as a clean repository-wide lint run.

## Production cloud-browser verification

Verification used the user-requested cloud browser and the canonical application domain. Only normal navigation, opening and cancelling an empty composer, and video playback were exercised. No posts, reactions, messages, purchases, account settings or destructive flows were submitted.

| Surface or flow | Observed result |
| --- | --- |
| Home initial load | Feed cards appeared with no feed-load error |
| Home full browser refresh | First image decoded successfully, reserved frame height remained 723 px |
| Feed modes | Latest rendered cards, Trending rendered its valid empty state, For You restored cards |
| Composer | Opened with empty caption, review disabled and expected content controls, then cancelled |
| Studio entry | Verified Creator Studio became usable |
| Studio early route fallback, final source | Back to Platinum Circles was visible before optional chrome and Studio content |
| Studio return, final source | Home restored four feed history groups and the first decoded image, no feed-load error |
| Discover | Content cards loaded |
| Watch | Results loaded and video opened |
| Video playback | 1080 by 1920 decoded video, readyState 4, no media error, playback advanced |
| Channels | Channel list loaded |
| Communities | Community and member content loaded |
| Jobs | Jobs page and a role loaded |
| Market | Marketplace page and a listing loaded |
| Messages | Conversation navigation and new-message controls loaded, private threads were not opened |
| Notifications | Activity sections and filters loaded |
| Livestreams | Valid no-live-streams state and navigation loaded |
| Profile | Profile and content sections loaded |
| Settings | Privacy, security, activity, professional, appearance and help sections loaded |

The final warm Studio return showed a first image with natural dimensions 1206 by 2622 and the same 723 px rendered frame height. Four history groups were present and the feed-error text was absent. The browser was left on the working Home page.

The small proof image contains only the live Home heading and navigation tabs. It excludes account identity, user posts and private content. Full browser captures were kept out of the public repository.

## Post-release telemetry

Supabase observation covered 21:24:23.485 to 21:40:13 UTC in two non-overlapping windows. The final Vercel deployment was checked from its 21:28:11.714 UTC readiness through 21:40:13 UTC.

- Vercel reported no runtime error clusters or error/warning/fatal logs for the final deployment.
- Queried Postgres logs contained zero ERROR/FATAL/PANIC events.
- All 11 browser get_feed requests returned HTTP 200. Recorded upstream durations were 424 to 5,383 ms. The three requests in the later window took 854 to 1,677 ms, with a median of 1,217 ms.
- All four browser history requests with 12-byte bodies, matching the client empty-ID probe, returned HTTP 200. Their upstream durations were 155, 686, 786 and 1,112 ms.
- All 22 content-media-sign POST requests returned HTTP 200. Execution durations were 816 to 6,762 ms.
- Five browser media-content GET requests returned HTTP 503. This is an unresolved limitation, detailed below.
- Two other requests from non-browser-class clients returned HTTP 400 for a storage HEAD and HTTP 401 for another GET. Their callers remain unclassified.

These are backend log durations, not browser navigation timings. The sample is small and does not prove a service-level objective or global performance guarantee.

### Remaining authorization transport failures

| Completion time, UTC | Bucket | Execution duration | Failure phase |
| --- | --- | --- | --- |
| 21:31:52.885 | media | 8,131 ms | Initial authorization |
| 21:31:52.886 | post-media | 8,129 ms | Initial authorization |
| 21:31:52.887 | post-media | 8,130 ms | Initial authorization |
| 21:31:54.817 | post-media | 10,060 ms | Revalidation |
| 21:31:54.820 | post-media | 10,062 ms | Revalidation |

All five advertised image-preferring Accept headers. The logs omit referrer and Sec-Fetch-Dest/Mode. The mounted route and visible-image versus preload role are therefore unknown. Estimated starts cluster near 21:31:44.754 to 21:31:44.758 UTC. Asset identities and capability tokens were not retrieved for correlation.

Three initial authorization waits failed at 8,003 to 8,004 ms, before Storage. The other two completed initial authorization in 1,447 and 1,462 ms, received Storage HTTP 200 headers in 486 and 472 ms, then failed revalidation at 8,002 ms. All five emitted zero media bytes.

This matches the existing eight-second service RPC transport deadline. It is not evidence of access denial or an SQL timeout. The same interval contains 19 Deno resolver RPCs returning HTTP 200 with upstream header durations of 19 to 4,141 ms and origin durations of 45 to 4,305 ms. The installed client waits for response-body completion after headers. A subsequent body or connection delivery stall is a plausible explanation, not a confirmed root cause.

Read-only database review confirmed the expected resolver definition and indexed initial lookups. Cumulative resolver statistics recorded 696 completed calls, mean 383.752 ms and maximum 5,935.112 ms, with no recorded JIT, disk reads or temporary spills. These aggregate counters do not isolate the five failures or justify a new index, a higher timeout or an authorization change.

Source review also found two optional cache pipelines that can fetch the same image while the visible image loads. Their causal role in this incident is unproven. The failed requests' image-preferring Accept headers differ from the normal plain-fetch default used by those pipelines. No speculative cache, retry or authorization change was included in this release.

After the investigation, a read-only browser check found seven images intersecting the Home viewport. All seven were decoded, with zero failed or pending visible images and no feed-error message. This does not erase the five observed backend failures. Fixed-window monitoring has ended.

## Limits and follow-through

The observed web feed failure and blocking navigation paths were repaired and released. Shared shell changes apply across authenticated web routes. The primary routes listed above were exercised in production.

A cold feed or newly signed media can still depend on network and backend latency. The five authorization transport failures remain unresolved. The repair keeps usable content responsive during refresh and does not claim that uncached content arrives instantly or that media delivery is error-free. Browser automation round-trip times were not treated as page performance measurements.

The next focused diagnostic for the remaining issue is separate safe timing of resolver response headers and body completion, correlated by existing execution ID. No tokens, paths, identities or media bytes are needed. The optional variant lookup also needs a distinct timing stage before attributing future inherited authorization/revalidation stages to a specific RPC.

This release did not raise infrastructure tiers, quotas or load budgets, and did not modify phone builds or the separate private-HLS/capacity rollout gates. Existing unrelated database advisor findings were not presented as resolved.
