# Loading foundation release, 2026-11-05

## Scope

This release extends the performance work recorded in PR 7. It adds bounded encrypted startup snapshots, small image previews, refresh continuity, server-prepared feed pages, and adaptive video admission and delivery. It does not certify five million daily users, guarantee immediate first-time network downloads, or persist every private page offline.

## Client behavior

- Native startup restores account-bound feed, ordinary inbox, notifications and eligible unexpired story-tray metadata. A bounded local hydration window never waits for network success. Background reads reconcile the retained content.
- Sensitive, disappearing, expired and denied content is excluded or removed. Account changes and logout invalidate and purge incompatible cached data.
- Up to three eligible public-feed JPEG previews are stored encrypted. Full-resolution media continues through the authorized delivery path. Offline full-resolution video is not implemented.
- Web uses non-extractable AES-GCM keys and encrypted IndexedDB previews. Seven account-resource consumers gain bounded session-memory reuse with request deduplication and mutation fencing.
- Feed refresh retains displayed rows. Expired server snapshot cursors restart the head read once while preserving the visible list and scroll state.
- Existing operations views remain server-authoritative. Staff permissions, financial records and moderation decisions are not persisted in member caches.

## Server behavior

Prepared feed snapshots store ordered IDs and ranking keys, then hydrate every response under current visibility rules. Session and revision binding, bounded retention, worker claims, queue limits and fallback preserve authorization and recovery. The first uncached request may still run canonical ranking.

The deterministic author-score tie fix is deployed to QA and production. It retains existing marketplace exclusions and visibility rules while avoiding the prior full-scan fallback for legitimate equal scores. See tie-deployment.json.

Adaptive video workers process supported canonical uploads into HLS variants, posters and segments. Delivery uses short-lived capabilities, current authorization and source-version fencing. Unsupported or pending sources retain the existing original-media fallback.

## Evidence and release boundaries

- web-admin-loading.md inventories all 105 member web and 35 operations routes. It distinguishes source review from rendered timing and cold-only pages.
- web-verification.json records focused tests and the actual browser-process restart, encrypted preview restoration, CORS rejection and logout tests.
- hosted-hls-qa.json records one hosted HLS playlist, variant and segment, independent decode and invalid-ticket rejection.
- tools/performance/measurements retains successful probes and failed measurements rather than replacing failures with later claims.

## Released source and configuration

The web and media-worker application release is `6f26e5f26210bf9d5cffdc7a0d2c9df9c3bdc019`. Its six Type and quality jobs passed in run [41973870205](https://github.com/donadmiral/tbirds-nest/actions/runs/41973870205). The final browser suite passed in [41972966503](https://github.com/donadmiral/tbirds-nest/actions/runs/41972966503); its browser application source is identical to the deployed release.

The additional database optimization is `2e62dd9599c3989d19924049972855684bf935f5`. It changes when the existing exact frontier is scored, retaining the same visibility rules, score formula, cursor order and page limit. It does not change the mobile or web application package.

| Component | Released state |
| --- | --- |
| Member web | `dpl_f2Wg85SixLDdTDg1Q9psUZ3Z1Dpi`, READY at https://platinumcircles.app |
| Production media worker | `dpl_6ZsyATGJH31JvsaeMrdTg8vrY7p1`, READY |
| QA media worker | `dpl_Dx8n3gA9HwwjAp6LqqWAjH4ogPEi`, READY at its stable QA alias |
| Prepared and indexed feeds | Enabled in QA and production after authenticated rollback canaries and isolated PostgreSQL load gates |
| Feed background worker | One snapshot per pass, every 10 seconds, eight-second statement deadline |
| Worker history | Own-job records older than seven days removed in bounded daily batches |
| Admin | Existing release retained. No admin source or dependency changes. Current component/browser and quality gates passed |
| iPhone package | Build workflow [41973870173](https://github.com/donadmiral/tbirds-nest/actions/runs/41973870173), final artifact receipt pending |

The worker has no login permission and cannot bypass RLS. Real scheduled processing was observed in both environments. The next authenticated request used prepared cursors. See scheduled-feed-rollout.json. The activation and rollback SQL are recorded under supabase/ops/prepared-feed-staged-20261105.

## Measured results

The final PostgreSQL 17 run [41974292820](https://github.com/donadmiral/tbirds-nest/actions/runs/41974292820) passed on the final database source. Its isolated fixture contained 25,018 posts and 16 authenticated actors. All 1,200 scheduled feed reads completed without errors. Prepared service-time p95 was 9.21 ms at 20 reads/second and 11.08 ms during the 60-second, 10 reads/second soak. Eight simultaneous reconnects completed in 147 ms without cross-account rows. Current-access revocation and reads during worker locks passed. Full receipts, resource limits and failed earlier attempts remain under tools/performance/measurements.

Hosted production measurements are separate: the original point-fixed cold canary took 5,012.51 ms, then 1,094.61 ms after amortized scoring. A later first scheduled-worker request took 1,684.50 ms and its prepared read took 529.81 ms. These small-dataset database measurements exclude client/network time and are not the isolated test's 9-11 ms figures.

All eight eligible production canonical videos are ready. QA has eleven ready jobs, including its earlier acceptance video, and three historical cancelled jobs. The variable-frame-rate clip advertised a 600 fps timing rate but averaged 22.26 fps. The parser now uses its finite positive average rate, retaining input and output frame-work limits. That original clip was reprocessed successfully. Its production master, variant and segment returned 200, FFmpeg decoded the downloaded segment, and an invalid access ticket returned 403. All 51 worker tests passed.

Public HTTP checks returned 200 for the selected web entry routes, admin entry and QA worker health. No error/fatal runtime log groups were returned for the new production web and media-worker deployments in the checked 15-minute window. These checks supplement the synthetic browser suite; they do not prove every authenticated hosted journey or regional playback latency.

## Remaining boundaries

- Startup persistence is bounded and selective. Three low-resolution public previews do not make every full-resolution photo, video, private route or admin page available offline.
- The implementation uses the existing native storage stack. It does not add MMKV, a universal native entity store, or a generic offline replay queue for every write.
- HLS covers eligible bound post/story videos. Unbound uploads, private chat attachments and custom composition/export pipelines retain their existing paths. Readiness discovery keeps the original-media fallback.
- First-ever launch, expired media authorization and first-time downloads still need the network. The cold HTTP HLS probe was functional evidence, not a subsecond regional playback benchmark.
- The bounded load gate is not five-million-DAU certification. Regional HTTP/media load, a day-long soak, representative fanout/reconnect bursts, production quotas and an approved operating budget at that scale remain open.
- Physical iPhone/Android acceptance of the new package remains distinct from the passing build, TypeScript, database and browser checks.
