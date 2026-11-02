# Web and admin media readiness — QA release, 1 November 2026

This release brings the repaired media behavior to the web app and admin desk. Its release scope is **QA previews only**. The existing QA Preview environment entries were retargeted to the repair branch without changing their values, production configuration, or deployment protection; see [deployment configuration](deployment-config.json).

## Repairs

- **Feed and shared posts:** keep each poster and decoded frame bound to its exact source, retain valid media through metadata refreshes, and prepare at most two nearby videos. Data saver, visibility changes, and account changes release speculative media. Shared post text can appear before its media grants and author details. See [feed browser evidence](feed-browser/results.json).
- **Stories:** retain the actual upcoming media element, reveal its first valid frame after the saved trim, and stop background playback when opening. Switching authors removes the previous author's media before the next author's request resolves. Abandoned requests and late callbacks cannot restore old content. See [story and memory browser evidence](story-memory/browser-receipt.json).
- **Memory books and films:** use static covers, prepare the actual first and next reader pages, retain players through page turns, and preserve playback position during metadata refreshes. Private media reuse requires a fresh allowed response, the same session, matching media and edit recipes, complete capabilities, and bounded expiry. Film closure releases player sources. See the [130 focused story and memory cases](story-memory/focused-results.json).
- **Messages and pages:** show authorized message text while attachment capabilities load, preserve source identity for attachments, and clear work across session changes. An optional profile request has a five-second deadline so it cannot indefinitely block the authorized page shell. See [integrated regressions](integration-checks.json) and [real Next navigation evidence](navigation/receipt.json).
- **Admin:** list tiles use posters or explicit video fallbacks without mounting players. Detail expansion retains the selected player and playback position; late responses cannot replace another record. Failed photos offer a scoped retry. A buffered paused preview stays ready while staff read a record, with its saved cover retained until a verified frame is presented after Play. The staff media proxy keeps its authorization checks and private no-store delivery while bounding startup and pending reads and validating streamed ranges and lengths. See [final admin browser evidence](admin-idle-preview/browser-receipt.json), [initial focused admin coverage](admin-media/focused-results.json) and [the idle-preview follow-up](admin-idle-preview/focused-results.json).

## Local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Web regression suite | 64 test files passed, 0 failed | [Integration checks](integration-checks.json) |
| Admin regression suite | 30 test files passed, 0 failed, including a rerun after the hosted idle-preview fix | [Final admin integration checks](admin-idle-preview/integration-checks.json) |
| TypeScript | Web and admin checks passed: 2/2 | [Integration checks](integration-checks.json) |
| Real Next App Router browser checks | 4/4 passed | [Navigation receipt](navigation/receipt.json) |
| Feed and shared media browser checks | 7/7 passed | [Feed receipt](feed-browser/results.json) |
| Stories, reader, covers, and film browser checks | 8/8 passed; 9 correct first-frame pixel samples after trim | [Story and memory receipt](story-memory/browser-receipt.json) |
| Admin media browser checks | 6/6 passed, including a real 16-second pause before first Play | [Final admin receipt](admin-idle-preview/browser-receipt.json) |
| Existing social/navigation browser group | 41/41 passed after correcting its service adapter | [Social receipt](social-fixture/browser-receipt.json) |
| Existing commerce browser group | 26/26 passed after waiting for the completed asynchronous filter result | [Commerce receipt](commerce-fixture/browser-receipt.json) |

The four readiness/navigation groups total **25/25 cases**, using Chrome `156.0.8078.80`, plus the separately rerun existing social group at **41/41** and commerce group at **26/26**. The integrated regression totals count **files**, while the focused receipts count individual cases; these totals must not be added together. Browser fixtures exercise actual production components and, for navigation, the actual Next App Router, with synthetic local Auth/database responses and generated local media. They do not establish production latency, universal zero buffering, or authenticated hosted admin acceptance.

## Source and test binding

