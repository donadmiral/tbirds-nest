# Platinum Circles professional web implementation

Date: 2026-10-30

## Scope and design decisions

This change applies the supplied navy, white and champagne direction to the existing professional web application. It uses the supplied Business Studio, newsroom, advertising, analytics, partnerships, earnings and team concepts as references for hierarchy and navigation. The public business profile receives connected Shop, Reviews and About sections; its outer profile header is handled by the separate public-web change.

Studio now has its own full-width workspace: a navy navigation rail, consistent Lucide icons, a workspace identity, breadcrumbs, a tool finder, responsive navigation and an explicit return to the public application. Personal accounts have a Creator Studio with publishing, partnership and earnings destinations. Existing business access-code binding remains required where the service requires it. The server continues to authorize every protected operation.

The implementation uses the application's actual data contracts. It does not insert the reference images' fictional sports events, campaign revenue, external social accounts or financial figures into production. All synthetic identities and records used for screenshots are confined to `web/tests/browser/studio-*` adapters, which are never imported by an application route.

## Connected surfaces

| Surface | Implemented behavior | Authority and limits |
| --- | --- | --- |
| Studio overview | Confirmed business activity, attention queue, recent publishing queue, exact draft and failed-upload links, creator workspace | Existing `studio_home` and `studio_list_posts`; no invented event banner or revenue |
| Content and Planner | Create and exact-draft deep links, failed-content filter, media order controls, individual failed-upload retry/removal, preview, explicit save, unsaved-edit confirmation | Existing account-bound draft save/retry and publication contracts remain in use |
| Newsroom | Assignment and assignee, linked Planner draft, content preview, rights owner and territory, expiry, embargo, sponsor disclosure, separate submission/review/scheduling, change requests, withdrawal, cancellation and history | New `studio_newsroom_*` contracts; independent bound-member review and creative checks are enforced by the migration |
| Ads Manager | Search and filters, selected campaign details, creative preview, staged campaign form, duplication into an unsaved draft, review submission, pause/end/activation confirmation, CSV export and recoverable reads | Existing campaigns and ads contracts; funding received is distinguished from spending, and saving/submission does not charge or activate a campaign |
| Insights | Separate organic, paid and business views; 7/30/90-day reports; zero-based chart with exact accessible daily table; daily export; top posts | Existing `studio_insights`; daily reach totals are explicitly distinguished from unique people across the whole period |
| Creator partnerships | Business brief, named creator acceptance, deliverable versions, feedback and approval, explicit publishing and paid-promotion consent with expiry, withdrawal, revocation and history | New `studio_partnership*` contracts; text/caption and an optional eligible public original post are supported. Consent does not publish, create an ad, authorize payment or replace platform ad review |
| Earnings | Actual program/enrollment state, recorded balances by currency, activity export, payout statuses and IntoBank account readiness | Existing validated monetization contracts; missing balances are shown as unavailable, provider restrictions remain visible, and the web view does not invent a payout capability |
| Team and access | Real organization member and delegation routes, role controls, business identity/device/code settings, least-privilege new-member default | New first-member owner binding and expected-user identity overload are consumed; last-owner and live-session protection is enforced by the accompanying backend work |
| Public business profile | Real products, review entry and history, hours, contacts, safe website links and original-post fallbacks | Existing business contracts and authorized media hydration; no placeholder ticket or schedule buttons |

## Interaction and recovery

- The tool finder opens with a button or Command/Ctrl+K, searches actual destinations, supports Escape and restores focus.
- Mobile navigation uses the same available destinations and an accessible modal. Native dialogs provide keyboard focus containment, Escape and close/back paths.
- Planner, campaign, newsroom and brief editors protect changed form values when Cancel, Close or Escape is used.
- Read failures show a retryable error and preserve confirmed data. A failed Insights period change labels the previous period still on screen.
- Campaign filtering cannot leave an unrelated hidden campaign actionable in the detail panel.
- Newsroom and partnership mutations retain the exact command and idempotency key in owner/member-scoped session storage before sending it. An interrupted or ambiguous response can be retried after a tab reload using that same command.
- Workflow detail panels are version matched before actions are presented. Newsroom also refreshes when the publisher changes the linked post status without changing the assignment version.
- Changing an approved source post makes effective permission inactive. The creator can submit a fresh version and can revoke a recorded permission even when it is already expired or ineffective. The UI refreshes its expiry display while open.
- Studio remounts account/member-specific children when the active account or bound role changes, preventing one account's form or result from remaining in another workspace.

