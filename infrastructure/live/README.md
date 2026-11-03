# Platinum Live delivery

This package contains the audited deployment template and operator runbook.
Deployment and provider acceptance must be recorded separately; source files
and local checks alone do not establish hosted readiness or measured capacity.

`live-cloudformation.json` creates a private, versioned S3 bucket, a scoped
Daily role, CloudFront distribution and origin access control, a signing-key
store, short manifest caching, shared segment caching and viewer authorization.
`template.mjs` regenerates it from `viewer-request.js`.

## Runtime contracts

Only authorized hosts, co-hosts and approved camera/guest participants join the
private Daily production room. Audience members consume HLS from CloudFront.

`live-playback` checks the current user, active authentication session, audience,
blocks and stream state. It asks `live-sign` for a capability lasting at most
120 seconds. The capability is in the URL path so relative HLS child references
retain it. The viewer-request function validates every request before stripping
the capability for origin and shared-cache lookup. Unsigned paths fail. A copied
capability remains usable until expiry, bounded by 120 seconds; this is access
control, not DRM.

The HMAC covers key ID, expiry, session UUID and provider instance UUID. The
requested object must independently remain inside that same session/instance
prefix. Every cache behavior applies the authorization function.

## Exact deployment inputs

Daily HLS requires an eligible paid account; webhooks require a credit card on
that account. Confirm the customer's Daily domain and AWS identity before
creating resources. Daily's account below is not the customer's target account.

| Input | Requirement |
|---|---|
| Target AWS account | Customer account established from the authenticated AWS identity |
| AWS region | Selected S3 region, also supplied to Daily as `bucket_region` |
| Stack name | Unique for these account-wide CloudFront resource names; at most 54 characters because the function appends `-authorize` |
| CloudFormation capability | `CAPABILITY_IAM`; the role has no explicitly assigned role name |
| `DailyAccountId` | Default `291871421005`, documented by Daily for its S3 integration |
| `DailyExternalId` | Exact Daily domain name, the subdomain before `.daily.co`; not its UUID or a URL |
| `LIVE_DAILY_DOMAIN_ID` | Separate domain UUID from Daily, also returned as `domainId` when registering its webhook |

### Verified production inputs

The existing production Daily credential returned domain name `platinumcircles`
and domain UUID `bfe7e3aa-0369-4bd6-9db1-d882df729ddf` on 2026-11-03 UTC.
[production-parameters.json](production-parameters.json) contains the verified
domain name and Daily's documented AWS principal account. Neither value is the
customer's target AWS account. The domain UUID and production signer URL have
been saved in Supabase and verified by the running maintenance function. See the
[configuration receipt](../../supabase/ops/live-release-20261103/evidence/live-delivery-infrastructure.json).

AWS account access was subsequently verified through the connected Toolkit.
The `platinum-live-production` stack is now `CREATE_COMPLETE` in `us-east-2`,
account `518317808503`, with CloudFront distribution `E15BWQDKI39QKD` reporting
`Deployed`. The exact outputs and API checks are in the
[AWS deployment receipt](../../supabase/ops/live-release-20261103/evidence/aws-live-deployment.json).
Production Supabase has the real bucket, region, role ARN and CDN origin;
maintenance request `10710` confirmed all four at runtime with HTTP 200.
Signing-key installation and Daily acceptance are still pending. Keep broadcast
admission disabled until the remaining provider and delivery checks pass.

### User-created AWS project and connection

The user created a project using **the new AWS experience** and selected
**`us-east-2`**. The deployed bucket's actual location matches that region.
The earlier `us-west-2` proposal is superseded. Authenticated STS identified
account `518317808503`; Free Tier reported an active `FREE` plan with USD 100
in remaining credits during preflight. No plan upgrade was performed.

For this ChatGPT web session, the supported connection is AWS's remote OAuth
MCP server at `https://aws-mcp.us-east-1.api.aws/mcp?oauth=initialize`. Its
`us-east-1` endpoint identifies the MCP service, not the project's deployment
region. OAuth is now connected and authenticated AWS API access is verified.
The [initial setup receipt](../../supabase/ops/live-release-20261103/evidence/aws-toolkit-setup.json)
and [intermediate connection check](../../supabase/ops/live-release-20261103/evidence/aws-toolkit-connection-check.json)
remain historical records, superseded by the deployment receipt above.