| Revision | Commit | Git tree |
| --- | --- | --- |
| Initial QA product source | `d780b8b2b4e00d84b53279495c1b0808fa61d491` | `23b539228b05875620b8f042d253662ca3ecf985` |
| Browser installer follow-up | `c4ed86195ee19eface6d99104a7ed942ae3ec0e0` | `4276f25e882fd221c6e82e6b9febcd16f90103a3` |
| Final product and browser adapter follow-up | `dd522586323fe8d460d47cb1720f6352bd12c55c` | `5b690b343375e0d70e96d52022bf45cb825e0626` |
| Verification-only filter wait | `4ea4783b715ffb6744368edbcfee07348fa36587` | `749abd4dd3b3d6fd0bfea56e5f777e20fb76d808` |

The first follow-up changes only `scripts/quality/install-browser-test-runtime.sh` to normalize whitespace in the browser vendor version. The final product follow-up changes the admin paused-preview deadline and its coverage, and restores a missing production-helper export in the social test adapter. Web product source remains identical to the initial product revision. The original integration and media receipts record SHA-256 fingerprints for the initial reviewed sources and test fixtures; the [final admin integration receipt](admin-idle-preview/integration-checks.json) and [social source binding](social-fixture/source-binding.json) bind the follow-up. The original integration receipt's `baseCommit`, `d7e477d2f7b48b4edc0bdbe7bdcf587f95739c4b`, identifies the pre-change baseline.

The verification-only commit changes one browser test to wait for the completed Interview filter result before checking the exact count. It preserves every prior assertion, adds no arbitrary sleep and changes no application code. Its [source binding](commerce-fixture/source-binding.json) ties the targeted 26-case result to the published fixture. Both QA deployments remain on the identical product source `dd522586323fe8d460d47cb1720f6352bd12c55c`.

The phone product paths `src/`, `modules/`, `shared/`, `app/`, root `package.json`, and root `package-lock.json` are unchanged from that baseline, as recorded in [integration checks](integration-checks.json). This release does not replace the previously repaired phone builds.

## Hosted QA and CI closeout

Both final builds reached READY and the existing QA aliases now resolve to the final product source. Exact deployment identities, previous alias targets and source readbacks are recorded in [QA deployments](qa-deployments.json). Hosted observations are separate from the local browser cases above.

| Check | Status |
| --- | --- |
| Hosted web QA | **Passed for the sampled flows** — feed playback and replay, original-post preview, story open/next/back/close, memory reader and continuous film, multi-page handoff, Discover and page navigation. See [hosted web receipt](hosted-web-receipt.json). |
| Hosted messages | **Navigation passed, thread acceptance limited** — the QA account has no conversations. Attachment behavior is covered by controlled regression/browser fixtures, not a hosted conversation in this pass. |
| Hosted admin QA | **Passed for the sampled flows** — authenticated content and stories, static tiles, photo/attachment switching and full-screen position retention. Final delayed-first-play acceptance held the ready preview paused for 35.853 seconds, then played successfully on one click with no media error. See [hosted admin receipt](hosted-admin-receipt.json). |
| Final browser CI [run 41364845674](https://github.com/donadmiral/tbirds-nest/actions/runs/41364845674) | **Passed: 16/16 groups, 334 primary browser cases** on verification source `4ea4783b715ffb6744368edbcfee07348fa36587`. All recorded error arrays are empty. See [final CI receipt](ci/run-41364845674.json). |

The first [CI run after browser setup](ci/run-41362180823.json) passed 15/16 groups. Its social-navigation adapter omitted a new production helper, corrected and verified by all 41 social checks. The [next CI run](ci/run-41364115315.json) passed 15/16 groups and caught a commerce test that sampled a filter result before the asynchronous response completed. The unchanged commerce group passed locally, and the narrow fixture wait passed all 26 cases. The final full run includes both fixture corrections and the admin idle-preview fix.

The hosted checks observed fully decoded and playing videos, a correct original-post preview, and a prepared next video at the saved trim before its page was opened. They also observed brief initial loading and page-transition states. They are not a claim that every network delay has disappeared or that all devices have passed acceptance.


The final CI evidence archive was downloaded and verified against its published SHA-256 and ZIP integrity. All 41 recorded source-hash entries match the exact verification commit. The final run completed on 2 November 2026 at 00:09:29 UTC (1 November in Arizona). No approval or authentication blocker remains for the sampled hosted QA checks.
