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
The `platinum-live-production` stack is now `UPDATE_COMPLETE` in `us-east-2`,
account `518317808503`, with CloudFront distribution `E15BWQDKI39QKD` reporting
`Deployed`. The exact outputs and API checks are in the
[AWS deployment receipt](../../supabase/ops/live-release-20261103/evidence/aws-live-deployment.json)
and subsequent [signing installation receipt](../../supabase/ops/live-release-20261103/evidence/live-signing-installation.json).
Production Supabase has the real bucket, region, role ARN and CDN origin;
maintenance request `10710` confirmed all four at runtime with HTTP 200.
The approved keys are installed, and hosted secret and synthetic CDN acceptance
passed **10/10** and **15/15** respectively. The Daily webhook is registered and
`ACTIVE`. Daily's storage verification failed with `role_assumption_denied`;
the temporary verification room was cleaned up. Broadcast and encoder admission
remain disabled pending provider access and their respective acceptance.

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

Authenticated organization policy/parent inspection returned `AccessDenied`,
so the applicable attached and inherited policies remain uninspected. Daily's
observed role-assumption denial is consistent with AWS's published new-experience
RCP restricting external non-service principals, including `sts:*` and `s3:*`
requests across organizations. This is a possible cause, not a confirmed
diagnosis of this account. A matching role trust and external ID do not override
an applicable organization-level deny. The deployed role is
`arn:aws:iam::518317808503:role/platinum-live-production-DailyWriter-3ZGHqfqMNzKI`.

The next task is an owner-authorized, read-only review of this project's attached
and inherited SCPs/RCPs, the actual denying statement and policy mutability.
AWS explicitly documents its published new-experience managed RCP as
**not modifiable**. If that immutable policy is the applicable blocker, **stop**
and seek a supported resolution from the responsible AWS/account owner. Do not
attempt a policy edit, detachment or advanced-feature activation as a workaround.
The actual policy remains unknown; neither an upgrade nor activation is promised
to make it editable or fix Daily access.

The [Daily role access review](daily-role-access-review.json) is **review-only,
not ready to apply**, and authorizes no policy or account action. Only if the
owner identifies an editable customer-managed deny may a concrete minimal diff
be prepared for separate review, preserving this exact role, Daily account
`291871421005`, external ID `platinumcircles` and unrelated protections.

Automatic approval review blocked opening AWS Settings because the approved
key-installation work did not authorize an account-management or billing flow.
No upgrade, advanced-feature activation or organization policy change occurred.
After an authorized, reviewed correction, rerun Daily's isolated storage
verification before attempting a real HLS broadcast or changing admission.

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

### Installed production state — 2026-11-03 UTC

The connected AWS MCP server's KeyValueStore data client fails with a missing
`botocore[crt]` dependency. The supported private S3 import path completed through
the CloudFront control API after the user explicitly approved all three keys.
Production Supabase now has `LIVE_CDN_SIGNING_KEY`, `LIVE_CDN_KEY_ID`,
`LIVE_PLAYBACK_SIGNER_SECRET` and `LIVE_DAILY_WEBHOOK_SECRET`. The matching CDN
key is installed in `platinum-live-production-signing-v1`, ARN
`arn:aws:cloudfront::518317808503:key-value-store/5dfd608b-fcc5-4881-b4b4-69962fe289b0`.

The reviewed two-phase templates were both executed:

- [signing-bootstrap-stage.json](signing-bootstrap-stage.json) added only
  `SigningKeysImported`, preserving the previous association and stack resources.
- [signing-bootstrap-activate.json](signing-bootstrap-activate.json) associated
  the imported store after `READY`. The viewer function is published at `LIVE`,
  the distribution is `Deployed`, and the stack is `UPDATE_COMPLETE`.

The [installation receipt](../../supabase/ops/live-release-20261103/evidence/live-signing-installation.json)
records approval, executed change sets, final association and complete temporary
seed erasure. The seed was outside `live/*`; its exact object version was deleted
after a real signer-issued request retrieved the expected private manifest.
Re-listing found **zero versions and zero delete markers**. No secret value is
stored in a template, parameter, tag or release receipt.