Before Daily acceptance, resolve the project's applicable policy state.
Authenticated organization policy/parent inspection returned `AccessDenied`;
this does not establish that restrictions are absent. AWS's published
new-experience RCP denies authenticated external
non-service principals, including `sts:*` and `s3:*` requests, when their
organization differs from the resource's organization. Daily's documented
vendor principal falls under that default deny, so a matching IAM trust policy
and external ID alone will not establish the required access.

If those managed restrictions apply, the owner must approve advanced feature
activation and the required narrow policy adjustment before Daily role
acceptance. Activation is irreversible and changes billing/spend-limit controls.
Do not activate it automatically, remove unrelated protections, or assume an
upgrade to the Paid plan resolves the restriction. Check which policies remain
after activation and validate actual Daily role assumption before admission.
The deployed Daily role is
`arn:aws:iam::518317808503:role/platinum-live-production-DailyWriter-3ZGHqfqMNzKI`.
An exact-role exception can be reviewed if the published deny applies; no
organization policy or advanced-feature setting has been changed.

Sources:

- https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html
- https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html
- https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html
- https://docs.aws.amazon.com/accounts/latest/reference/remove-org-policies.html

The bucket gets a generated name to avoid global S3 collisions. The Daily role
sets `MaxSessionDuration: 43200`, matching Daily's twelve-hour requirement.
Object permissions are restricted to `live/*`; bucket discovery and multipart
operations refer only to this dedicated bucket. Delete permission supports
Daily's non-retained HLS cleanup. The root-level verification object
`daily-co-test-upload.txt` receives only `s3:PutObject`. CloudFront receives
`s3:GetObject` only on `live/*`, constrained to this distribution's ARN. The
bucket blocks public access, requires TLS and enforces bucket ownership.

Deploy the stack, then wait for CloudFormation completion and CloudFront
propagation. Apply these output mappings:

| Stack output | Setting or acceptance use |
|---|---|
| `Bucket` | `LIVE_HLS_BUCKET` |
| `Region` | `LIVE_HLS_REGION` |
| `DailyRoleArn` | `LIVE_HLS_ASSUME_ROLE_ARN` |
| `CdnOrigin` | `LIVE_HLS_CDN_ORIGIN`, an exact HTTPS origin with no path |
| `SigningStoreArn` | Dedicated CloudFront signing-key store |
| `DistributionId` | Deployment status and cache behavior inspection |
| `ViewerFunctionName`, `ViewerFunctionArn` | Function testing and association inspection |

The provider installs the HLS destination in each private room's
`streaming_endpoints` property. Preserve the path template
`live/<session-uuid>/{instance_id}` and the resulting `master.m3u8` contract.
Installing this room-level destination does not require replacing unrelated
Daily domain-wide recording settings.

## Signing configuration and rotation

### Current pending installation

The connected AWS MCP server's KeyValueStore data client fails with a missing
`botocore[crt]` dependency. Its metadata-only Describe call was approved after
verification against the official response schema, but the remote client still
could not perform the SigV4A operation. The CloudFront control API works.

Two reviewed templates prepare the supported private S3 import alternative:

- [signing-bootstrap-stage.json](signing-bootstrap-stage.json) adds only the
  distinct `SigningKeysImported` resource, named
  `platinum-live-production-signing-v1`. It preserves the existing function
  association and every existing stack resource.
- [signing-bootstrap-activate.json](signing-bootstrap-activate.json) keeps both
  stores and the identical import source, then changes the viewer function's
  association and `SigningStoreArn`. Use it only after the imported store's
  control-plane status is `READY`.

The stage change set `live-signing-import-stage-20261103-v2` is prepared and
available. AWS reports exactly one `Add`, for `SigningKeysImported`. It has not
been executed. Stack tags are preserved. Both templates pass local lint for
`us-east-2` and AWS `ValidateTemplate`; ten focused generator tests pass.

