# Admin usability refinement

This checkpoint continues the existing admin design and operations work. It fixes observed behavior in the shared components and existing desks. It does not claim equivalence to another company's internal system or completion of authenticated hosted acceptance.

## Corrected behavior

- Share and table-export panels support keyboard entry, Escape, focus restoration and dismissal when focus leaves. Panels use a viewport-bounded layer so tables cannot clip their actions.
- Clipboard success is announced only after the browser confirms the write. Denial reports a recoverable error. Failed presentation storage leaves the draft note available for retry.
- Presentation items are scoped to the current staff identity and role in sessionStorage. Malformed stored objects do not reach the renderer. The 40-item bound rejects another item explicitly instead of discarding it while reporting success. The old unscoped localStorage tray is not imported.
- CSV output quotes carriage returns and neutralizes spreadsheet formulas, including formulas preceded by whitespace. Export labels distinguish the loaded desk, the filtered rows and the 60-row presentation collection.
- The presentation editor fits a 390-pixel viewport. Slide selection moves to the chosen slide. Presentation playback has visible Previous, Next and Exit controls and works when fullscreen is unavailable. Fullscreen rejection cannot create an unhandled promise rejection.
- The identifier-masking option describes the columns it masks and asks the author to review names and free text before external sharing. It no longer describes a heuristic transformation as a sanitized external report.
- Business applications and registered accounts have separate stable pagination, exact totals and preserved page links. Read failures are surfaced rather than displayed as empty queues. Applicant and membership read failures cannot produce false empty identities or team counts.
- Organization search and archive visibility preserve each other. Ownership transfer has a visible label and a required destination username. Organization rows and controls wrap on narrow screens. Audit and member read failures are surfaced.
- Remaining hard-coded organization/member colors now follow the active palette. Danger-button text follows the palette's readable foreground. Mobile chrome no longer squeezes the breadcrumb into individual letters, and the mobile staff Exit control remains available.
- Platform-control forms have persistent labels. Repeated blocked-word controls have stable React keys and descriptive removal labels. Feature-flag copy no longer promises an unverified propagation deadline.

## Verification

The browser fixture exercises actual production components with synthetic data and a navigation adapter. It does not authenticate a hosted staff user or send any live operation.

- `node admin-web/tests/presentation-storage.cjs`: 6 cases passed.
- `node admin-web/tests/operations-quality.cjs`: 7 cases passed.
- `node admin-web/tests/preview-routing-regressions.cjs`: 6 cases passed.
- `node admin-web/node_modules/typescript/bin/tsc --noEmit -p admin-web/tsconfig.json`: passed.
- Extended real-browser fixture: see `admin-ui-20261030/browser-receipt.json` for the final 24 interactions, browser version and timestamp.
- Screenshots: `desktop-light.png`, `desktop-dark.png`, `mobile-light.png` and `presentation-mobile.png` in the same evidence directory.

A final visual pass found a mobile export-feedback overflow after collection. That defect was corrected by positioning feedback inside the viewport, then the complete interaction fixture was rerun.

## Acceptance boundaries

The source changes preserve server permissions and command contracts. Real staff sign-in, database-backed application pagination at scale, Auth provisioning, retention decisions and provider operations still require the separately tracked hosted acceptance. The fixture verifies UI interactions and failure handling, not physical-device or production-provider behavior.
