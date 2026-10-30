# Completion verification — 30 October 2026

This directory records local, hosted CI and authenticated QA evidence for the design, connected journeys, composition, and security source changes. `verification.json` retains the original local-run status and source manifests; hosted CI and live observations are recorded separately below. The final client gates include the late Auth transport deadline correction and business-account Studio landing.

## Published source and hosted review

The tested implementation is `b7a37a7a1e271e1ec037798a39772e151fbcc318` (tree `82d5e6c1fc437746459703f9578b72cf1627d098`). Later changes in this directory are evidence-only.

- [hosted-ci-b7a37a7.json](hosted-ci-b7a37a7.json): all three hosted workflows and all six jobs completed successfully for that exact source. The native result is an unsigned Simulator build.
- [live-qa-walkthrough.json](live-qa-walkthrough.json): READY admin/web deployments for that source and completed authenticated read-only walkthroughs, with actual observations and provider/role limits.
- [live-admin-tools.jpg](live-admin-tools.jpg): actual authenticated admin tools directory with the account rail collapsed and no private records or contact details shown.

Normal authenticated access is working. No preview protection was disabled and no temporary share link was created. Existing QA media, navigation and creator pages were inspected without sending messages, publishing content, creating staff, transferring funds or erasing accounts. The existing animated memory book correctly refused unsupported movie export. The IntoBank connection remained unconfirmed, with payouts unavailable.

See [the current delivery report](../DESIGN_COMPLETION_20261030.md) for the review links and remaining acceptance gates.

## Final results

| Gate | Result | Case accounting |
| --- | --- | --- |
| Native/root TypeScript | Passed | No emit, final client source at capture time |
| Web TypeScript | Passed | No emit, final client source at capture time |
| Admin TypeScript | Passed | No emit, final client source at capture time |
| Native/root regressions | 127 / 127 programs passed | 1,194 / 1,194 cases passed; no skips |
| Web regressions | 54 / 54 programs passed | 607 / 607 reported cases passed; no skips; two additional legacy Studio assertion programs passed without emitting individual case counts |
| Admin regressions | 20 / 20 programs passed | 155 / 155 registered cases passed; no skips; one additional payment-reporting program reports 13 passed assertions |
| Full RPC `npm test` | Passed | 550 Node cases plus 117 explicitly reported custom checks: 666 passes and one feature-variant skip |
| Supabase Node regressions, earlier full snapshot | 28 / 28 programs passed | 296 cases: 293 passes and three feature-variant skips; this run predates the final Edge deadline changes below |
| Final targeted Edge delta | Passed | 21 / 21 targeted cases and all eight Deno entrypoints; overlaps the earlier 18-case business-session file and is not added to 296 as distinct cases |

All final client checks observed no source changes while running. They include the Jobs/Market review and cancellation work, shared-dialog keyboard focus handling, current-owner business entry, the native/web business-session clients, complete Auth response-body deadlines, and native Studio landing for business accounts. The late transport correction is identified by source hash in `verification.json`; the preceding baseline and its gate files are preserved separately as `verification-before-auth-transport.json` and `gates-before-auth-transport/`.

## Commands and counts

The three TypeScript commands are `node <package>/node_modules/typescript/bin/tsc --noEmit -p <package>/tsconfig.json`, using the repository root, `web/`, and `admin-web/` projects.

The native and web test inventories use the same `tests/*.cjs` and `tests/quality/*.cjs` globs as CI, in the appropriate package directory. The admin inventory uses its same 20 `tests/*.cjs` files. Each file runs in its own Node process with maximum concurrency two. Direct file invocation preserves the case summaries that this local Node version's aggregate `--test` reporter otherwise hides. Every command, working directory, exit code, timing, log path, and log hash is recorded in the gate receipts.

The RPC gate runs the unmodified `npm test --prefix supabase/tests/rpc-authorization`. Its count includes completed custom check scenarios reported by those programs. Migration compilation unit counts and the uncounted postflight program are not presented as additional test cases. The Supabase Node gate runs the exact `supabase/tests/*.test.*` inventory with the required local PGlite module paths.

Counts describe executed scenarios. They are not a unique-test count across packages: some shared protections are exercised in multiple packages and release variants.

The final Auth transport tests run actual installed native and web Auth SDKs against local synthetic transports. They cover stalled headers, stalled bodies, cancellation, late responses, byte limits, response preservation, and retries without a late session write. Normal Auth requests have a 15-second transport budget; refresh-token requests have a 60-second budget to retain the SDK refresh/retry behavior. These are transport bounds, not a claim that every authentication workflow completes in 15 seconds.

The full Supabase Node gate was completed before four final Edge source paths changed: `serveBusinessRequest.ts`, `business-session/runtime.ts`, `business-session.test.cjs`, and the new `boundedFetch.ts`. Its original count and source manifest are retained. The separate `docs/quality/studio-workflows-20261030/business-auth-edge-delta.json` receipt binds the later 21-case result to all four exact hashes. It includes the original test output preserved as a `.txt` artifact. The eight-entrypoint Deno result is identified as the previously observed successful tool output; no standalone original Deno log was saved. SQL is unchanged, and no unrelated local suite was repeated for this documentation correction.

## Why four cases are skipped across the database commands

The default Supabase Node invocation and the RPC runner's `PLATINUM_VISUAL_RELEASE=1` variant intentionally select different release behavior. The receipts retain every skip; each named skipped case has a successful paired execution in the other invocation.

| Case | Skipped in | Passed in |
| --- | --- | --- |
| Owner-bound, attested, idempotent sound publication | Visual-release RPC variant | Default Supabase Node |
| Memory-book signing with explicit custom access and inactive accounts | Default Supabase Node | Visual-release RPC variant |
| Visual-only media manifests without separate soundtrack authorization | Default Supabase Node | Visual-release RPC variant |
| Visual-only story publication without audio infrastructure | Default Supabase Node | Visual-release RPC variant |

This is local database coverage of both variants. It does not license music, enable a catalogue, or establish hosted-provider behavior.

## Source provenance and supporting evidence

`verification.json` points to the per-gate JSON receipts and deduplicated source manifests. Manifests hash sorted file paths and their SHA-256 values. They include tracked and untracked implementation/test files; environment files, dependencies, generated build caches, and documentation are excluded. The source snapshot includes uncommitted changes and records the branch and HEAD used for the run.

One broad database manifest changed during the RPC run: the native `tests/quality/business-session-clients.cjs` file was being completed by its owner. That file is neither imported nor spawned by the RPC runner. Its SQL, Edge, and shared inputs stayed unchanged, and the final native regression gate subsequently executed the completed client test. The gate receipt records this distinction explicitly.

Related browser receipts are linked by repository path and SHA-256. They cover the actual admin, public app, Studio, Jobs/Market, and composition components with synthetic adapters. The Jobs/Market browser pass contains 24 journeys; its separate report documents screenshots, review/exit paths, idempotent order retries, account fencing, and the strict-lint baseline comparison.

Strict ESLint is not represented as a clean gate. Existing findings and scoped comparisons are recorded in the individual design reports.

## Limits of the local verification inventory

These are local checks using synthetic accounts, media, and database fixtures. They do not establish production private-media compatibility, expired/revoked access through warmed caches, or real account Storage/CDN/Auth erasure. They also do not establish physical iPhone behavior, push and call interruptions, real provider completion, payment/settlement, shipping, or full live staff/owner provisioning. Unsupported composition layers and licensed-catalogue access remain explicitly bounded by the composition report.

No production deployment, payment, live account deletion, provider setting change, or TestFlight release was performed by this verification run.
