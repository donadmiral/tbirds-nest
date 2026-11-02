# Web mouse scrolling, 2 November 2026

This update addresses web feed movement, media layout and return navigation. The release target is the existing **web QA preview**. It keeps the browser's native wheel distance and trackpad behavior. Native phone code, admin product code, dependencies, production domains, backend configuration and access controls are unchanged.

## What changed

1. **Media reserves its space before loading.** Feed dimensions and authored framing determine the card's size. Older images without dimensions reserve a 4:3 frame, and older videos reserve a 4:5 frame. Natural dimensions and late edit recipes fit inside that space. An inner crop clips authored transforms correctly. Metadata arrival no longer animates the surrounding card's height. The full viewer continues to fit the actual media dimensions.
2. **Pagination keeps existing cards stable.** The controller preserves row and media-array identity when sanitizing URLs changes nothing. Home memoizes the existing card boundary. Equivalent arrays no longer reset the gallery's authorized metadata. New, expired, revoked, changed or differently scoped media still follows the existing authorization and renewal rules.
3. **Returning Home has one scroll-restoration owner.** A valid same-session cached feed restores its own mode and position after child layout measurements, in a microtask before the next animation-frame observation. Generic route memory continues recording offsets and handling cold or other routes. User intent, stale callbacks, route changes and account changes still cancel pending restoration.
4. **Menus and viewers avoid extra scroll work.** Navigation popovers combine captured scroll events into one positioning measurement per frame, skip their own internal scrolling and avoid unchanged position updates. Discover and the app-wide image viewer preserve the desktop scrollbar gap and restore focus without scrolling. Discover keyboard paging respects reduced motion.
5. **Polls and quoted posts retain their measured space on a warm return.** A session-scoped, bounded cache stores layout numbers only, separately for each block and width. The previous footprint is reserved before paint while a fresh authorized read is pending. New or removed content takes its actual height when it resolves. Visiting a narrower detail page does not erase the wider Home measurement. Legacy image/video posts retain a type/count placeholder while a media grant is pending or denied, without retaining a private media URL or poster.
6. **Reduced motion no longer introduces layout transitions.** The previous universal positive transition duration also enabled the default `transition-property: all` on static elements. Setting that duration to zero prevents gallery widths and a poll's top margin from briefly interpolating during a warm return. The existing animation policy is unchanged.

No global wheel multiplier, JavaScript momentum loop, mandatory feed snapping or window virtualization was added. Existing bounded video preparation, source identity checks, data saver behavior and playback ownership remain in place.

## Reproduced problems

The [archived media-code comparison](image-baseline.json) reproduced a delayed image expanding its media frame from zero to 160 pixels and changing the card height from 180.796875 to 340.796875 pixels. The compiler explicitly substituted the two archived modules listed in that receipt. This was not a whole-repository baseline build.

An [intermediate navigation regression](navigation-baseline.json), with both real restoration components mounted, returned all 36 posts but moved the page from 12204 to 12588 pixels. This established the competing generic/Home restoration issue. A subsequent strict first-frame regression caught a temporary zero offset before the saved position. The final implementation fixes both cases without weakening those assertions.

The [hosted intermediate check](hosted-baseline.json) then exposed a separate cause: poll options and a quoted-post preview temporarily disappeared on a return to Home. The page moved from 2442 to 2595 pixels as those blocks returned, despite stable media frames. The [synthetic comparison](async-block-baseline.json), explicitly substituting the pre-fix PostCard and PollCard modules, reproduced a 198-pixel change. The final tests hold those reads separately and track the visible card and media frame throughout resolution.

A final legacy-media test under reduced motion caught a separate [12-pixel drift](reduced-motion-baseline.json). The application restored the correct offset, but the browser briefly interpolated media widths from 608 to 638 pixels and a poll margin from zero to 12 pixels, then adjusted its scroll anchor. A diagnostic build changed only the reduced-motion transition duration to zero and passed all 11 unchanged checks. The same correction is included in the final product source; no global anchoring override was added.

## Final browser results

The new [wheel suite](wheel-results.json) passes **11/11 checks** using actual application components, actual `mouse.wheel` events, local image/video responses and synthetic services. This report retains the local source fingerprints, checks, condensed geometry ranges and hash of the complete local receipt. CI independently runs the same suite and uploads its own full frame receipt; its timestamps and receipt hash differ from the local run.