## Backend delivery status

The implementation consumes `supabase/migrations/20261030024125_studio_editorial_and_partnership_workflows.sql`. The backend agent reported applying the reviewed migration to the isolated QA project on 2026-10-30 and verifying its definitions and access invariants after application. Its database test fixture passed 39 checks before application. See the separate backend audit for those proofs.

The browser receipt below uses synthetic adapters. It does **not** establish that a real business member and creator completed these workflows against hosted QA. That acceptance step still requires authenticated QA identities and an actual role walkthrough. No hosted account, payment, publishing job or provider operation was initiated by the browser fixture.

## Verification

- Whole-web TypeScript: `npx --prefix web tsc --noEmit -p web/tsconfig.json` passed.
- Root Studio reliability: `node tests/studio-reliability.test.cjs` passed all 9 checks. The test's extracted web save handler now receives the actual failed-upload guard and inline-error callback; its original serialization and retry assertions are preserved.
- Studio presentation/RPC, Planner choices, advertising quality, business applications and monetization regression files passed.
- Scoped ESLint review of the redesigned production components and new helpers: 0 errors. Remaining warnings concern native image elements for authorized media and mutable generation refs used to reject late responses; this is not a claim that the entire repository is lint-clean.
- Chromium actual-component fixture: 25 interaction checks, 0 runtime errors. The receipt identifies synthetic data and its acceptance limits explicitly.
- Visual inspection covered desktop Ads Manager, Newsroom, Partnerships and Insights, dark Newsroom, and a 390-pixel mobile Newsroom. The small viewport checks include horizontal overflow, mobile navigation focus/escape and preserving assignment edits.

Evidence:

- [Browser receipt](studio-ui-20261030/browser-receipt.json)
- [Business Studio](studio-ui-20261030/studio-overview-desktop.png)
- [Ads Manager](studio-ui-20261030/studio-ads-desktop.png)
- [Insights](studio-ui-20261030/studio-insights-desktop.png)
- [Newsroom](studio-ui-20261030/studio-newsroom-desktop.png)
- [Partnerships](studio-ui-20261030/studio-partnerships-desktop.png)
- [Earnings](studio-ui-20261030/studio-earnings-desktop.png)
- [Team](studio-ui-20261030/studio-team-desktop.png)
- [Dark Newsroom](studio-ui-20261030/studio-newsroom-dark.png)
- [Mobile Newsroom](studio-ui-20261030/studio-newsroom-mobile.png)

Reproduce the fixture with:

```sh
node web/tests/browser/studio-compile.cjs
node web/tests/browser/studio-run.cjs
```

The runner needs a local Chromium executable, configured through `PLATINUM_CHROMIUM`, and permission to listen on a temporary localhost port. The generic compiler accepts an entry, output directory and module aliases so the public-web fixture can verify its own actual components with independent synthetic adapters.

## Remaining acceptance boundaries

These changes do not complete all of the reference collection's proposed professional features. There is no new cross-platform publisher, ticketing schedule feed, audience-segment/ad-set delivery engine, purchased music catalogue, automatic creator payment, finalized tax statement, watch-retention report or private deliverable-file exchange. Available UI actions are grounded in supported application contracts; missing provider capabilities are not replaced with successful-looking mock controls.

Production media privacy and erasure, legacy installed-client compatibility, real Auth provisioning, real provider behavior, physical-device acceptance and TestFlight are separate release gates. This Studio delivery does not remove those gates or establish defect-free operation in every environment.
