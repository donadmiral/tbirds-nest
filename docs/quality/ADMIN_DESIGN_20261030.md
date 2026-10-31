# Admin design and workflow completion — 2026-10-30

## Scope

This change applies the supplied Platinum Circles design direction to the existing operations app. The design references are the user's desktop concepts, especially Business Studio and Team, Brand & Access. The implementation uses real admin routes and existing server commands. The rendered evidence uses explicitly synthetic account records and a local navigation adapter; it is not evidence of a newly authenticated hosted session or production provider acceptance.

## What changed

- Added a single `63`-icon outline system with a 24 × 24 coordinate grid, 1.75-pixel stroke, consistent caps and joins, and decorative accessibility semantics. Navigation, dashboard indicators, desk statistics, search, appearance, refresh, details, sharing, account and workspace controls now use the same system.
- Applied navy navigation, white and deep-navy work surfaces, champagne selection cues, restrained borders and consistent buttons. All existing light, dark and system appearance choices remain available.
- Added **All tools**, a searchable, keyboard-contained workflow directory shaped by the current staff role. It includes the real deletion request queue, order and dispute investigation, seller-review reports, creator finance, presentation builder and optional authenticator setup routes.
- Added contextual breadcrumb trails, sections and deterministic **Back to…** links for nested destinations and direct record URLs. These return to the relevant desk rather than relying on unknown browser history.
- Added an account menu with staff identity, role, optional security setup, presentation builder and the real operations sign-out action.
- Added explicit offline and restored-connection notices. Offline forms retain their input and reject submission before a request is sent. Reconnection does not replay any administrative mutation; the staff member reviews and retries.
- Added a staff access guide derived from the existing permissions policy, with all roles, available desks and decision capabilities. The guide does not grant any access or bypass server-side checks.
- Corrected the role editor to initialize from the selected record's confirmed role. Previously, an uninitialized select could display the first role option, `super_admin`, instead of the staff member's actual role. Record changes now initialize their own confirmed values.
- Made staff creation copy precise: it creates a staff account, does not claim to send an invitation email, starts from `auditor_readonly`, labels every field, and clears sensitive form fields only after a confirmed successful creation.
- Connected **Their audit trail** to a real actor filter. A full audit reviewer can inspect the selected staff member. Restricted reviewers still receive only their own records even if a different actor is supplied in the URL.
- Added visible pending, confirmed-success and error feedback to administrative forms, plus designed unavailable/404 recovery surfaces with real retry or workspace-return controls.

## Navigation connections

| Destination | Entry points | Return route | Access shaping |
| --- | --- | --- | --- |
| Deletion requests | Users section, rail, command search, All tools | Users | `account_delete` permission; currently super admin |
| Orders & disputes | Market section, rail, command search, All tools | Market | Market desk |
| Seller review reports | Reports section, rail, command search, All tools | Reports | `report_listing` permission |
| Creator finance | Payments section, rail, command search, All tools | Payments | Payments desk; existing availability controls preserved |
| Individual account | User list/detail links | Users | Existing user-desk authorization |
| Support ticket | Support list/detail links | Support | Existing support authorization |
| Individual order | Order list/detail links | Orders & disputes | Existing market authorization |
| Staff audit trail | Staff record details | Audit log / all staff actions | Full-reviewer filter; restricted roles stay scoped to self |
| Add staff member | Staff page action, command search | Staff page | Existing staff-management permission |
| Announcements | Controls, command search | Controls | Existing system permission |
| Presentation builder | Rail tools, account menu, All tools, collection tray | Existing builder exit | Existing dashboard authorization |
| Account security | Account menu, rail account, All tools | Existing security continuation | Existing staff-session checks; optional MFA policy unchanged |

## Verification

- Admin TypeScript: **passed**, `tsc --noEmit -p admin-web/tsconfig.json`.
- Existing admin suite invocation: **19 files passed** before the new navigation suite was added.
- New navigation, permissions and audit-scope regression checks: **8/8 passed**.
- Staff page rendering checks: **2/2 passed**, including the existing read-only default assertion.
- Browser: **35/35 interaction cases passed**, **0 runtime errors**, Chromium `156.0.8078.80`.
- Browser checks covered real shared components: command search, drawer/dialog focus and Escape, details close/focus restoration, filtering and paging, typed staff role defaults, review validation and command identity, clipboard failures, exports, scoped presentation storage, offline draft retention and explicit retry, sign-out wiring, role restrictions, nested routes and return controls.
- Synthetic screenshots reviewed at desktop and 390-pixel mobile widths, including light, dark, collection/presentation and the workflow directory. The browser asserted no horizontal page overflow on mobile.
- Test-server startup now rejects an unsuccessful localhost bind instead of leaving an unresolved test promise.

Browser receipt timestamp: `2026-10-30T02:49:12.735Z`. Counts from separate suites overlap and should not be added as unique end-to-end coverage.

## Evidence

- `docs/quality/admin-design-20261030/browser-receipt.json`
- `docs/quality/admin-design-20261030/desktop-light.png`
- `docs/quality/admin-design-20261030/desktop-dark.png`
- `docs/quality/admin-design-20261030/mobile-light.png`
- `docs/quality/admin-design-20261030/presentation-mobile.png`
- `docs/quality/admin-design-20261030/workspace-tools.png`

## Boundaries preserved

No production database, Auth, Storage, external messaging, payment provider, media access policy, deployment protection, or TestFlight changes were made for this admin design task. The role and server-command policies remain authoritative. The workflow directory makes existing functionality discoverable; it does not claim disabled finance/provider features are live. Actual hosted staff account creation and other provider workflows still require their separate authenticated acceptance checks.
