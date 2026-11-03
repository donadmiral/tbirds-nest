# Live release: web, native and admin

## Release status

**Latest access checkpoint, 2026-11-03 UTC:** AWS advanced-feature activation
is complete and the AWS connector is authenticated. STS verified **project
account `518317808503`**, role `AccountFullAccessRole`. `DescribeOrganization`
succeeded for organization `o-u8vc1j1p9n`, confirming Management Account
`481552727043` and feature set `ALL`. However, `ListPoliciesForTarget` for
project account `518317808503`, filter `RESOURCE_CONTROL_POLICY`, returned
`AccessDeniedException`. Organization policy contents remain unread and
unchanged; the current project session does not provide the required inspection
access.

**Reconnect the AWS app and select Management Account `481552727043`, rather
than project account `518317808503`.** Verify that resulting identity before
policy inspection. The earlier reauthentication failure and its
[Site Unavailable screenshot](evidence/aws-toolkit-reauthentication-required.jpg)
are historical evidence, superseded by the successful project-account
connection. They do not describe the current connector state.

The post-activation Daily storage probe
`b3ec6b27-ec02-4b15-9a17-4036794f6577` (request `11490`) still failed at
**16:08:53.024926 UTC** with HTTP 400, `STORAGE_VERIFICATION_FAILED`, classified
`role_assumption_denied`; temporary-room cleanup was confirmed. Activation has
not established Daily access or identified the denying policy. Production
renderer admission remains enabled and broadcast admission disabled. All **28
fixture cleanup targets are now done**, with **0 remaining targets and 0
retained output objects**; this supersedes the earlier pending-cleanup state.
See the [post-activation access receipt](evidence/live-daily-post-activation-access.json).

**Renderer operational checkpoint, 2026-11-03 08:37:41.752 UTC:** the real
production worker completed the isolated two-second clip through the broker,
database lease and private Storage path. The clip is `ready`, its job is `done`
with no error, and all four current-lease assets are stored: both video
orientations, the selected thumbnail and reviewed captions. Total output is
**86,367 bytes**; the worker reported **6,625 ms**. No publication was created.
The service and launcher stacks are `UPDATE_COMPLETE`, the one-minute schedule
is **ENABLED**, and clip admission permits at most **two active jobs**. The
accepted task stopped with exit code **0** at **08:39:00.858 UTC**, and the
scheduler automatically settled its ledger to idle. The service is `ACTIVE`
with desired/running/pending counts **0**; finite tasks start on demand.
See the [production runtime acceptance](evidence/live-renderer-runtime-acceptance.json),
[image acceptance](../../../infrastructure/live-clips/operations/renderer-image-acceptance.json)
and [operations status](../../../infrastructure/live-clips/operations/quick-deployment.md).

The [07:37–07:47 quick attempt](evidence/live-quick-fix-attempt.json) and
[Daily role review](evidence/live-daily-quick-role-review.json) remain historical
receipts. Their failed-image and unprovisioned-renderer states are superseded
by the later evidence above. Advanced activation and project-account
authentication are complete; a management-account connection and actual policy
inspection remain outstanding. No successful Daily broadcast is claimed.

The existing web/admin fundamentals are available for the owner to test.
The optional database foundation and six additional Edge endpoints are deployed
in QA and production, with their provider admissions closed. The optional web
screens have passed local production compilation but have not been recorded as
released on the canonical domain. This renderer follow-up does not establish
automatic transcription, OAuth publishing, native-device acceptance or a new
web rollout. The earlier six-secret bulk-save attempt is not proof of those
separate integrations being configured.

The original Live web and admin applications, the six-unit database release, and
eleven original Live/media Edge functions have been deployed to production. Live creation
and chat are enabled. Broadcasting, HLS audience delivery and recording remain
disabled pending Daily provider and complete broadcast acceptance. Clip
encoding passed the bounded production acceptance described above. The AWS
delivery stack and approved signing keys are installed;
hosted secret checks passed **10/10**, and synthetic signer-to-CDN delivery
passed **15/15** on 2026-11-03 UTC. The Daily webhook is `ACTIVE`, but actual
Daily storage verification failed with `role_assumption_denied`. Broadcast
admission remains disabled.

This release implements the directory, player and studio; clip editing and
private media publication; device export and social sharing paths; creator and
staff controls; and polls, Q and A, chapters and analytics interfaces. Deployed
code and available UI controls do not establish a successful live broadcast,
external social publication, device acceptance or measured capacity.

