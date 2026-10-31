# Profile, memories, directories and dark-mode quality audit

Date: 29 October 2026. Source branch: `codex/app-quality-20261029`.

This is a source and automated-verification record for the current quality pass. It is not a claim that these changes are in the installed iPhone build. No TestFlight build, submission or distribution was started by this work.

## Findings and implemented changes

| Area | Confirmed cause | Change | Evidence and remaining boundary |
| --- | --- | --- | --- |
| Own and other profiles: “some media is unavailable” | The profile deliberately stripped private URLs while obtaining signed media access, then treated those stripped URLs as failed media. Long-lived profile lists also retained expiring access URLs without renewing them. | Pending media has a loading state distinct from denied/failed media. A failure offers Retry. Text remains readable. Visible profile lists renew expiring capabilities every minute and on foreground return, without dropping paged rows or decorations. Late responses cannot overwrite a newer account or profile read. | Profile content, renewal and account-switch tests pass. Production object inventory found the referenced stored files. The reported device transport/decoder failure still needs a fresh iPhone reproduction; the evidence does not show that photos were deleted. |
| Profile sharing | Native profile post sharing passed only text to the operating-system share sheet. | Shared profile posts include their canonical post URL for both own and other profiles. | Source path reviewed with the profile regressions. Real share extensions still require iOS acceptance. |
| Memory books: automatic playback | Existing books were manually paged. Video pages looped, and there was no automatic photo timer. | Optional **Play book** mode advances pages, gently moves photos, exposes pause/resume and progress, stops at the last page and supports replay. Photos start their timer only after a ready image. Videos advance once at the selected excerpt end or decoder end. Backgrounding, an active call on native, page turns and editing suspend the relevant playback. Reduced Motion disables the added motion. Manual book opening, covers, sizes and page turning remain available. | Shared playback-clock and actual native/web player tests pass. This is in-app playback, not an exported movie file. Mixed real-device audio/video acceptance remains open. |
| Memory soundtrack | The album player already has a rights-aware soundtrack selection, but restarting it at every page would break continuous background music. | Album-level soundtrack activity spans page turns. Play/Pause and foreground state control the album session, rather than creating one new soundtrack per page. | Playback coordination is implemented. `shared/musicAvailability.ts` still sets `MUSIC_CATALOG_ENABLED = false`. No licensed catalogue has been enabled and no audible commercial-song acceptance is claimed. |
| Saved story appearance in memories | The full media recipe and saved drawing/sticker layers needed to survive through the book renderer. | Native memory photos use the same pixel renderer/context as story photos, retaining the saved appearance. Existing crop, trim, speed, sound volume, drawings and supported sticker presentation stay attached to the page. | Story presentation and stability cases pass. A complete graded/composed video export is still outside this implementation. |
| Edit profile | Save could race an image upload, execute twice, report success with no affected profile row, strand the busy state after a thrown request, or update a different account after a switch. Failed initial reads could leave blank editable fields. | Save waits for upload completion and a successful initial read, uses a synchronous lock, verifies the updated row, preserves edits on failure, bounds reads, allows Retry and refreshes all saved auth-profile fields. Account identity changes fence late work, including A → B → A. | Four executed behavioral cases cover upload/save guards, duplicate taps, zero-row/transport failures and account switching. Actual photo picker/upload acceptance remains open. |
| Saved Posts | This separate screen bypassed the content-media signer, treated bookmark or post-query errors as an empty collection, and restored a whole old list after a failed unsave. | It now signs and renews authorized media, shows text while signing, preserves existing readable rows on read errors, offers Retry, distinguishes loading from unavailable media and fences stale account responses. Concurrent unsaves restore only the individual failed item. | Actual load/unsave callbacks are tested, including unsigned URL removal and mixed successful/failed removals. |
| My Network: communities | Native My Network still read and wrote `communities`/`community_members` directly, although those client grants were intentionally revoked. Errors appeared as empty groups. Its old create path did not use the canonical community owner contract. | The directory uses paged `get_communities_page`, including authorized membership and pending-request fields. Create, join, cancel-request and leave use existing checked RPCs. Opening a community uses the canonical Community screen. People, communities and clubs have independent failure states. Join/leave buttons describe the action and only update after a confirmed response. | The contract agent verified live community table grants remain revoked and club tables remain supported. No new grants were added. Tests prove paged authorized reads, partial failure isolation, pending join requests and failed-leave preservation. |
| My Network: clubs and navigation | Club member reads and leave/create outcomes were not checked; a partly created club could produce an inaccurate success/failure message and lead to duplicates. | Read/write errors are checked, members have a Retry state, repeated actions are locked, account/route changes invalidate late results, group search filters groups, and partially successful club creation explicitly instructs the owner to Join the existing club. | Club table RLS supports current reads and self membership writes. No direct club deletion is attempted; the live table has no normal client DELETE policy. |
| Search | Old searches could overwrite a newer query; query failures appeared as “No results”; post images bypassed signing; the recent-search key was shared across accounts. Job results opened the Jobs list instead of the selected job. | Requests are scoped to account/query/mode, all four categories clear correctly, source errors have separate Retry states, block-filter failure publishes no results, post media is signed and renewed, recent searches use account-specific keys, and job results open JobDetail with that job. | Actual callback tests cover stale results, signing failure, independent source errors and fail-closed block settings. No search events or private user data were written by tests. |
| Seller history | Failed seller-history reads were silently interpreted as zero sales/reviews; this could label an established seller as new. A previous seller’s data could linger after a route change. | Failed reads show Retry, scope changes clear old data, a result is bound to the seller it describes, and reads have a deadline. | The actual effect is tested for read errors and disposed/stale results. No real reviews, reports or orders were created. |
| Dark-mode gaps | Several screens used themed containers but retained light-only text, borders, chips, form backgrounds or status bars; some components did not subscribe to theme changes. Web memory artwork inherited the global `white` token remap, which made fixed dark art and navy buttons unreadable. | Saved Posts, Search, My Network, Activity filters, seller trust/reviews/reports and memory settings now use semantic theme colors. Inputs and status bars follow the theme. Fixed dark artwork uses its fixed viewing palette; fixed navy Open/Save buttons keep white text. Book paper and artwork colors remain paired. | Eight actual-style tests exercise Light, Dim and Lights out, checking specified readable text/control pairs at least 4.5:1. This is targeted contrast verification, not a claim that every pixel of every route has been visually accepted. |
| Misleading settings actions | Rate the App displayed a placeholder success-like alert. Delete Account promised complete data/content erasure although the live RPC does not erase stored objects. | App Store rating is explicitly unavailable until public release. The deletion dialog now states that uploaded files are not automatically erased and provides the support path for remaining files. | Copy is aligned with the current implementation. Complete account media erasure remains a release requirement; changing the copy does not complete that backend work. |

