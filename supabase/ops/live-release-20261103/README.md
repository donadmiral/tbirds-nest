# Live release: web, native and admin

## Release status

The Live web and admin applications, the six-unit database release, and all
eleven Live/media Edge functions have been deployed to production. Live creation
and chat are enabled. Broadcasting, HLS delivery, recording and clip encoding
remain disabled until the provider, AWS delivery infrastructure, signing
configuration and renderer have passed operational acceptance.

This release implements the directory, player and studio; clip editing and
private media publication; device export and social sharing paths; creator and
staff controls; and polls, Q and A, chapters and analytics interfaces. Deployed
code and available UI controls do not establish a successful live broadcast,
external social publication, device acceptance or measured capacity.

The rollout record below is the release operator's verified state on
**2026-11-03**, with production endpoint checks completed at
**01:05:16.420 UTC**. The production endpoint receipt is stored alongside this
document. The [production web/admin receipt](evidence/production-web-admin.json)
separately verifies the custom-domain deployment aliases, HTTP 200 responses from
the Live directory and clip library, and the admin API's HTTP 401 JSON response
with private/no-store caching. These results are not inferred from Vercel's
`READY` status or local browser fixtures.

## Source and deployment identity

| Item | Recorded identity |
|---|---|
| Runtime commit | `2e265ef0915ed83cbf5ba79f22f3ea1f1a717d8d` |
| Runtime tree | `5815da01e4f8ddfeb40c034dacbc6f5397686c66` |
| Review | [Pull request 7](https://github.com/donadmiral/tbirds-nest/pull/7) |
| Production database project | `prlkikhckbifseosbukl` |
| QA database project | `uaulhuelcfkjwojtymmw` |
| Production atomic migration | `20261103010232_live_completion_reviewed_release_20261103` |
| Production release SQL SHA-256 | `4505fbe62f71d72980f6aa55f688562e9430305317c343f1aa92567007e09313` |

The commit and tree above identify the deployed application source. Documentation
or subsequent test corrections may be committed later without changing that
deployment identity. The release SQL hash matches both the local `release.sql`
and the [source manifest](source-manifest.json).

| Target | Deployment ID | State and routing |
|---|---|---|
| Production web | `dpl_Ds9RKyzPNXqnNSziBWFeC9DwPZcc` | `READY`; [platinumcircles.app](https://platinumcircles.app) and [www.platinumcircles.app](https://www.platinumcircles.app) |
| Production admin | `dpl_HtFDqKMNyCJ5KJan7hBMMzea6ZkK` | `READY`; [admin.platinumcircles.app](https://admin.platinumcircles.app) |
| QA web | `dpl_D8UhBRh7GucCtBi7GS1csUEA7cCf` | `READY`; QA environment variables |
| QA admin | `dpl_83C9egzzUJ1JcsbQnmd264UrJ1ag` | `READY`; QA environment variables |

Both production applications were built from the exact runtime commit recorded
above. The deployed web includes the Live entry beside Trending and the Live
directory, studio, clip library and settings routes.

The [real public-browser receipt](evidence/production-web-readonly.json) records
six passing signed-out checks, including visible Live text and a broadcast icon
immediately after Trending, all requested directory filters, clip-library sign-in
state, Home's authentication redirect, and zero fatal JavaScript errors. It
records the browser trust-store workaround separately from successful system TLS
verification. No API mocks, synthetic authentication or user writes were used.
A separate read of 17 deployed client scripts found the production Supabase
hostname and no QA hostname; no authenticated database call was implied.

## Hosted verification

### Database and worker checks

QA received all six migration units. Its original four-unit reviewed release was
`20261103004440_live_completion_reviewed_release_20261103`; the twelve foreign
key indexes and two retained-relationship indexes were applied afterward. The
production migration applied the complete six-unit release atomically.

The hosted QA run passed **14 rollback-only database checks**. These exercised
permissions and lifecycle behavior within rolled-back test transactions; no
synthetic accounts or streams were retained. See [QA hosted
evidence](evidence/qa-hosted.json) and the [acceptance SQL](qa-acceptance.sql).

The [production backend receipt](evidence/production-backend.json) records the
applied migration, feature gates, function versions and source hashes, maintenance
result, and provider configuration presence. Its postflight recorded:

- Zero Live tables with missing RLS protection.
- No authenticated-user grant to the worker-claim RPC and no anonymous grant to
  `live_clip_get`.
- A private `live-clips` Storage bucket.
- Zero missing Live foreign key indexes after the fourteen index additions.
- No Live `ERROR` or `WARN` findings in the security and performance advisors.

Maintenance is enabled. Tick **10487** completed at **01:04:42 UTC** with HTTP
**200** and `worker_ok: true`. This proves that the configured maintenance path
ran; it does not prove that Daily broadcast provisioning, HLS delivery or the
separate clip-renderer service is operational.

### Edge functions and endpoint checks

All eleven functions are `ACTIVE` in both QA and production:

`live-stage`, `live-control`, `live-playback`, `live-provider-webhook`,
`live-cover`, `live-maintenance`, `live-sign`, `live-clip-media`,
`live-clip-worker`, `content-media-sign`, and `media-content`.

The hosted startup/authentication checks passed **11 of 11 in QA** and **11 of
11 in production**. The checks confirmed expected unauthenticated rejection and
private/no-store caching. Most endpoints returned 401; `media-content` returned
the expected 403 for unavailable unauthorized media. Receipts:

- [QA endpoint checks](evidence/qa-endpoints.json), at 00:56:07.517 UTC.
- [Production endpoint checks](evidence/production-endpoints.json), at
  01:05:16.420 UTC.

These checks did not use a real camera broadcast or establish successful
authenticated playback, social posting or load capacity. The endpoints perform
authentication in their handlers through verified user/session RPCs, signed
Daily webhook events, a single-use maintenance tick, or a scoped server/worker
credential. Gateway JWT verification remains off for these handlers as designed;
anonymous requests do not gain access to the protected operations.

## Current feature gates

| Capability | Production state |
|---|---|
| Live creation | Enabled |
| Live chat | Enabled |
| Maintenance | Enabled; successful tick recorded above |
| Stage/broadcast admission | Disabled |
| HLS audience delivery | Disabled |
| Recording | Disabled |
| Private broadcasts | Disabled |
| Reminders | Disabled |
| Clip encoding admission | Disabled |
| Configured renderer concurrency when enabled | Two active jobs across the fleet |
| Paid gifts | Disabled and deferred |

The encoder gate is separate from the deployed `live-clip-worker` Edge broker.
Publishing and signing code being present does not mean that an external encoder
container or its scheduler has been deployed. Existing authorized asset access
is independent of the new-render admission gate.

## Database order and release boundaries

1. `20261103000609_live_portable_control_plane.sql`
2. `20261103002857_live_clips_and_distribution.sql`
3. `20261103002858_live_interactivity.sql`
4. `20261103002832_live_clip_content_delivery.sql`
5. `20261103004609_live_foreign_key_indexes.sql`
6. `20261103005625_live_retained_relationship_indexes.sql`

The generated [release.sql](release.sql) wraps these units in one transaction in
the inspected dependency order. The production and QA account systems differ;
the portable migration preserves the deployed production account systems and
consults stronger QA guards where those systems are installed. The original QA
SQL remains under `supabase/reference/live-qa-recovered/` for traceability.
Unrelated historical QA migrations were not included in this production release.

The content delivery extension preserves the previous manifest and ticket
implementations under private Live-owned functions. Existing posts continue
through those implementations. New clip references require exact publication
provenance and current source and destination authorization. Canonical object
references for private clips are durable identifiers; they do not grant public
Storage access.

## Local source and fixture evidence

| Receipt | What it establishes | Remaining boundary |
|---|---|---|
| [Backend and worker](evidence/backend-worker.json) | 81 passing assertions across disposable database fixtures, Edge handlers, source authorization, actual FFmpeg rendering and decoding, worker leases, cleanup, signed uploads and local HTTP startup; all 11 Edge entrypoints passed Deno 2.1.4 checking | No deployed provider broadcast, Docker build or measured capacity |
| [Native and admin](evidence/native-admin.json) | Passing TypeScript checks, 79 local assertions, admin production compilation and Expo configuration introspection | No native binary or physical-device acceptance; overlapping database checks must not be counted twice |
| [Web browser](evidence/web-browser/README.md) | 13 passing flows in actual web components using synthetic authorized API responses and locally generated HLS/MP4 footage; separate source checks and successful production compilation | Fixture names, counters, accounts and publication responses are not hosted user or provider evidence |

The renderer test creates real encoded video, decodes both orientations, and
checks duration, dimensions, audio, fast-start MP4 metadata, captions and the
selected cover. The HTTP tests exercise a real local process using synthetic
credentials, including authenticated admission and SIGTERM shutdown. These are
useful implementation checks, with narrower scope than production acceptance.

The initial hosted quality and browser runs did not fully pass. Four narrow
test/CI issues were identified: a missing recent-search hook mock, a timestamp
fixture exceeding its exact lifetime bound, an uninstalled existing worker SDK,
and a synthetic router emitting browser-history events on link pushes. The
[correction receipt](evidence/ci-fixture-corrections.json) and
[router evidence](evidence/browser-router-fixture/receipt.json) record focused
passing verification. The original navigation assertions were preserved;
117 sampled Home/Messages frames had no blank content, and actual Back/Forward
used trusted browser history events. Deployed runtime source is unchanged.

Follow-up hosted CI and native app binary acceptance remain pending in this
release record. The initial Live browser step and iOS/Android encoder simulator
checks passed. A local type check or Expo configuration inspection does not
establish a green full hosted CI run, a successful app binary or working
camera/screen capture on a phone. No TestFlight, App Store, Play Store or device
distribution was performed; distribution remains held.

## Activation blockers and acceptance

Production has `DAILY_API_KEY`. The provider configuration inspection reported
these eight values absent:

- `LIVE_HLS_BUCKET`
- `LIVE_HLS_REGION`
- `LIVE_HLS_CDN_ORIGIN`
- `LIVE_DAILY_DOMAIN_ID`
- `LIVE_HLS_ASSUME_ROLE_ARN`
- `LIVE_PLAYBACK_SIGNER_URL`
- `LIVE_DAILY_WEBHOOK_SECRET`
- `LIVE_PLAYBACK_SIGNER_SECRET`

The AWS delivery stack, operational CDN signing configuration, and renderer
service have not been deployed or connected. The `live-sign` Edge code is
`ACTIVE`, but its presence does not supply the missing signer credentials,
CloudFront key store or CDN delivery configuration. The [infrastructure
runbook](../../../infrastructure/live/README.md) specifies the AWS resources,
signing key and provider setup. The [renderer
runbook](../../../workers/live-clips/README.md) specifies the scoped broker
credential, scheduler, runtime limits and activation RPC. Secret values and URL
bearer capabilities must not be added to these release artifacts.

After those services are configured, acceptance must establish:

- A real host camera/microphone broadcast, co-host/source switching, screen/game
  sharing, disconnect recovery and confirmed provider stop.
- Protected HLS master, variant and segment delivery with actual Daily output;
  private viewer revocation and expiry must hold across child requests.
- A clip created while broadcasting and another from the finalized replay,
  with verified persisted video, reviewed captions and selected cover.
- Real feed, story, channel, community and replay-highlight publication;
  scheduled publication, retry, revocation, and cleanup after upload expiry.
- Physical iOS and Android capture, permission recovery, audio handoff,
  background playback, Picture in Picture and screen-capture extensions.

Keep provider and encoder admission disabled until their respective acceptance
checks pass. Enabling the database gate does not provision missing services.
Retain operational queue, retry, retention and budget monitoring when admission
is enabled.

External platform OAuth accounts and direct automated posting are not connected.
The implemented flows use link intents or clean device video export and record
`export_required` where applicable. A file export or share-sheet handoff does
not confirm a post on X, Facebook, Instagram, YouTube Shorts or TikTok. Automatic
speech transcription is also not connected; manual subtitle editing, WebVTT
import and review are implemented. Paid gifts remain deferred.

## Capacity target

Five million or more registered users is the product target. No five-million-user
load certification or concurrent-viewer capacity claim is made by this release.
The illustrative scenario in
`tools/performance/live-five-million-scenario.json` uses 50,000 concurrent
viewers, 500 simultaneous broadcasts and 60 clip requests per minute.

At the stated average of 1.8 Mbps per viewer, that scenario implies 90 Gbps of
video delivery, or 180 Gbps with the selected two-times reservation. These are
planning calculations. HLS goes through a CDN and audience members never join
the private production room. Stage participants, chat rate, page sizes, retained
messages and renderer concurrency are bounded independently; those design
limits do not establish measured throughput.

The revocable private clip-delivery path must be measured alongside live HLS:
regional throughput, playback quality, queue age, CDN cache behavior, expiry,
revocation, failure recovery and costs all matter. The capacity evidence checker
rejects an empty receipt and requires measured workload, regional and soak
results, playback/reconnection, recovery, authorization and budget evidence.

## Rollback references

Previous verified production web deployment:
`dpl_GvmnuoLPJEArpeABW6GxK29gmcjv`, commit
`d393bbb44382a84f0014f833e58cbbdeaaa6181b`.

Previous verified production admin deployment:
`dpl_DncqiTY9TZBCddGg21KYjiov1tgJ`, commit
`69097b41936a685f56d6e6302f9450b6c7cd6187`.

A frontend rollback does not remove the additive database state. Disable new
provider and encoder admission when investigating a Live incident; retain
outbox and cleanup processing so accepted stop requests and deletion jobs can
complete. Preserve the release SQL hash, deployment identities and receipts when
recording any rollback or later activation.