Hosted [secret acceptance](../../supabase/ops/live-release-20261103/evidence/live-secret-acceptance.json)
passed **10/10** at 04:55 UTC, covering valid and invalid webhook HMAC requests
and signer authorization, expiry and scope. This validates the installed receiver
secret. Daily registration subsequently completed as recorded below.
[CDN acceptance](../../supabase/ops/live-release-20261103/evidence/live-cdn-acceptance.json)
passed **15/15** at 05:06 UTC: all five fixture hashes, HEAD, 206 Range, 204
authenticated OPTIONS, shared-cache hits and all expected 403 denials.
The [fixture cleanup receipt](../../supabase/ops/live-release-20261103/evidence/live-cdn-fixture-cleanup.json)
confirms all five versions erased, with no versions or delete markers remaining.

The earlier 2026-11-03 approval-blocked state and prepared-form screenshot are
historical and superseded by these receipts. The first CDN acceptance attempt
omitted the browser Origin header; its preserved failed receipt is superseded
by the corrected browser-equivalent request and passing run.

### Preserve the activated baseline

Use [signing-bootstrap-activate.json](signing-bootstrap-activate.json) as the
production update baseline. Both stores remain in the stack, and the original
`SigningKeys` store is empty. **The default generated template associates that
empty original store and must not be applied to this activated stack.** Preserve
`SigningKeysImported`, its association and the active `SigningStoreArn` output
when making unrelated updates.

The activated template retains the historical `ImportSource` declaration, but
that seed object no longer exists. Unchanged resources do not need to re-import
it. Recreating or replacing the imported store requires a new approved private
seed and a reviewed import/activation plan; the erased source cannot recover a
replacement store. Never change the source or force replacement casually.

For a reviewed future import, use an explicit output path with
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

Production webhook `8bec1b00-0155-4534-b70f-c856d01ab218` is registered and
`ACTIVE` for verified domain `platinumcircles`, UUID
`bfe7e3aa-0369-4bd6-9db1-d882df729ddf`. The provider re-read confirmed all five
streaming events below, `exponential` retry, the expected target and
`hmac_matches: true`. Owner operation
`9a653fc1-d31c-4c1a-9b90-1d1c5100a066`, request `10766`, completed successfully
at 05:12:49 UTC on 2026-11-03. See the [registration
receipt](../../supabase/ops/live-release-20261103/evidence/live-daily-webhook-registration.json).
This establishes registration and configuration; real broadcast-event processing
still requires the provider acceptance below.

For a new deployment, generate at least 32 random bytes for the webhook HMAC
and encode them as base64.
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

### Daily storage verification — blocked

Owner operation `918a5b10-c3cd-4241-99ac-eaae62776330`, request `10769`, reached
Daily, which returned HTTP **400**, `invalid-request-error`, classified as
`role_assumption_denied`. The isolated temporary room has
`cleanup_confirmed: true`. The [storage acceptance
receipt](../../supabase/ops/live-release-20261103/evidence/live-daily-storage-acceptance.json)
records the failure and follow-up AWS inspection.

The role re-read confirms Daily account `291871421005`, external ID
`platinumcircles`, `MaxSessionDuration: 43200`, and no permissions boundary.
The S3 verification object was absent before and after the attempt. Bounded
CloudTrail lookups in `us-east-1` and `us-east-2` found no relevant `AssumeRole`
event; this absence does not identify the cause. No Daily HLS configuration or
complete broadcast has passed acceptance. Complete the policy/access review
above, then repeat the provider check; matching IAM fields alone are insufficient.

### Remaining delivery and broadcast checks

The deployed synthetic signer-to-CDN path passed as recorded above. The reusable
[acceptance instructions](../../supabase/ops/live-release-20261103/CDN_ACCEPTANCE.md)
separate that result from real provider output and capacity acceptance. The
temporary fixture has been removed; a new run needs a new isolated fixture.

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
node infrastructure/live/test/template.test.mjs
node supabase/tests/live-signing.test.cjs
cfn-lint infrastructure/live/signing-bootstrap-activate.json -r us-east-2
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