The seed belongs under `_bootstrap/` in the private Live bucket, outside both
Daily's and CloudFront's `live/*` read scope. Its JSON uses `data` entries with
`key` and `value`. No secret value is embedded in a template, parameter, tag or
release receipt. Keep the seed unchanged until import reaches `READY`, then
verify the actual function before removing all versions of the exact temporary
seed object. Retain the old empty store until acceptance finishes.

Automatic approval review rejected the first attempted seed upload before any
HTTP request because explicit permission for transferring new Live credentials
was missing. The seed is not uploaded, the imported store is not created, and
none of the three new secrets has been installed. The production Supabase form
contains only the pending names and public key ID, not the secret values.

One approval should cover the CDN key's temporary private S3 import into
CloudFront and its matching Supabase value, the separate Supabase signer
credential, and the base64 webhook key in Supabase and Daily. The keys authorize
playback and authenticate provider events. Do not retry the rejected upload,
enter these secrets in a browser, or register the webhook until that approval.

For future generation, use an explicit output path with
`--signing-import-phase stage|activate --signing-import-key _bootstrap/<name>.json`.
Use the exact same seed key in both phases. Imported-mode stack names must be
at most 53 characters because the store appends `-signing-v1`.

### Key contracts

Generate independent random secrets using the protected operator workflow. Use
at least 32 random bytes for the CDN signing secret, represented as text such as
hexadecimal, and store the exact same text in both the KVS and signer:

- KVS key `signing:<key-id>`: the CDN signing secret.
- Supabase `LIVE_CDN_SIGNING_KEY`: that same secret text.
- Supabase `LIVE_CDN_KEY_ID`: the matching ID, satisfying `[a-z0-9_-]{1,16}`.
- Supabase `LIVE_PLAYBACK_SIGNER_SECRET`: a different random server credential.
- Supabase `LIVE_PLAYBACK_SIGNER_URL`:
  `https://<project-ref>.supabase.co/functions/v1/live-sign`.

KVS data updates use the `cloudfront-keyvaluestore` API and its current `ETag`,
separately from the CloudFront API that creates the store. Use a current CLI/SDK
with SigV4A support. Temporary credentials require version 2 STS tokens; obtain
them from a regional STS endpoint. Inspect metadata and scoped success/failure
results, not `get-key` or `list-keys` responses containing secrets.

Rotate keys in this order:

1. Add a new secret under a new key ID in the existing KVS, retaining the old key.
2. Verify readiness and successful edge authorization of a protected synthetic
   capability using the new key. A successful write does not prove propagation.
3. Update the signer's secret and key ID together. Confirm new-key issuance and
   actual authorized delivery.
4. Keep the old entry until at least 120 seconds after the last possible issuance
   by an old signer instance, allowing for deployment overlap.
5. Remove the old entry with an `ETag`-checked KVS update after that overlap.

Overwriting a secret under an existing key ID invalidates its still-live
capabilities. Emergency removal may intentionally revoke a key sooner, subject
to propagation; record that as an incident action. No signing secret, provider
credential or URL capability belongs in logs, screenshots or release artifacts.

## Webhook prerequisites and registration

Generate at least 32 random bytes for the webhook HMAC and encode them as base64.
Install that value as `LIVE_DAILY_WEBHOOK_SECRET` before registration. Then call
Daily's `POST https://api.daily.co/v1/webhooks` with the existing domain API key
and this shape, supplying the placeholders privately:

```json
{
  "url": "https://<project-ref>.supabase.co/functions/v1/live-provider-webhook",
  "hmac": "<the already-installed base64 HMAC secret>",
  "retryType": "exponential",
  "eventTypes": [
    "streaming.started",
    "streaming.updated",
    "streaming.ended",
    "streaming.error",
    "streaming.warning"
  ]
}
```

Daily first sends a signed `{"test":"test"}` payload and requires HTTP 200
within eight seconds. The handler verifies the timestamp and HMAC and acknowledges
this test without database or provider calls. If Daily generates the secret
instead, the handler cannot know it before the creation response and will reject
the test. Supply the secret first; do not bypass signature verification.

Record the webhook UUID, domain UUID, URL, event types, retry policy, state and
timestamps. Do not print the full registration response: it contains the HMAC.
Require `state: ACTIVE` and confirm `LIVE_DAILY_DOMAIN_ID` before broadcast
admission. The chosen `exponential` policy avoids the default circuit break after
three consecutive failed deliveries, but retries remain bounded. Monitor
failures and state reconciliation. Creation, updates and reactivation all send
the signed verification request.