The initial production endpoint checks completed on **2026-11-03** at
**01:05:16.420 UTC**. The production endpoint receipt is stored alongside this
document; subsequent infrastructure acceptance is recorded below. The
[production web/admin receipt](evidence/production-web-admin.json)
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

These identities describe the original web/admin release and its last verified
production aliases. The later optional SQL/Edge deployment has separate evidence
below. Local compilation, prepared image archives and source commits do not
update a production frontend identity; append a new deployment receipt after an
actual release.

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

### Original database and worker checks

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

### Original Edge functions and endpoint checks

The original eleven functions are `ACTIVE` in both QA and production:

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

### Optional foundation deployed in QA and production

The [optional hosted release receipt](evidence/live-optional-hosted-release.json),
recorded at **07:15:28 UTC**, establishes the later additive deployment. It is
separate from the original six-unit release and original eleven-endpoint checks.

| Reviewed source migration | QA applied version | Production applied version |
|---|---|---|
| `20261103055547_live_optional_integrations.sql` | `20261103064853` | `20261103065842` |
| `20261103061323_live_direct_social_publishing.sql` | `20261103070617` | `20261103071049` |
| `20261103064534_live_clip_queue_peek.sql` | `20261103070048` | `20261103070153` |

The receipt records the exact source hashes. Each environment passed eight
foundation SQL checks, eight direct-publishing SQL checks and four queue ACL
checks. These read-only or rolled-back checks did not retain synthetic users,
clips, jobs or posts. Postflight found zero social jobs, transcription jobs and
provider reservations; the clip queue was disabled and idle. All six integration
rows had both `enabled=false` and `publishing_enabled=false`. The second migration
also adds the previously missing `social_connections(platform)` foreign-key index.

Six additional functions are `ACTIVE`, version **1**, in both environments:
`live-connect`, `live-social`, `live-social-worker`, `live-social-pull`,
`live-transcription-worker` and `live-clip-scaler`. Their matching bundle hashes
are in the hosted receipt. They authenticate through verified user/session
checks, dedicated worker/queue bearers or a restricted clip capability.

The [QA endpoint receipt](evidence/live-optional-qa-endpoint-acceptance.json),
**07:09:40 UTC**, and [production endpoint
receipt](evidence/live-optional-production-endpoint-acceptance.json),
**07:11:25 UTC**, each passed **13/13** negative authentication/cache checks.
Missing or invalid credentials returned 401; unavailable pull media returned
403; a write to the pull endpoint returned 405. Private/no-store responses and
absence of redirects were checked. These results establish handler startup and
rejection behavior, not valid worker-secret installation, successful OAuth,
transcription, media transfer or an external post.

The optional code implements scoped OAuth, encrypted token lifecycle, durable
explicit-consent publication jobs, conservative retry/reconciliation, provider
adapters, private TikTok URL-pull delivery and reviewed transcription drafts.
The [social review](evidence/live-social-release-review.json) and
[independent review](reviews/live-social-independent.json) distinguish local
contract tests from provider acceptance. Real apps, approvals, creator grants,
approved images and actual service acceptance are still required.

### Renderer deployment and separate optional-worker gates

Renderer build `e6d84528-7c98-4d78-9bbe-e28204efcd55` succeeded at **08:13:33 UTC**.
Its immutable image is `sha256:c72e83dda292433e6857ad9ff5346b06ff921552f6243c43b9ba1360492b9b3c`.
The [actual image receipt](../../../infrastructure/live-clips/operations/renderer-image-acceptance.json)
records 34 passing tests, both output orientations, decoded audio/video,
captions, watermark, cover, cleanup and nonroot execution. Both encoder binaries
have a verified non-executable 8 MiB thread stack; the codec and protocol
allowlists are unchanged. ECR completed its package scan at **08:16:31 UTC**
with no findings. The separately recorded source-built FFmpeg residual review
still applies.

The production service and launcher infrastructure are operational for the
tested rendering path. At **08:37:41.752 UTC**, task
`7a27f1b718d74e5fbb3664f6f7622936` completed clip
`23aba5da-f9a9-4818-919b-2af0fb35d312`: job revision 2, attempt 2, `done`, no
error, and four stored assets from its current lease. The two-second horizontal
output is 1280×720 / 38,776 bytes; vertical is 720×1280 / 40,000 bytes; the
thumbnail is 7,521 bytes and VTT is 70 bytes. There were zero publications.
The [runtime receipt](evidence/live-renderer-runtime-acceptance.json) records
the exact task, image, job and backend evidence. The accepted task stopped with
exit code **0** at **08:39:00.858 UTC**. The scheduler automatically returned the
shared ledger to idle, retaining **1,440 charged seconds across two launches**;
no active clip job remains.

