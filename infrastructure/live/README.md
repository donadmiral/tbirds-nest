# Platinum Live delivery

This package is prepared infrastructure, not a deployed capacity receipt.

`live-cloudformation.json` creates a private, versioned S3 bucket, a provider-scoped IAM role, a CloudFront distribution, origin access control, a signing-key store, short manifest caching, shared segment caching and viewer authorization. `template.mjs` regenerates it from the reviewed viewer function.

## Runtime contracts

The existing Daily production room receives only authorized hosts, co-hosts and approved camera/guest participants. Audience members consume HLS from CloudFront. They never join the private production room.

`live-playback` checks the current user, active authentication session, audience, blocks and stream state. It asks `live-sign` for a capability lasting at most 120 seconds. The capability lives in the URL path, so relative HLS variant/segment references retain it. The CloudFront viewer-request function validates every object request before stripping the capability for origin and cache lookup. Direct unsigned paths fail. S3 reads are restricted to the CloudFront distribution. A copied capability remains usable until expiry, with a maximum 120-second revocation bound. This is an access capability, not DRM.

The output manifest must contain relative, session-local URIs. Real-provider acceptance must inspect Daily's generated master and variants and confirm that both a browser and the native player load segments through the protected prefix. Absolute provider URLs must never be exposed as a workaround.

## Required account configuration

1. Deploy the generated stack in the intended AWS account and region, using Daily's confirmed AWS principal and external ID. There is no account identity or credential in this repository.
2. Generate a random signing key outside source control. Put it in the dedicated CloudFront KeyValueStore as `signing:<key-id>`. Put the same value in the protected Supabase `LIVE_CDN_SIGNING_KEY` secret. Set `LIVE_CDN_KEY_ID` to that key ID. Keep the prior key for at least 120 seconds when rotating.
3. Configure the stack outputs as `LIVE_HLS_BUCKET`, `LIVE_HLS_REGION`, `LIVE_HLS_ASSUME_ROLE_ARN` and `LIVE_HLS_CDN_ORIGIN`.
4. Configure `DAILY_API_KEY`, the Daily domain UUID, a base64 webhook HMAC secret, and an independent random `LIVE_PLAYBACK_SIGNER_SECRET`. Set `LIVE_PLAYBACK_SIGNER_URL` to this project's `live-sign` Edge endpoint. Register the signed Daily webhook for the five streaming lifecycle events. The handler verifies the signed creation test before acknowledging it.
5. Verify an actual camera broadcast, a guest-camera scene, screen sharing, four HLS renditions, reconnect recovery, recording finalization, clip export and stop confirmation before enabling broadcast admission.

No signing key, provider key or URL bearer capability belongs in logs or deployment artifacts. The generated stack intentionally denies viewing until its key store and signer are configured.

## Cache and retention

Manifest cache lifetimes cap at two seconds. Segments share a cache by the immutable source path after authorization. Browser responses receive `private, max-age=1`, preserving the short authorization bound even while the CDN reuses internal cached bytes. Error caching lasts one second. Stream UUID and provider instance UUID prevent cross-broadcast reuse.

The bucket retains objects on stack removal. Abandoned multipart uploads expire after one day, and superseded versions expire after seven days. Current replay deletion must use the application's authorized erasure workflow. This package does not silently delete active recordings.

## Capacity acceptance

Run `node tools/performance/live-capacity.cjs tools/performance/live-five-million-scenario.json` from the repository root. This is an explicit planning scenario, not measured capacity. Five million registered users is separate from simultaneous live viewers. Replace the scenario with the agreed workload, then supply real measurement evidence as the second argument. The gate rejects missing provider reservations, authenticated playback throughput, chat fanout, worker capacity, regional tests, failure recovery and the 24-hour soak.

## Verified locally

- The signer and the actual CloudFront viewer function accept the same capability and strip it only after authorization.
- Expired capabilities, unknown keys, foreign sessions, traversal and direct object paths are rejected.
- HLS clipping snapshots preserve exact boundaries and reject rolling windows whose absolute timeline cannot be established.
- FFmpeg produces and decodes horizontal and vertical MP4 clips, with faststart metadata, audio, reviewed subtitles, watermark and a chosen thumbnail.

These checks do not establish deployed AWS compatibility, Daily account capability or five-million-user throughput.

## Primary references

- https://docs.daily.co/docs/guides/features/live-streaming/hls
- https://docs.daily.co/docs/guides/features/recording/custom-s3-storage
- https://docs.daily.co/reference/rest-api/webhooks
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-javascript-runtime-10.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-custom-methods.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cloudfront-keyvaluestore.html
