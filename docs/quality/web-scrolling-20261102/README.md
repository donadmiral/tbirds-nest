# Web mouse scrolling, 2 November 2026

This update addresses web feed movement, media layout and return navigation. The release target is the existing **web QA preview**. It keeps the browser's native wheel distance and trackpad behavior. Native phone code, admin product code, dependencies, production domains, backend configuration and access controls are unchanged.

## What changed

1. **Media reserves its space before loading.** Feed dimensions and authored framing determine the card's size. Older images without dimensions reserve a 4:3 frame, and older videos reserve a 4:5 frame. Natural dimensions and late edit recipes fit inside that space. An inner crop clips authored transforms correctly. Metadata arrival no longer animates the surrounding card's height. The full viewer continues to fit the actual media dimensions.
2. **Pagination keeps existing cards stable.** The controller preserves row and media-array identity when sanitizing URLs changes nothing. Home memoizes the existing card boundary. Equivalent arrays no longer reset the gallery's authorized metadata. New, expired, revoked, changed or differently scoped media still follows the existing authorization and renewal rules.
3. **Returning Home has one scroll-restoration owner.** A valid same-session cached feed restores its own mode and position after child layout measurements, in a microtask before the next animation-frame observation. Generic route memory continues recording offsets and handling cold or other routes. User intent, stale callbacks, route changes and account changes still cancel pending restoration.
4. **Menus and viewers avoid extra scroll work.** Navigation popovers combine captured scroll events into one positioning measurement per frame, skip their own internal scrolling and avoid unchanged position updates. Discover and the app-wide image viewer preserve the desktop scrollbar gap and restore focus without scrolling. Discover keyboard paging respects reduced motion.

No global wheel multiplier, JavaScript momentum loop, mandatory feed snapping or window virtualization was added. Existing bounded video preparation, source identity checks, data saver behavior and playback ownership remain in place.

## Reproduced problems

The [archived media-code comparison](image-baseline.json) reproduced a delayed image expanding its media frame from zero to 160 pixels and changing the card height from 180.796875 to 340.796875 pixels. The compiler explicitly substituted the two archived modules listed in that receipt. This was not a whole-repository baseline build.

An [intermediate navigation regression](navigation-baseline.json), with both real restoration components mounted, returned all 36 posts but moved the page from 12204 to 12588 pixels. This established the competing generic/Home restoration issue. A subsequent strict first-frame regression caught a temporary zero offset before the saved position. The final implementation fixes both cases without weakening those assertions.

## Final browser results

The new [wheel suite](wheel-results.json) passes **9/9 checks** using actual application components, actual `mouse.wheel` events, local image/video responses and synthetic services.

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
| Messages → Home with refresh held | 12204 px before navigation, while pending and after resolution |
| Composer and global viewer | Background wheel movement zero, closing restores the page position and styles |
| Reduced motion | Requested and observed 600 px, native scroll behavior retained |

Every wheel trace has zero unintended reverse steps. At most two video sources are attached among twelve video elements, with at most one playing. Frame-interval samples are retained in the receipt as local evidence, not as a universal device performance threshold.

The existing [social browser suite](social-results.json) also passes **41/41 checks**, with no runtime errors. Its unchanged strict [warm-navigation assertions](warm-navigation-frames.json) see Home at 780 pixels in all 38 sampled frames and Messages at 247 pixels in all 76 sampled frames, with no blank-content frame. The [before](social-source-before.json) and [after](social-source-after.json) manifests confirm unchanged inputs during that run.

The existing [media readiness browser suite](media-readiness.json) passes **7/7 cases**, retaining source/poster correctness, bounded preparation, data saver, visibility and session invalidation behavior.

## Regression and type checks

- [Full web regression suite](integration.json): 65 test files passed, none failed. Web TypeScript passed.
- [Final navigation follow-up](final-navigation.json): after the final microtask timing correction, all three affected navigation/controller test files passed and TypeScript passed again. The full-suite receipt identifies the preceding helper revision, and the follow-up binds the final helper and tests. Other full-suite inputs are unchanged.
- All nine wheel cases and all 41 existing social cases ran against the final helper. Their receipts record source fingerprints and unchanged inputs.
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

The deployment commit, exact QA target and hosted acceptance are recorded separately after the immutable build is ready. The [evidence manifest](evidence-manifest.json) binds the local receipts retained here.