## Production media investigation

The earlier read-only production inventory in this same quality pass recorded:

- 22 active attachment rows, all with corresponding Storage objects: 17 canonical bindings and 5 valid legacy references.
- 26 canonical visual references across active post documents, all with corresponding Storage objects: 21 bindings and 5 valid legacy references.
- No missing canonical bindings or object-version mismatch in that inspected sample.
- The deployed `content-media-sign`/`content_media_manifest` implementation matched the repository; the recorded manifest fingerprint was `1bc0a04f263b282b5e785127ab0f0078`.

That evidence supports repairing the pending/expired-capability handling. It does not establish that every historical asset, decoder, CDN path or device is healthy. No real user post, image, video, album or account was deleted or rewritten as part of these checks.

### Privacy boundary still open

The production `post-media`, `story-media` and `media` buckets remain public. Application-level authorization and signed-client rendering do not by themselves prove that an already-known public object URL is inaccessible to a non-viewer. The broad privacy claim therefore remains unverified until the coordinated private-bucket cutover and denial tests are complete.

Do not flip these buckets independently while the installed clients may still depend on public URLs. The cutover needs a reference inventory, compatible clients and a test of every reader: feed, profiles, search, saved posts, stories, books, articles, moderation and old links. Cache behavior and unauthorized direct URLs must be tested as well as the visible UI. This task did not change bucket visibility.

This is separate from the recipient-limited message viewer described in `PRIVATE_MEDIA_20261028.md`; that feature has its own compatible-client and cleanup boundary. Neither mechanism is end-to-end encryption.

### Account-erasure boundary still open

The inspected live `delete_user_account(uuid)` was the older direct-delete implementation (recorded fingerprint `2216cc828cb339debeeed40865d72d78`). It deletes listed app rows and the auth account, but it does not enumerate or erase Storage objects. Historical notes about a newer retention/review flow must not be used as proof that such a flow is deployed.

A complete deletion workflow still needs canonical object ownership/reference checks, a retryable erasure queue, retention rules, an audit receipt and tests that shared/live content is preserved where required. This pass corrected the misleading user-facing promise. It did not invoke deletion on a real account or deploy a broad erasure change.

## Memory playback: what is and is not complete

The new Play book option provides continuous in-app presentation of ordinary saved photo and video pages. A photo defaults to six seconds, with existing saved durations bounded to a readable range. Photo timing pauses until the image is ready and across background/pause transitions. Video excerpts stop at their selected end and advance once. The book stops at the last page rather than silently looping forever.

The automatic presentation preserves the existing small-book experience. The user can still open a cover manually, turn pages, return to the cover, change the paper/cover design, use the page grid or stop playback. Editing controls and playback progress remain outside the saved image composition.

The following remain substantive limits:

1. A soundtrack can become audible only after a cleared catalogue and provider rights are configured and accepted. A disabled catalogue is not a completed music feature, and an Apple Music subscription does not replace those reuse rights.
2. Shared-post video cards keep their existing open/full-post viewing behavior. They are not yet a fully composed, automatically playing video segment in an exported memory movie.
3. There is no complete downloadable MP4 pipeline that bakes every photo, video, sticker, text layer, transition and soundtrack into one movie. The app preserves editing recipes for app playback.
4. Device audio interruptions, iOS mixing behavior, long albums, low-memory performance, video decoder failures and battery use need physical-device acceptance.

## Packaging correction from isolated CI

GitHub's isolated web job at commit `1a387bb` exposed a dependency-boundary error: `shared/useMemoryPlayback.ts` imported React from outside the web application. Local checks had both native/root and web dependencies installed, which masked the missing-module error that occurs when only `web/node_modules` exists.

The shared module now exports a React-independent hook factory with structural hook ports. `src/hooks/useMemoryPlayback.ts` and `web/lib/useMemoryPlayback.ts` each import their own application's React and supply those hooks. The web wrapper is explicitly a client module. The playback clock, timer cleanup, pause/resume behavior and current completion callback remain shared. No root Expo installation, runtime-to-declaration alias or dependency-path workaround was added to the web job.

The new `web/tests/memory-hook-boundary.cjs` regression copies the actual shared factory, clock and web wrapper into a fresh temporary tree containing only real web React, its types and `csstype`. It checks successful TypeScript compilation and actual JavaScript runtime resolution from the web wrapper. Its negative control restores a React import under `shared/` and requires the original TS2307 failure, proving that root dependencies cannot mask this regression. Two additional playback-hook cases verify progress, current callback selection, timer disposal and pause/page-change behavior through the structural ports.

The complete web project also passed `tsc --noEmit --incremental false` in a fresh source checkout with only `web/node_modules`, using the approved Next.js 16.4.3 patch and the existing React 19.2.8 version. The checkout contained no root `node_modules`, and the boundary regression passed there as well. Normal native/web typechecks and 68 memory/player/page-turn/shelf cases passed after the source correction, with no skips or failures.

## Automated verification

Run individual test files with `node path/to/file.cjs` in this environment. The observed `node --test` wrapper could report a file-level success without reporting its contained registered cases, so this audit counts the named cases actually executed.

| Test file | Executed passing cases |
| --- | ---: |
| `tests/quality/memory-story-presentation.cjs` | 17 |
| `tests/quality/memory-stability-regressions.cjs` | 14 |
| `tests/quality/memory-page-turn.cjs` | 14 |
| `tests/quality/profile-content-regressions.cjs` | 15 |
| `tests/quality/memory-media-regressions.cjs` | 6 |
| `tests/quality/memory-playback.cjs` | 6 |
| `tests/quality/profile-shelf-lifecycle.cjs` | 4 |
| `tests/quality/memory-picker-accessibility.cjs` | 4 |
| `tests/quality/edit-profile-save.cjs` | 4 |
| `tests/quality/profile-media-renewal.cjs` | 3 |
| `tests/quality/directory-media-sweep.cjs` | 11 |
| `tests/quality/dark-surfaces-sweep.cjs` | 8 |
| `web/tests/memory-hook-boundary.cjs` | 1 |
| **Total for this lane** | **107** |

Native and web TypeScript checks pass for the combined source inspected by this lane. The main release report owns the final whole-repository test/build totals, because other agents continue changing related stories and message files. Tests use synthetic clients, rows and deferred responses; passing those tests does not mean authenticated production or iPhone UI actions were performed.

## Device and role acceptance before release

| Scenario | Required evidence |
| --- | --- |
| Own and another profile | Open photos and videos, paginate, change profile tabs, background beyond a capability expiry, return, lose/recover connectivity and retry without a false missing-media state. Verify that a revoked/private post disappears rather than using an unsigned fallback. |
| Saved Posts | Save/unsave separate posts quickly, fail one request, reopen the screen and confirm correct order, media access and account isolation. |
| Memory book | Play a mixed album, pause/resume, manually move in both directions, finish and replay, open/close full-screen video, background during a page turn and test Reduced Motion. Confirm no double advancement or unexpected infinite video loop. |
| Memory audio | With a cleared provider catalogue, test the same soundtrack across page turns, volume, mute, calls, headphones, Bluetooth, silent mode, backgrounding and app interruption. |
| Edit profile | Pick/upload large photo and banner files, cancel permissions, press Save during upload, repeat Save, fail the network and switch accounts during a pending response. Verify stored fields and the visible avatar. |
| Network/community roles | Open public/member/invited communities, request approval, cancel, join and leave. Test the owner-transfer restriction. Create a community and a club, including membership failure after club creation. |
| Search | Type rapidly, clear during a request, change Top/Latest, switch accounts, open the selected job, test independent category outages and expired post media. |
| Light/Dim/Lights out | Check Activity, Search, Saved Posts, Network, seller cards, review/report sheets, book settings, keyboards and status bars at large text sizes on iPhone. |

The current browser session did not provide an authenticated production account for a complete click-through. These gates must remain open in the release report. No TestFlight release is authorized by this audit.