## Cache, CORS and retention

Manifest caching caps at two seconds. Immutable segments share a cache after
authorization. Browser responses receive `private, max-age=1`; this response
policy does not change CloudFront's internal cache settings. Error caching is
one second. Session and instance UUIDs prevent cross-broadcast object reuse.

`GET` and `HEAD` reach S3 only after authorization, preserving the `Range`
header. Valid `OPTIONS` preflights are handled at the edge after the same
capability check, permitting only `GET`/`HEAD` with `Range`, `Origin` and `Accept`.
They cannot authorize writes or credentialed requests. Invalid or expired
capabilities fail closed, including on cache hits and preflight requests.

The bucket is retained on stack removal. Abandoned multipart uploads expire
after one day; noncurrent versions expire after seven days. Versioning is
required by Daily, so `save_hls_recording=false` does not imply immediate removal
from all versions: deleted segments can remain as noncurrent objects for seven
days. Complete erasure must include object versions through an authorized
workflow. This template does not silently delete active current recordings.

## Operational acceptance

After deployment, run CloudFront `TestFunction` against the associated store;
inspect runtime errors and compute utilization. Confirm both cache behaviors,
OAC and the distribution-specific bucket policy. A local linter cannot establish
account-level permissions, resource quotas or deployed function compatibility.

Use an isolated private stream to verify the actual Daily role, root-level upload
probe and HLS output. Master and child references must stay relative within the
signed session/instance prefix and use `.m3u8`, `.ts`, `.m4s`, `.mp4` or `.vtt`.
Inspect real variants and initialization objects, not only synthetic manifests.
Check browser/native playback, byte ranges, preflight, repeated cache hits,
expiry, foreign-session rejection, direct S3 denial and unsigned CDN denial.
Resolve any different provider path format explicitly; do not expose an unsigned
origin as a fallback.

Confirm real host capture, guest/source switching, screen sharing, four
renditions, reconnect recovery, recording finalization and provider stop. Verify
a clip during the retained EVENT timeline and another from its finalized replay.
Keep broadcast and clip-encoder admission gated until their acceptance passes.
The external renderer, scheduler and scoped credentials are a separate setup
covered by `workers/live-clips/README.md`.

Record non-secret resource IDs, template hash, deployment state, function test
results, webhook state and provider acceptance in the release receipt.

## Capacity acceptance

Run `node tools/performance/live-capacity.cjs tools/performance/live-five-million-scenario.json`
from the repository root. This is a planning scenario, not measured capacity.
Five million registered users is distinct from concurrent live viewers. Supply
real measurement evidence as the second argument before claiming acceptance.
The gate requires provider reservations, authenticated playback throughput,
chat fanout, renderer capacity, regional tests, failure recovery and a 24-hour
soak. Functional storage/CDN setup does not certify those limits.

## Local verification

The tests run the actual signer and viewer code with a synthetic KVS. They verify
shared HMAC contracts, scoped HLS children, traversal/expiry rejection,
authenticated preflight and overlapping signing-key rotation. Separate encoder
tests create and decode real horizontal/vertical clips, captions and covers.
None of those local fixtures establish a real Daily broadcast or deployed AWS
capacity.

```sh
node infrastructure/live/template.mjs
node infrastructure/live/test/template.test.mjs
node supabase/tests/live-signing.test.cjs
cfn-lint infrastructure/live/live-cloudformation.json -r us-east-1
```

The audit used `cfn-lint` 1.59.0. Validate the actual target region when deploying
elsewhere. The generated JSON must match the reviewed generator and function.

## Primary references

- https://docs.daily.co/docs/guides/features/live-streaming/hls
- https://docs.daily.co/docs/guides/features/recording/custom-s3-storage
- https://docs.daily.co/reference/rest-api/webhooks
- https://docs.daily.co/reference/rest-api/webhooks/create-webhook
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-function.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-keyvaluestore.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-role.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-20.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-kvp.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-function-restrictions.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/modifying-response-headers.html
