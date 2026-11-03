# Live release: web, native and admin

## Release status

This change supplies the Live directory/player/studio, clipping, private clip
publication, social export paths, creator/staff controls and interactive Live
features. Runtime gates remain off until the media infrastructure is configured
and measured. The production database differs from QA; the portable migration
preserves the deployed account systems and consults stronger QA guards when
those systems are installed.

The reviewed four-unit release applied to QA as
`20261103004440_live_completion_reviewed_release_20261103`. Hosted checks
confirmed private tables and storage, service-only worker permissions and
disabled provider/encoder admission. All eleven Edge functions are active in QA;
eleven hosted startup/authentication checks and fourteen rollback-only hosted
database checks passed. No synthetic accounts or streams remain. The initial earlier confirmation expired
without applying anything. Do not describe a source commit or local browser
fixture as a production rollout.

## Database order

1. `20261103000609_live_portable_control_plane.sql`
2. `20261103002857_live_clips_and_distribution.sql`
3. `20261103002858_live_interactivity.sql`
4. `20261103002832_live_clip_content_delivery.sql`
5. `20261103004609_live_foreign_key_indexes.sql`
6. `20261103005625_live_retained_relationship_indexes.sql`

The generated `release.sql` wraps the listed units in one transaction. First apply
it to QA, verify the hosted permission tests and then repeat the inspected
production preflight. Do not push unrelated historical QA migrations into
production. The recovered QA originals are preserved under
`supabase/reference/live-qa-recovered/` for traceability.

The content delivery extension preserves the previous manifest and ticket
implementations under private Live-owned functions. Existing posts continue
through those implementations. New clip references require exact publication
provenance and both source and destination authorization. Private canonical
object references are never public Storage access grants.

## Edge functions

Deploy `live-stage`, `live-control`, `live-playback`,
`live-provider-webhook`, `live-cover`, `live-maintenance`, `live-sign`,
`live-clip-media`, and `live-clip-worker`, plus the updated
`content-media-sign` and `media-content` functions and their local dependencies.
These endpoints authenticate in their handlers: verified user/session RPCs,
signed Daily webhook events, a single-use maintenance tick, or a scoped
server/worker credential. Gateway JWT verification therefore stays off for
these handlers as it already did in QA; this does not make their operations
anonymous.

## Infrastructure acceptance

Daily HLS needs the customer's S3 bucket and a CDN. The supplied CloudFormation
template creates private storage, a scoped Daily role and authorization before
CloudFront cache access. It has not been deployed to AWS here. Required provider
values are documented in `infrastructure/live/README.md`.

The renderer container and scoped Edge broker are supplied. The production
worker service, scheduler, credentials, regional limits, budgets and storage
retention need actual operational configuration and acceptance. Test:

- A real host camera/microphone broadcast and co-host/source switching.
- Screen/game sharing, disconnect recovery and confirmed provider stop.
- Private viewer revocation and token expiry across every HLS child request.
- A clip created during the broadcast and another from its completed replay.
- Actual persisted video/captions/cover, all internal publication destinations,
  delayed publication, retry and cleanup after an expired signed upload.
- Real iOS/Android camera, screen capture, audio handoff and Picture in Picture.

Native configuration is in source. TestFlight and app-store distribution remain
held. Local type checks and Expo configuration introspection do not establish
device runtime acceptance.

## Capacity target

Five million registered users is the product target. It is not a measured
concurrent-viewer claim. The illustrative scenario in
`tools/performance/live-five-million-scenario.json` uses 50,000 concurrent
viewers, 500 simultaneous broadcasts and 60 clip requests per minute.

At the stated 1.8 Mbps average bitrate, that scenario implies 90 Gbps of viewer
video, or 180 Gbps with the selected two-times reservation. HLS goes through a
CDN and viewers never join the private production room. Stage participant
counts, chat rate, page sizes, retained messages and renderer concurrency are
bounded independently. These are planning calculations, not load results.

Clips use the existing revocable private media path. Its sustained regional
throughput, clip-download behavior, worker queue age and CDN hit rates must be
measured alongside live HLS. Do not certify the full platform from a stream
provider's headline capacity. The capacity evidence checker rejects an empty
receipt and requires measured workload, soak, playback, reconnection, recovery,
revocation and budget evidence.

Paid gifts remain deferred. Subtitles support manual editing and WebVTT import;
automatic speech transcription is not configured. Platform settings show actual
connection availability and export history; no OAuth account or external post
success is fabricated.

## Rollback references

Last verified production web deployment before this change:
`dpl_GvmnuoLPJEArpeABW6GxK29gmcjv`, commit
`d393bbb44382a84f0014f833e58cbbdeaaa6181b`.

Last verified production admin deployment before this change:
`dpl_DncqiTY9TZBCddGg21KYjiov1tgJ`, commit
`69097b41936a685f56d6e6302f9450b6c7cd6187`.

A frontend rollback does not remove the additive data. Disable new provider
admission and encoder admission before investigating a Live incident; retain
outbox/cleanup workers so accepted stops and deletion jobs can complete.