Fixture identity and session cleanup is complete. All five exact S3 source
object versions were removed, and the source prefix has no versions remaining.
The four successful private output objects remain until the required **2-hour,
10-minute signed-upload capability window** expires. Automated cleanup has
**28 pending rows** covering six failed lease prefixes and the successful
seventh prefix, four names each, due **10:34:35–10:50:29 UTC**. These rows are
cleanup targets, not a claim that 28 objects exist. Output-byte deletion remains
pending that scheduled window; the enabled scheduler can drain due cleanup.

Two additive migrations resolved the real Storage signing preflight failure:
`20261103082746_live_clip_signed_upload_preflight.sql` and
`20261103083628_live_clip_signing_probe_transport_metadata.sql`. They distinguish
the exact service-only `object.sign_upload_url` probe from the real upload,
including its observed transport metadata. Current lease, source, owner, path
and format checks remain, and actual uploads still require full provenance.
The production broker-to-Storage acceptance then passed.

The one-minute schedule is enabled, the service stays at zero, and finite tasks
run only when the bounded launcher admits due work. The separate transcription
and social executors retain their own activation and provider-acceptance gates.
The earlier attempted six-secret bulk save does not establish their configuration;
do not infer success from a form submission or negative endpoint checks.

The [initial renderer image](evidence/live-renderer-initial-build.json) did build
and pass its original encoding checks, but its [scan](evidence/live-renderer-initial-image-scan.json)
reported two CRITICAL and 42 HIGH findings. It was held, and it is not an accepted
production image. The replacement packages use narrower runtimes and require
new actual-container, component-inventory and scan evidence.

The first social image build also remains a historical failed attempt: Docker
completed, but the first UID1000 runtime-policy read failed. Its public base
metadata had been copied as root-owned mode0600. The corrected source uses
root-owned mode0444 and requires that result in actual-container acceptance;
local tests are not a successful AWS rerun. See the [image preparation
receipt](evidence/live-social-image-preparation.json), [transcription permission
correction](evidence/live-transcription-public-metadata-permissions.json), and
the worker-specific build runbooks. The renderer receipt above supersedes its
earlier pending state; other worker acceptance requires separate evidence.

### Delivery infrastructure follow-up

The [delivery configuration receipt](evidence/live-delivery-infrastructure.json)
records the subsequent infrastructure work on 2026-11-03 UTC. The existing
production Daily credential returned domain name `platinumcircles` and domain
UUID `bfe7e3aa-0369-4bd6-9db1-d882df729ddf` through a fixed read-only server
inspection. The credential itself was not exposed.

Production now has the verified `LIVE_DAILY_DOMAIN_ID` and
`LIVE_PLAYBACK_SIGNER_URL`. Maintenance request **10559** returned HTTP **200**
with both settings present. [The settings screenshot](evidence/live-delivery-settings.jpg)
records the production project and saved setting names without secret values.

The signer correction was deployed as QA version **2** and production version
**3**. The maintenance inspection was deployed as QA version **4** and production
version **3**. Their exact source and bundle hashes are in the receipt. These
function deployments supersede the corresponding versions in the initial
backend receipt; the web/admin runtime commit above is unchanged. The inspection
requires a valid single-use tick, completed maintenance and an exact opt-in
header. Scheduled ticks do not request Daily domain metadata.

The reviewed CloudFormation package corrects Daily's twelve-hour role session,
the domain-name external ID, the narrowly scoped upload verification object,
CloudFront function association and authenticated browser preflight. The signer
now rejects uppercase UUID paths that the edge verifier would reject.
Four infrastructure-contract tests, seven signer/edge tests and seventeen
provider/maintenance tests passed. CloudFormation lint passed for `us-east-1`,
the initially proposed `us-west-2`, and the selected `us-east-2`. These local
checks preceded the hosted deployment and acceptance below; they are not the
evidence for successful production delivery.

### AWS project connection follow-up

The user has since created a project with the new AWS experience and selected
`us-east-2`. This supersedes the earlier proposed `us-west-2` placement.
CloudFormation lint also passes for `us-east-2`.

