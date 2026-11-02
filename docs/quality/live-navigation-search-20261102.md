# Live navigation and recent search release, 2 November 2026

## Scope

Payments and paid gifts are deferred. This changes the visible cloud frontend and prepares corresponding native navigation/search source. It does not submit a native build, upload to App Store Connect, distribute TestFlight, activate payments, or certify five-million-user capacity.

The previous production/source branch did not contain an audience-facing Live directory. Installing QA SQL and Edge workers did not update frontend navigation. The new Live destination does not depend on a broadcast feature flag merely to appear.

## Implemented

- Accessible broadcast/play icon immediately after Trending in the home feed, including narrow web layouts and the native feed source. Existing phone bottom navigation stays unchanged.
- Web `/live` route with relationship filters, topic filters including news, politics, business, IRL, gaming and concerts, and distinct live/upcoming/replay states.
- Bounded real directory reads of 24 records, a maximum of 96 retained cards, a manual refresh, no polling loop, and current-account response guards.
- Actual stream metadata reads and capability-checked draft creation. When the production backend is not installed/connected, the UI says that explicitly rather than fabricating broadcasts, viewers, or working controls.
- Account-scoped recent search terms in the global web search dropdown and search page, with repeat selection, individual deletion, Clear all, filtering, reload persistence, keyboard navigation, Escape dismissal, and small-screen touch targets.
- A shared serialized history store caps history at 20 entries, normalizes inputs, handles corrupt/blocked storage and rejects stale account results. New timestamped entries expire after 30 days. Existing legacy text entries are accepted for compatibility. History is device-local, not cross-device synchronization.
- Corresponding native source uses account-scoped history and a Live directory entry. Native stream details open the labeled web destination for now. No native playback or device runtime acceptance is claimed.

## Verification observed

- Complete web regression run: 803 passed, 0 failed, 0 skipped.
- Focused Live/history tests: 23 passed. They are included in the complete count, not additional independent tests.
- Targeted feed, navigation, profile-link and CV regressions: 104 passed.
- Native and web TypeScript checks: passed.
- Next production compilation/prerender: passed with local fixture configuration. Cloud deployment must use the project's existing real environment.
- Chromium tested the actual TopBar, history hook/store/list and Live directory components against a local mock identity and empty directory API boundary. This is component acceptance, not an authenticated hosted-user test or video-provider acceptance.
- Browser checks cover submit, ordering, persistence, arrow keys, Escape, filtering, removal, clear, account switching and restoration, icon ordering, touch target size and page overflow at 320, 390, 768 and 1440 pixels. No page JavaScript errors.
- A browser-found Escape/refocus issue was fixed before the successful browser rerun.

## Deliberately not claimed

The approved seven-board live-production system is larger than this release. Provider ingest, real live playback, production studio, captions, recording publication, multistream production, OS Picture in Picture, production moderation and large-audience load verification are not completed by adding these routes. Provider configuration remains a separate prerequisite. The UI does not advertise a usable live player where none is connected. Paid gifts remain excluded.

No TestFlight build, upload or submission is part of this release. Native code changes require a later separately authorized distribution. Production deployment readiness and canonical-domain checks are recorded by the Vercel deployment and release response.
