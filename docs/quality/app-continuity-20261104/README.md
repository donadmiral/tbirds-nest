# App refresh and rendering continuity

Date: 2026-11-04, with a follow-up from hosted browser findings on 2026-11-05. Base revision: `145d16cfd5b084dc5567fab27ef4cbf0b56b3359`.

## Scope

The review accounts for every registration in the native navigator and every member/admin web page:

| Surface | Inventory |
| --- | --- |
| Native | 98 route registrations, including 92 concrete registrations for 85 unique screen files and 6 navigator wrappers |
| Native supporting modules | 10 supporting or unregistered screen modules, identified separately |
| Member web | 105 page files |
| Admin web | 35 page files |

The [native inventory](screen-inventory.md) and [web/admin inventory](web-route-inventory.md) record each page's loading and identity boundaries. A source audit is distinct from rendered timing or a physical-device run.

## User-visible changes

Feed refresh retains quoted post thumbnails, author information, and optional poll/comment/collaborator details while replacements load. Newly encountered quoted posts can display authorized text and media type before their private media grant finishes. Media link renewal no longer changes the display identity of the same underlying image. Requests continue using the exact renewed URL.

Feed avatars keep the same parent structure and reserved dimensions when story status arrives. The story strip no longer duplicates its initial core read or waits for optional spotlight data. Its shared ring animation runs on the native animation driver without blocking interaction work.

Graded story images retain their decoded surface while a replacement loads. A stale callback, failed request, removed component, or changed account cannot report an image as ready. Decoded image resources are released after replacement or cleanup. Story creation controls and memory arrangement controls appear immediately instead of waiting through entry delays of up to 850 milliseconds.

Complete-component review also found a post thread renderer that shadowed the theme with its row data. Rendering either a parent or child thread could crash. The correction separates the row and theme values. Article galleries and memory covers use the underlying image identity for their mounted surfaces while requests retain the current authorized URL. These paths receive instance-retention regression checks as part of the final correction.

Loaded lists and detail pages remain mounted during same-scope refresh. This applies to the corrected native post, search, jobs, messages, calls, community, profile, activity, archive, business, campaign and Studio paths, plus shared member web resources and the individual page corrections in the inventories. Temporary failures show retry feedback beside retained content.

Hosted browser acceptance exposed an additional Messages scroll race. A resize timer checked whether the reader was at the bottom, then queued an animation frame that could override a later scroll. The retained failure moved the reading position from 247 to 2712 before navigation began. A deterministic test of the production effect reproduced that exact result. The callback now rechecks the reading position's pinned state, account, conversation and list element at execution, and cleanup cancels its timer and frame. Seven focused cases cover these boundaries. The browser's scroll-position and held-refresh assertions remain unchanged.

Admin Live tabs preserve their visited desk and same-selection drafts. Returning to a tab revalidates it without first removing the review. Hidden tabs release playback. Delayed command responses cannot overwrite another selection or a later visit. Read routes preserve existing authorization and missing-record errors so the UI can distinguish those outcomes from an outage.

## Boundaries preserved

Account, session, route, filter and collection identities remain separate. Older reads and queued pagination updates cannot publish into a new identity. Successful empty results and confirmed missing or denied records clear retained values. Malformed reads do not become invented empty lists. A failed private-media grant does not extend an earlier capability or introduce persistent private-media caching.

Caption permission loss clears the creator editor. Old editor callbacks cannot modify a new account's draft. Earnings retain a prior snapshot only for classified transient reads, with enrollment actions disabled until current data is verified. Mutation confirmation, database authorization and provider budgets remain in force.

## Local verification

Final suite results are recorded in `local-verification.json`. The runtime is Node 24.22.1. The suites execute actual production callbacks, hooks, components and parsers with controlled request ordering, errors and identity changes.

Commands:

```text
node --test --test-concurrency=2 tests/*.cjs tests/quality/*.cjs
cd web && node --test --test-concurrency=2 tests/*.cjs tests/quality/*.cjs
cd admin-web && node --test --test-concurrency=2 tests/*.cjs
```

All three applications are checked with TypeScript using `--noEmit --incremental false`. Changed web/admin lifecycle components also receive focused lint checks. The regression suites cover pending refresh, transient failure, malformed data, authoritative empty data, denied access, account changes, late callbacks, queued updates, mutation ordering, and media readiness.

The Messages observer correction adds no lint diagnostic. Its full file retains the same three pre-existing errors and 17 warnings outside the corrected effect, with no rule suppression added.

The browser fixtures compile locally. Actual Chromium execution is blocked by this runtime's socket policy, so rendered browser acceptance uses the repository's existing CI runners.

The first candidate's CI browser setup exhausted its job limit downloading media prerequisites from the runner's Azure package mirror, before application assertions executed. The follow-up uses temporary official Ubuntu HTTPS sources with the existing Ubuntu signing key for these package commands. It verifies working media binaries, preserves Playwright's complete Chromium dependency list and the pinned browser checksum, and bounds prerequisite setup at five minutes. Existing job time limits and acceptance assertions remain unchanged. Ten executable and workflow contract cases cover this installer.

## Release evidence

This candidate requires fresh source-specific release checks, deployable web compilation, browser acceptance and connected Live acceptance. It does not inherit the earlier selector correction's pinned provider evidence. The release workflow additionally checks the exact source revision's Type and quality workflow before submitting or resuming its iOS QA build.

The first candidate's iPhone UI run failed in Simulator Settings before app installation. Its PR merge `c6484a0583c554ad003d2c5b2e475d1f7564be0a` has the same tree as candidate `c69a3b4d82527d6af0bf92f521899ceae99f2aa6`. The retained hierarchy showed an enabled, checked AutoFill switch without the empty identifier required by the test. The follow-up targets that child relative to its identified parent. The independent native-value readback and original 600-second setup limit remain in force. Helper regression results do not substitute for a completed iPhone UI run.

Candidate `2fe16672e0d9373b57ad06f53a57b80974083abb` passed all six quality jobs and its complete push browser run. The duplicate PR browser run exposed the Messages race described above. Fresh connected acceptance completed 37 Live checks, then its clip remained queued during the renderer's UTC rollover exclusion. AWS reported `budget_blocked` throughout that interval, and cleanup removed all three synthetic users. After rollover, a strongly consistent ledger read showed an idle slot and no new-day reservation. The next acceptance run uses normal admission. No budget, timeout, credential or provider exception changes are part of this correction.

A finished EAS package proves build completion. Full native UI acceptance is a separate workflow. Cold launch, warm launch, image refresh, navigation return, slow-network interaction and physical-device frame timing must be assessed from their corresponding runtime evidence. This review does not establish a performance comparison with Twitter or Instagram, zero dropped frames, or instantaneous download of media a device has never received.
