# Web audit — frozen 2f91218e

This is a first discovery checkpoint for the member web, commerce and Studio. Production source is unchanged. Nine concrete issue families are ready for a coordinated repair batch; whole-app acceptance remains open.

## Confirmed repair ledger

| ID | Priority | Finding | Routes |
|---|---|---|---|
| WEB-01 | P1 | Failed privacy-word reads permit replacing existing filters | /settings/hidden-words, /settings/muted-words |
| WEB-02 | P2 | Account standing reports a clean record after failed lookup | /settings/standing |
| WEB-03 | P2 | Explore can remain Loading after one rejected feed read | /explore |
| WEB-04 | P2 | Topic reads confuse failure with an empty topic or never settle | /topic/[tag] |
| WEB-05 | P2 | Empty-query Search becomes blank when trending topics fail | /search |
| WEB-06 | P2 | Creation forms remain busy after rejected requests | /market/new, /businesses/new |
| WEB-07 | P2 | Promotion picker hides its content-load failure | /ads/new |
| WEB-08 | P3 | Auxiliary discovery and inbox reads reject without handlers | /market, /discover, /market/new |
| WEB-09 | P2 | Profile photo row intercepts the cover-change button center | /settings/profile |

## What was actually exercised

- **77 actual client page exports**, each under normal, returned-error and rejected-error conditions: **231 observations**.
- **1106 initial-control records** cover clicks, inputs, toggles, selects and explicit skipped/blocked attempts. They are not 1106 passed user actions.
- **58 focused page/read cases**, including30 selective inner-page Studio failures and five populated missing Studio contracts.
- **10 Studio mutation failure actions** reached their intended RPC and showed recovery feedback without uncaught errors. These check drafts/confirmed state and recovery, not real provider persistence.
- **Two profile-cover hit tests** independently reproduce the overlap at1440px and390px.
- The current Browser CI also passed its existing141 member/media/shell scenarios. The37 admin cases are owned by the admin audit. CI fixtures are a separate bounded baseline.

## Important limits

The broad route sweep originally used networkidle; two Market setup timeouts are retained as harness uncertainty. The control sweep preserved interrupted-attempt and beforeunload-reset failures. Topic’s original missing params and unsupported MFA/archive contracts are fixture gaps. None is labeled a product defect.

The actual deployed audit tab is signed out. Public Home→Login, recovery validation and Signup navigation were observed without a new sign-in, email, account or provider write. Authenticated hosted member flows, true permissions/RLS, payments, uploads and third-party calls are not accepted by this audit.

The fourteen server routes and deeper modal/menu/provider actions remain explicit gaps or are covered only by the named existing component fixtures. See `route-coverage.json`. Root separately owns the two Support routes and their failures.

## Evidence

The JSON ledger links exact case IDs, source files and expected/actual behavior. Full raw rows are preserved byte-for-byte in deterministic gzip files, with uncompressed hashes and temporary originals recorded in `raw-archive-manifest.json`. Selected screenshots retain the actual failures; duplicate passing and fixture-only images remain temporary.
