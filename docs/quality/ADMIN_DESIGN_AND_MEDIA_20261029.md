# Platinum Circles admin design and secure media review

## Implemented in the quality branch

The admin now uses a consistent operations layout: a stable left navigation rail, restrained blue actions, aligned page headings, white/light-gray surfaces, readable navy text, and a matching dark palette. The supplied reference images were unofficial sample-data concepts. Their layout principles informed this work; no Meta branding, fabricated operational data, or claim of equivalence to Meta's internal system is included in the product.

The shared layout applies to the dashboard, analytics, audit, calls, posts, jobs, market, payments, verification queue, staff, stories, support and users. It keeps existing server permissions and real data sources. The review fixture deliberately uses synthetic records and labels them visibly; it is outside the application routes.

### Navigation and review behavior

- Desktop navigation supports a compact rail while preserving route labels. Mobile uses a modal drawer and does not reserve a permanent icon rail.
- Navigation pins, collapsed groups and recent destinations reject corrupt stored preferences and are filtered by the current role.
- Search respects the actual permitted destinations. A role without the users desk cannot receive a member-search shortcut. Keyboard shortcuts ignore editable controls.
- Both dialogs trap focus, close with Escape and restore focus. The mobile drawer closes after navigation and restores page scrolling.
- Unknown queue counts remain unavailable rather than appearing as zero.
- Review tables support case-insensitive search, filters, real numeric sorting where declared, rows-per-page selection, keyboard row selection and explicit pagination.
- The selected record always belongs to the current page and filter. Switching records remounts the action form so another person's review reason or receipt cannot carry across.
- Detail navigation, close controls, visible form labels and review guidance are consistent. Verification decisions request a 20–2,000-character basis; the server remains authoritative.
- Charts expose their underlying values in an accessible table and provide labeled range and series controls. A dataset refresh cannot leave a hover index outside the current series.

### Admin media authorization

Private post/story previews now use a same-origin authenticated byte route at `/api/moderation-media`. They do not issue browser-visible signed Storage capabilities or fall back to historical public URLs for the three content buckets.

The server obtains a bounded, service-only SQL manifest for the requested live post/story IDs. Its SQL checks the current media reference and matching uploader/object ownership, or an exact approved legacy snapshot. The configured Supabase origin is supplied by server configuration, never by a browser parameter. The array result is bounded explicitly, avoiding the REST table row cap and silent partial results.

Every image/video read, including a range or HEAD request, checks the actual Auth session, staff role, operations assurance and moderation permission. It checks the exact Storage object ID/version before and after retrieving headers and checks the staff session again before forwarding bytes. Deletion, replacement, revocation or backend uncertainty fails closed. The request forwards only to the configured Storage origin, refuses redirects, validates a single byte range, supports caller cancellation and uses a per-read cache nonce. Browser/CDN responses are marked `no-store`; Storage cache headers, signed URLs, ETags and server secrets are not forwarded. Unsafe inline HTML/SVG/document responses are rejected.

This route depends on the origin-pinned admin manifest/object helper functions in `20261029231440_bounded_media_delivery.sql`. It is not a claim that public production buckets have already been made private.

## Observed verification

- Admin TypeScript passes after the design and authenticated-media changes.
- All 15 top-level admin regression test files pass, including the new byte-route suite and updated media-manifest suite. This count describes test files, not individual cases.
- The real shared components passed 17 Chrome browser interaction checks with zero captured runtime errors.
- Desktop light, desktop dark and 390-pixel mobile screenshots were rendered and inspected.
- `git diff --check` passed at the checkpoint.

The browser fixture tests actual production components with a navigation adapter and synthetic data. It is not an authenticated hosted staff walkthrough. The complete list and screenshots are in `admin-ui-20261029/browser-receipt.json` and the same directory's PNG files.

Reproduce the fixture with:

```sh
node admin-web/tests/browser/compile.cjs
PLATINUM_CHROMIUM=/path/to/chrome node admin-web/tests/browser/run.cjs
```

The fixture uses the existing web Playwright dependency and an official Chrome for Testing installation. No live account, member action, support reply, provider provisioning or deletion is performed.

## QA deployment recovery

The existing QA Supabase project is SQL-accessible even though its management lookup returned 404. Its existing accounts and stored objects were preserved. The previously configured web/admin preview environment entries were scoped to `codex/app-quality-20261029`; the existing sensitive service setting stayed in Vercel and was not decrypted or copied.

Both redeploys of the previously published `b2e261332ea449a19c19a128e8ec3b50ce032a2e` source reached READY:

- Web: `dpl_1QiWTVWEeUpmyomzaTHpVpgA89LT`.
- Admin: `dpl_EGqDUverLB7ciECNr2cRCXg8RiDN`.

The admin preview was opened in the browser and displayed its QA staff sign-in page. This resolves the configuration/build blocker; it does not verify staff journeys or show the new uncommitted design. The final source publication and QA-specific database upgrade must be identified separately in the release receipt.

## Remaining acceptance boundaries

Authenticated hosted staff workflows, real provider reserve/create/finish, mobile device interactions and the final private-bucket cutover remain separate gates. No TestFlight submission, EAS build or IPA archive occurred. This work does not justify a zero-defect claim or a self-assigned 10/10 rating.