The official remote AWS MCP connection is authenticated. Its `us-east-1`
service endpoint does not change the selected delivery region. The 2026-11-03
[setup receipt](evidence/aws-toolkit-setup.json), [prepared connection
screenshot](evidence/aws-toolkit-connection-ready.jpg), [intermediate connection
check](evidence/aws-toolkit-connection-check.json) and earlier approval-blocked
key form remain historical records. Their pending-access and pending-key states
are superseded by the deployment and signing receipts below.

### AWS stack, installed keys and hosted delivery acceptance

The [AWS deployment receipt](evidence/aws-live-deployment.json) supersedes the
earlier AWS connection snapshots. Authenticated STS verified account
`518317808503`. Stack `platinum-live-production` is now `UPDATE_COMPLETE` in
`us-east-2`, and distribution `E15BWQDKI39QKD` reports `Deployed`.

Direct AWS reads verified private S3 access, encryption, bucket ownership,
versioning, distribution-scoped origin access, Daily's constrained object
permissions, cache policies and viewer-function associations. Actual unsigned
GET and OPTIONS requests returned HTTP 403 with CloudFront's
`FunctionGeneratedResponse` marker. Signed delivery was subsequently verified
with the isolated fixture described below; Daily role acceptance is separate.

The real bucket, region, Daily role ARN and CDN origin were saved in production
Supabase. Maintenance request `10710` returned HTTP 200 and confirmed all four
settings present in the running function. The earlier Daily domain UUID and
signer URL are also present.

The user explicitly approved all three keys. The [signing installation
receipt](evidence/live-signing-installation.json) records production Supabase
installation of `LIVE_CDN_SIGNING_KEY`, `LIVE_CDN_KEY_ID`,
`LIVE_PLAYBACK_SIGNER_SECRET` and `LIVE_DAILY_WEBHOOK_SECRET`. The connected AWS
KeyValueStore data client lacks its CRT dependency, so the approved private S3
import completed through the control API. Both stage and activation change sets
were executed. Store `5dfd608b-fcc5-4881-b4b4-69962fe289b0` is associated with
the viewer function at `LIVE`; the old empty store remains in the stack.

| Hosted evidence, 2026-11-03 UTC | Result and scope |
|---|---|
| [Secret acceptance](evidence/live-secret-acceptance.json), 04:55 | **10/10**: valid and rejected webhook HMAC requests; signer bearer, exact capability, expiry, session and traversal checks. The webhook test is operator-generated, not proof of Daily registration. |
| [CDN acceptance](evidence/live-cdn-acceptance.json), 05:06 | **15/15**: exact hashes for all five HLS fixture files, relative child delivery, HEAD, 206 Range, 204 authenticated OPTIONS, shared-cache hits and expected 403 denials for invalid capabilities, wrong scope, writes and direct unauthenticated S3. |
| [Seed cleanup](evidence/live-signing-installation.json) | Exact temporary seed version erased after the first successful signer-to-CDN manifest request; re-list found zero versions and zero delete markers. |
| [Fixture cleanup](evidence/live-cdn-fixture-cleanup.json), 05:07 | All five fixture versions erased; re-list found zero versions and zero delete markers. |
| [Daily webhook registration](evidence/live-daily-webhook-registration.json), 05:12 | Registered `ACTIVE`; verified domain, all five streaming events, exponential retry, target match and HMAC match. |
| [Daily storage acceptance](evidence/live-daily-storage-acceptance.json) | Failed: provider HTTP 400, `invalid-request-error`, classified `role_assumption_denied`. Temporary room cleanup confirmed. |

The [first CDN attempt](evidence/live-cdn-acceptance-before-browser-origin.json)
failed because its request omitted browser Origin. The helper now sends the
browser header on CDN requests, and the corrected hosted run passed all checks.
The failed receipt remains historical; no failing check was removed or weakened.

Future stack updates must preserve the activated
[template](../../../infrastructure/live/signing-bootstrap-activate.json),
`SigningKeysImported` and its association. Applying the default template would
switch the function to the original empty store. The activated template's
`ImportSource` records an erased historical seed; replacing or recreating that
store requires a new approved private seed and reviewed activation plan. See the
[infrastructure runbook](../../../infrastructure/live/README.md) and
[CDN acceptance instructions](CDN_ACCEPTANCE.md).

### Daily provider outcome and next review

Webhook `8bec1b00-0155-4534-b70f-c856d01ab218` is `ACTIVE` for the verified
`platinumcircles` domain and UUID `bfe7e3aa-0369-4bd6-9db1-d882df729ddf`.
The provider re-read confirmed `streaming.started`, `streaming.updated`,
`streaming.ended`, `streaming.error` and `streaming.warning`, `exponential`
retry, the expected target and `hmac_matches: true`. Owner operation
`9a653fc1-d31c-4c1a-9b90-1d1c5100a066`, request `10766`, completed successfully.
The registration receipt contains only sanitized results.

