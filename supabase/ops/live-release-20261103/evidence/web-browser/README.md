# Local web browser verification

These files document a local fixture run of the actual Platinum Circles web components. The browser used synthetic authorized API responses and locally generated HLS/MP4 test footage. Screenshots, names, counts, timestamps and account state are fixture data.

**This is not hosted-provider, production-deployment, external-social-publication or capacity evidence.** No production broadcast, social post, account connection or load test is represented by these files. Browser Picture in Picture and actual Daily camera/room operation require separate verification on supported devices and a configured provider.

## Result

The receipt records 13 successful browser flows, no browser JavaScript errors, and no test failure. It covers responsive directory filters; persistent HLS playback and minimize/expand; bounded chat; poll votes and no-read broadcast counters; Q and A; chapter markers; measured versus unavailable analytics; creator clip settings; idempotent clip creation; publication confirmation and keyboard focus trapping; signed MP4 playback; file export history; platform connection state; and signout cleanup.

The fixture intentionally reports disconnected social accounts and export-required history. It does not claim that a device handoff published a video on another platform.

## Files

- `receipt.json`: checks and scope recorded by the test runner.
- `live-directory.png`: directory and topic controls.
- `clip-publication.png`: publication dialog using the fixture backend confirmation.
- `live-clip-view.png`: authorized clip viewer with local video test footage.
- `live-platform-settings.png`: disconnected platforms and fixture export history.
- `live-library-final.png`: private content cleared after fixture signout.

## Reproduction

Run `node web/tests/browser/live-run.cjs` from the repository root after dependencies are installed. The runner requires FFmpeg and Chromium; `PLATINUM_CHROMIUM` may point to a compatible installed Chromium executable. `LIVE_BROWSER_EVIDENCE` may set a different evidence directory. The test compiles the real components with the explicit local backend adapter in `web/tests/browser/live-backend.ts`.

Separate source checks passed: 28 Live runtime/contract/media checks, 23 directory/search checks, and 11 existing social-page checks. Web TypeScript verification passed. These source checks also do not establish hosted provider readiness or production capacity.

## Production compilation

`production-build.json` records a successful full Next.js 16.4.3 Turbopack production build. Compilation, TypeScript and all 93 static-generation tasks completed, and every new Live route appears in the route manifest. The command used an explicit temporary synthetic public key for build validation; no credential file was created. This is compilation evidence, not deployment or hosted service verification.

The restricted runner could not connect to its configured proxy for the existing Google font downloads. That process was stopped and the same source passed with permitted network access. Existing nonblocking Edge Runtime and npm proxy-configuration warnings are recorded in the JSON result.
