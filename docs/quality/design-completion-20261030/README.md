# Local completion verification — 30 October 2026

This directory records the completed local verification of the design, connected journeys, composition, and security source changes. The current `verification.json` is the authoritative status. The final client gates include the late Auth transport deadline correction and business-account Studio landing.

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
| Supabase Node regressions | 28 / 28 programs passed | 296 cases: 293 passes and three feature-variant skips |

All final client checks observed no source changes while running. They include the Jobs/Market review and cancellation work, shared-dialog keyboard focus handling, current-owner business entry, the native/web business-session clients, complete Auth response-body deadlines, and native Studio landing for business accounts. The late transport correction is identified by source hash in `verification.json`; the preceding baseline and its gate files are preserved separately as `verification-before-auth-transport.json` and `gates-before-auth-transport/`.

## Commands and counts

The three TypeScript commands are `node <package>/node_modules/typescript/bin/tsc --noEmit -p <package>/tsconfig.json`, using the repository root, `web/`, and `admin-web/` projects.

The native and web test inventories use the same `tests/*.cjs` and `tests/quality/*.cjs` globs as CI, in the appropriate package directory. The admin inventory uses its same 20 `tests/*.cjs` files. Each file runs in its own Node process with maximum concurrency two. Direct file invocation preserves the case summaries that this local Node version's aggregate `--test` reporter otherwise hides. Every command, working directory, exit code, timing, log path, and log hash is recorded in the gate receipts.

The RPC gate runs the unmodified `npm test --prefix supabase/tests/rpc-authorization`. Its count includes completed custom check scenarios reported by those programs. Migration compilation unit counts and the uncounted postflight program are not presented as additional test cases. The Supabase Node gate runs the exact `supabase/tests/*.test.*` inventory with the required local PGlite module paths.

Counts describe executed scenarios. They are not a unique-test count across packages: some shared protections are exercised in multiple packages and release variants.

The final Auth transport tests run actual installed native and web Auth SDKs against local synthetic transports. They cover stalled headers, stalled bodies, cancellation, late responses, byte limits, response preservation, and retries without a late session write. Normal Auth requests have a 15-second transport budget; refresh-token requests have a 60-second budget to retain the SDK refresh/retry behavior. These are transport bounds, not a claim that every authentication workflow completes in 15 seconds.

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

## Limits

These are local checks using synthetic accounts, media, and database fixtures. They do not establish production private-media compatibility, expired/revoked access through warmed caches, or real account Storage/CDN/Auth erasure. They also do not establish physical iPhone behavior, push and call interruptions, real provider completion, payment/settlement, shipping, or full live staff/owner provisioning. Unsupported composition layers and licensed-catalogue access remain explicitly bounded by the composition report.

No production deployment, payment, live account deletion, provider setting change, or TestFlight release was performed by this verification run.
