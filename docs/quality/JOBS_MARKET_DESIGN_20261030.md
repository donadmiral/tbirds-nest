# Jobs and Market: design and connected journeys

Date: 30 October 2026. Scope: the web Jobs and Market directories, their detail and saved pages, applications, offers, order requests, order history, alerts, reports, and the shared public-app review dialog.

## Result

The Jobs and Market surfaces now follow the supplied navy, white, and champagne direction. They use the same line-icon vocabulary as the surrounding app, readable headings, labeled destinations, consistent action sizes, useful empty/error states, and responsive layouts. The work connects the visible controls to the existing application, listing, conversation, and order contracts.

The local browser verification passes **24 of 24 journeys with zero runtime errors**. Eight focused regression files pass **97 of 97 cases**, with no skips. These are actual application components running with synthetic Auth/database adapters. They do not establish production authorization, provider behavior, physical-device acceptance, or the absence of every possible defect.

Evidence is in `docs/quality/commerce-design-20261030/browser-receipt.json` and `verification.json`. The latter records commands, counts, source SHA-256 values, screenshot hashes, and the lint baseline comparison.

## Design and navigation

Jobs and Market use the wide application shell on desktop, with a restrained content width and adaptive layouts. Jobs has a clear search/filter area, readable role cards, a secondary career-navigation panel, and a role-detail/application layout. Market has an image-led grid, useful product details, a keyboard-operable gallery, a separate seller area, and an order-request panel. Dim appearance uses the real application theme tokens.

Category emoji and tiny unlabeled navigation controls were replaced with Lucide icons and visible labels. Job and listing cards use separate links and action buttons, avoiding nested interactive elements. Save, share, gallery, and deletion controls have descriptive accessible names. Form labels remain stable when their values change.

| Surface | Connected path and exit |
| --- | --- |
| Jobs directory | Search, location and category filters; reset; saved jobs; applications; Messages; existing Post a job destination |
| Job detail | Role facts and company information; save/share; application entry; existing employer applicant-management route for the posting owner; related roles |
| Application | Enter details and select a résumé; review; edit or Escape to retain the draft; submit; track the confirmed application |
| Application history | Server-side status filtering, bounded pagination, interview details, refresh/retry, role links, and a separate withdrawal confirmation |
| Market directory | Browse, Saved and Selling; search; reviewable filters with Cancel; price-range validation; alerts; Orders, Messages and Sell an item destinations |
| Listing | Keyboard gallery, seller profile, save/share, real conversation entry, offer review, order review, report and block confirmations |
| Offer | Enter amount; review recipient and amount; edit/cancel; send; continue into the actual Market conversation route |
| Order | Review quantity and delivery notes; edit/cancel; request; inspect status; review versioned actions; show/hide history |
| Seller action | Confirm Mark as sold; retain a failed or unconfirmed update; show success only after the ownership-filtered update returns the changed row |

The existing posting and employer-management screens remain their own destinations. This focused pass does not claim a new redesign or a provider acceptance test for those entire workflows.

## State, privacy and financial boundaries

Application review remains local. It does not upload the résumé or insert an application until the final submission. The existing private-CV flow, upload retry behavior, account-generation checks, deadline checks, and same-tick submission lock remain in place. Failed upload keeps the draft available. Withdrawing an application still sends the current expected status and update timestamp to the existing RPC.

Order review also remains local. A lost response preserves the immutable request key and payload; retry reuses the same request instead of creating another order. The browser fixture verifies this by committing one synthetic order before losing its response, then confirming that the retry returns that order. Order transitions retain expected-user and order-version checks. The app continues to describe IntoBank payment on the phone; this web flow does not fabricate checkout, process payment, or infer a completed delivery.

Account changes clear private application/order drafts and prevent late responses from restoring the previous account's state. Job and listing cards reset their local state by account/item identity. Save failures restore the previous value and expose a retryable error. Cancelling native sharing does not silently copy a URL.

The shared `ProductDialog` retains native modal behavior, Escape/backdrop/close handling, pending-action guards, body scroll locking, and focus restoration. Explicit Tab and Shift+Tab wrapping now keeps keyboard focus inside the dialog, including when every action is disabled. Hidden, disabled, inert, and non-visible controls are excluded from the focus sequence.

## Verification

Run the browser checks from the repository root:

```sh
PLATINUM_CHROMIUM=/path/to/chrome node web/tests/browser/commerce-run.cjs
```

`CHROME_BIN` is also accepted. `PLATINUM_COMMERCE_ARTIFACTS` overrides the artifact directory. The runner builds the actual components through the existing local compiler, uses a loopback server, and never supplies hosted credentials. All people, listings, application records, order values, and product drawings in the screenshots are synthetic.

The 24 browser journeys cover role discovery, filtering, saved-state rollback, share cancellation, résumé review and failed-upload recovery, duplicate confirmation, application tracking and withdrawal, directory retry, Market filter validation and Cancel, saved/selling views, alerts, the gallery, offer review/failure/retry, order review, lost-response recovery, order versioning, history exit, report cancellation, seller confirmation and zero-row failure, account changes during a pending request, signed-out saving, Dim appearance, five routes at 390 pixels, and keyboard focus in a mobile review dialog.

Screenshots inspected include the desktop Jobs directory and product detail, dark Market directory, mobile Jobs directory, and mobile offer review. The narrow-screen checks assert no horizontal overflow and reachable review controls.

The focused regression files cover private CV behavior, application paging and late-response handling, order idempotency/account fencing, reviews/reports, native applicant self-service, marketplace refresh, Jobs parity, and save rollback. Isolated test adapters were updated for the new CSS/navigation imports and review boundaries; their authorization, retry, pagination and duplicate-request assertions were retained.

Strict ESLint on the 18 scoped modules reports **8 existing errors and 13 warnings**. The comparison against the branch baseline contains no newly introduced errors; it is not a clean-lint claim. Warnings concern deliberate generation-counter cleanup and direct media image elements. The final full-package typechecks and regression inventory are recorded separately in `docs/quality/design-completion-20261030/`.

## Acceptance limits

This evidence does not validate real external job submissions, employer hiring decisions, seller fulfilment, charges, settlement, shipping services, or hosted moderation outcomes. Production privacy/cache revocation/erasure, real iPhone media and gesture behavior, real business Auth provisioning, other external providers, and TestFlight acceptance remain separate requirements. No hosted account, database, Storage object, payment, production setting, or release was changed by this UI verification.