Storage operation `918a5b10-c3cd-4241-99ac-eaae62776330`, request `10769`,
failed at Daily with HTTP **400**, `invalid-request-error`, classified
`role_assumption_denied`. Its temporary room has `cleanup_confirmed: true`.
The AWS role re-read matches Daily account `291871421005`, external ID
`platinumcircles` and a 43,200-second session duration, with no permissions
boundary. The S3 verification object was absent before and after the attempt.
Bounded CloudTrail lookups in `us-east-1` and `us-east-2` found no relevant
`AssumeRole` event; that absence does not establish the cause. Daily HLS
configuration and a complete broadcast have not passed acceptance.

The next task is an owner-authorized, read-only inspection of the AWS project's
attached and inherited SCPs/RCPs, the actual denying statement and policy
mutability. Earlier inspection returned `AccessDenied`, so the actual policy
remains unknown. AWS explicitly documents its published new-experience managed
RCP as **not modifiable**. If that immutable policy is the applicable blocker,
**stop** and seek a supported resolution from the responsible AWS/account owner;
do not edit or detach it, or activate advanced features as a workaround.

The [Daily role access review](../../../infrastructure/live/daily-role-access-review.json)
is **review-only, not ready to apply**, and authorizes no policy or account
action. Only an identified editable customer-managed deny can proceed to a
concrete, separately reviewed minimal diff. Preserve the exact Daily role,
vendor account, external-ID restriction and unrelated protections; rerun
isolated Daily storage verification only after an authorized correction.

An earlier automatic approval review blocked opening AWS Settings: approval to install
the keys did not authorize an account-management or billing flow. No upgrade,
advanced-feature activation, organization policy change or admission expansion
was performed by that attempt. The AWS Free plan reported USD 100 credits during preflight;
the observed failure does **not** prove that a paid upgrade is required or
sufficient. No upgrade or activation is promised to make the policy editable or
resolve Daily access. These statements describe the historical attempt, not the
current account plan.

The owner subsequently changed the account. The [updated account
receipt](evidence/aws-owner-plan-updated.json), **06:19:40 UTC**, verified
`PAID`/`ACTIVE`; a read-only Transcribe job listing succeeded. It supersedes the
earlier Free-plan Transcribe denial. Advanced-feature activation was not completed.
The [Daily recheck after that change](evidence/live-daily-after-paid-acceptance.json)
still returned HTTP400 `role_assumption_denied` at **06:59:37 UTC**, with temporary
room cleanup confirmed. Paid-plan status did not establish Daily access.

Two separate synthetic `StartTranscriptionJob` attempts were rejected during S3
output-access validation. The [provider access
review](evidence/live-transcription-provider-access-review.json) records their
request IDs and limits: the exact downstream principal, action, object key and
denying policy remain unproven. This is a current acceptance blocker distinct
from the superseded Free-plan listing denial. No successful transcript or broad
policy correction is claimed. Five-million-user capacity remains unmeasured.

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
| Clip encoding admission | Enabled; real production fixture rendered and stored successfully |
| Configured renderer concurrency | Two active jobs across the fleet |
| Optional OAuth connection admission | Disabled for all five platforms |
| Direct social publishing admission | Disabled for all five platforms |
| Automatic transcription admission | Disabled |
| Social/transcription jobs and provider reservations | Zero at the 07:15 hosted postflight |
| Renderer service | ACTIVE with accepted image; desired/running/pending counts 0 |
| Renderer launcher | Operational and idle; one-minute schedule enabled, finite on-demand tasks |
| Paid gifts | Disabled and deferred |

The encoder gate is separate from the deployed `live-clip-worker` Edge broker.
The production runtime receipt establishes the actual worker, lease and private
asset-writing flow for an isolated synthetic clip. It does not establish a
Daily broadcast or publish that clip to a feed or external platform. Existing
authorized asset access is independent of the new-render admission gate.

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

Production has the Daily API key and verified domain UUID, signer URL and
credential, bucket, region, Daily role ARN, CDN origin, matching CDN key/ID and
webhook HMAC. The initial missing-setting reports are superseded by the hosted
receipts above. AWS storage/CDN and the synthetic authenticated delivery path
are accepted for the isolated fixture, and the Daily webhook is `ACTIVE`.
Actual Daily storage access is blocked by the provider's role-assumption denial;
the complete provider broadcast remains unaccepted. The next review and its
authorization boundary are recorded above.