| Scenario | Verified result |
| --- | --- |
| Delayed image decode | Reserved 638 × 478 px frame, card height, document height and scroll position unchanged |
| Delayed video metadata | Reserved 638 × 798 px frame and scroll position unchanged |
| Late square crop with 2× scale | Outer frame unchanged, inner 478 × 478 px crop clipped correctly |
| Detented wheel | Requested and observed 960 px |
| Faster wheel | Requested and observed 2880 px |
| Reverse wheel | Requested and observed −720 px |
| Small wheel deltas | Requested and observed 160 px |
| Long feed after pagination | Requested and observed 3600 px |
| Pagination from 20 to 36 posts | Existing card/player DOM retained, zero repeated metadata reads for retained posts, visible anchor unchanged |
| Messages → Home with refresh held | 12416 px before navigation, while pending and after resolution |
| Poll and quoted-post reads held separately | All 79 sampled frames retain the same visible card/media position, document height and 12416 px scroll offset |
| Legacy image grant allowed, then denied, under reduced motion | All 118 sampled frames retain the same geometry and 4278 px scroll offset; the 56 × 56 px placeholder remains until authorized pixels load |
| Original post changes or disappears | A fresh text-only source clears the media placeholder; a missing source clears the entire quoted block |
| Composer and global viewer | Background wheel movement zero, closing restores the page position and styles |
| Reduced motion | Requested and observed 600 px, native scroll behavior retained |

Every wheel trace has zero unintended reverse steps. At most two video sources are attached among twelve video elements, with at most one playing. Frame-interval samples are retained in the receipt as local evidence, not as a universal device performance threshold.

The existing [social browser suite](social-results.json) also passes **41/41 checks**, with no runtime errors. Its unchanged strict [warm-navigation assertions](warm-navigation-frames.json) see Home at 780 pixels in all 38 sampled frames and Messages at 247 pixels in all 76 sampled frames, with no blank-content frame. The [before](social-source-before.json) and [after](social-source-after.json) manifests confirm unchanged inputs during that run.

The existing [media readiness browser suite](media-readiness.json) passes **7/7 cases**, retaining source/poster correctness, bounded preparation, data saver, visibility and session invalidation behavior.

## Hosted acceptance

The [signed-in QA check](hosted-acceptance.json) exercises the immutable final product build. Three native mouse-scroll actions move the feed by the expected net 1170 pixels, with all 10 posts and the 8148-pixel document retained. On Home → Messages → Home, the page remains at 3987 pixels and both visible media frames retain identical coordinates and dimensions. The first observed return has the poll and quote still pending, occupying their previous 118.5- and 94-pixel footprints; resolving them causes zero measured movement. These are hosted UI/DOM observations, separate from the exhaustive frame samples in the synthetic browser tests.

## Regression and type checks

- [Full final web regression suite](integration.json): 67 test files passed, none failed. The separately bound [final TypeScript check](typescript.json) passed without diagnostics. All 660 recorded web/shared inputs were unchanged during the unit run, and the browser/type-check fingerprints remained unchanged through their runs.
- New focused cases cover session invalidation, removed content, width-specific measurements, the 128-measurement bound, delayed or denied legacy-media grants and independent author/media completion.
- The wheel receipt records final source fingerprints and unchanged inputs. The retained 41-case local social and seven-case media receipts cover the first scrolling commit; final-source coverage is supplied by the complete browser workflow recorded with the release.
- The browser workflow now runs the new wheel suite and uploads its synthetic JSON and screenshot evidence with the existing groups. Existing assertions and gates remain enabled.

Run the relevant checks from the repository root:

```bash
node web/tests/browser/scroll-run.cjs
node web/tests/browser/social-run.cjs
node web/tests/browser/media-readiness-run.cjs
```

Use the pinned official Chrome runtime through `PLATINUM_CHROMIUM`. The new runner accepts `PLATINUM_SCROLL_OUTPUT` and `PLATINUM_SCROLL_ARTIFACTS` for its local build and evidence directories. The checked browser version is `156.0.8078.80`.

## Scope of the evidence

Browser fixtures use real rendering and media elements with synthetic Auth, database responses and a local routing adapter. They verify geometry, input displacement, identity and restoration behavior. They do not establish physical mouse-driver behavior, production network latency, GPU performance on every device or identical behavior to another platform. Native scrolling retains the user's browser and operating-system wheel settings.

## Release and final CI

The [release record](release.json) binds product commit `c369e378fc893364a9583821211941486ab036bd` to READY deployment `dpl_Bikrc21vWDieNKgukXHS5jFJQZaT` and the existing [web QA preview](https://platinum-web-git-codex-app-quality-20261029-intobank.vercel.app/home). The alias was read back after assignment and the deployed page was reloaded before hosted acceptance.

[Workflow run 41370094774](https://github.com/donadmiral/tbirds-nest/actions/runs/41370094774) completed successfully on that exact product commit, on its first attempt. All **17 browser/media groups** passed, totaling **345 primary checks/cases**, including all **11 scrolling checks**. The book-design group additionally measured 288 covers in 48 configurations; those measurements are not added to the primary-case total. The release record includes the independently generated CI artifact's ID, digest, size and expiration.

The QA alias stays pinned to the tested product build. The documentation closeout records these results without changing the product source. The [evidence manifest](evidence-manifest.json) binds the retained local receipts, hosted observations and release metadata.