The renderer image, real production queue processing and private asset writes
are accepted; its service and launcher stacks are deployed and the one-minute
schedule is enabled. Separate transcription/publishing executors retain their
own deployment and provider gates. The
[renderer runbook](../../../workers/live-clips/README.md) specifies its scoped
broker credential, runtime limits and activation RPC. Native binary and device
acceptance, full broadcast flows and measured capacity remain held. Secret
values and URL bearer capabilities must not be added to these release artifacts.

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

External platform accounts are not connected. Direct OAuth publishing is now
implemented in the optional queue/broker/executor and web consent flows, with
all admissions off; it has not passed real-provider acceptance. Each platform
still requires its actual developer application, approved scopes/reviews and
creator authorization. TikTok additionally requires verified URL ownership and
acceptance of the bounded first-party URL-pull transfer. The [social
runbook](../../../workers/live-social/README.md) lists the exact setup requirements.
Existing link intents and device exports continue to record `export_required`;
neither a file export nor a share-sheet handoff confirms an external post.

The optional transcription queue, bounded executor and explicit caption-review
path are implemented, but image/service and actual Transcribe acceptance remain
pending. Manual subtitle editing and WebVTT import remain available independently.
The [native handoff receipt](evidence/live-native-web-handoff.json) records twelve
passing local tests for fixed-origin browser links, with no session data in URLs.
It does not establish native OAuth forms, physical-device handoff, a new binary
or distribution. TestFlight and device distribution remain held. Paid gifts
remain deferred.

## Canonical web release smoke procedure

The [Vercel readiness receipt](evidence/vercel-web-release-readiness.json) records
team `team_yu7fUehO2z7E6QHF6Nvxp3tC`, project
`prj_mvKhFO3aq4OeCefPa3yaH8ub583u`, repository `donadmiral/tbirds-nest` (ID
`1314826575`), the intended `web` root and shared-source setting. Both required
production environment names are present: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; their values were not printed or saved. Local
production compilation passed, but the optional frontend release is still
pending at this checkpoint.

The installed deployment tool does not expose a skip-domain-assignment option.
Do not invent that parameter or obtain a credential workaround. A later approved
production deployment may assign domains automatically on `READY`; record the
reviewed commit and returned deployment ID before checking the canonical site.
The production middleware redirects `.vercel.app` URLs to the canonical domain,
so a redirected HTTP200 alone does not prove a candidate is serving.

After an actual release, use a signed-out real browser with no API mocks,
synthetic authentication or user writes. Verify the canonical alias maps to the
exact reviewed deployment/SHA, then check only the following:

| Canonical route | Expected observation |
|---|---|
| `/live` | HTTP200, visible Live directory and category controls; Live text/icon beside Trending; no fatal JavaScript error. |
| `/live/clips` | HTTP200 with the truthful signed-out clip-library state. |
| `/live/connections` | HTTP200 with sign-in/connection state; no provider navigation or OAuth exchange on load. |
| `/live/connections/callback` with no query parameters | A recoverable missing-code/state response; no provider exchange. |
| `/live/clips/10000000-0000-4000-8000-000000000001/publish` and `/captions` | HTTP200 and sign-in required; no queued post or transcription. The UUID is a route fixture, not an asserted existing clip. |
| `/api/live/social-pull/10000000-0000-4000-8000-000000000001/clip.mp4?token=invalid` | HTTP403 generic unavailable response, private/no-store caching, no redirect and no media bytes. |

If `/home` redirects to login while signed out, record that expected result.
Record the Supabase hostname only if a real directory request occurs; it should
be `prlkikhckbifseosbukl.supabase.co`. If no request occurs, report it as unobserved.
Never record authorization headers, API keys, OAuth query parameters or media
capabilities. Save a compact receipt of alias/SHA, statuses, visible states and
fatal-error count; no publishing, connection or transcription action is part of
this smoke check. These are instructions for a later release, not checks
performed at this handoff.

If the canonical smoke fails after that release, the immediate web rollback
target is `dpl_Ds9RKyzPNXqnNSziBWFeC9DwPZcc`, SHA
`2e265ef0915ed83cbf5ba79f22f3ea1f1a717d8d`. The pre-Live rollback identities below
are older historical references and are not the first rollback choice for the
optional frontend release.

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
