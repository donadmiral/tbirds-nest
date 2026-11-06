# Live CDN delivery acceptance

These tools verify the deployed signer, CloudFront authorization and private S3 origin using an isolated three-second HLS fixture. They do not create a Live session, call Daily, change feature gates or measure production capacity.

## Prepare a fixture

Run with the actual private stack bucket and region:

```sh
node supabase/ops/live-release-20261103/generate-live-cdn-fixture.mjs \
  --bucket <private-live-bucket> \
  --region us-east-2
```

The generator requires local FFmpeg with H.264 and AAC support. It writes a small HLS master, media playlist and three segments beneath a new scratch directory, then decodes the full stream locally. The fixture uses fresh session and instance UUIDs. Its `fixture.json` contains the exact object keys, local paths, sizes, SHA-256 hashes, 32-byte range hashes and upload headers. It contains no credentials or playback capabilities.

Upload exactly the listed files to their `storage_path` values, preserving `content_type` and `cache_control`. Keep the bucket private. When versioning is enabled, retain the returned version IDs for precise cleanup.

## Verify deployed delivery

```sh
node supabase/ops/live-release-20261103/verify-live-cdn.mjs \
  --project-ref <supabase-project-ref> \
  --env-file <protected-existing-env-file> \
  --fixture-file <scratch-fixture-directory>/fixture.json
```

Use Node.js 22.6 or later. The existing `verify-live-secrets.mjs` configuration loader enforces an owner-only regular secret file, refuses symlinks, and validates the five existing Live configuration values. Secret values belong in that protected file, not in command arguments. The CDN helper never reads the media `local_path` values and never follows redirects.

For the generated five-file fixture, a passing run makes 20 requests across 15 bounded probes:

| Probe group | Evidence required |
| --- | --- |
| Signer | Authenticated signer returns the exact locally expected capability and expiry, with caching disabled. |
| HLS | Master, relative media playlist and all three segments have their expected sizes and SHA-256 hashes. Relative child URLs preserve the capability prefix. |
| Delivery | HEAD has the expected length and range support. A 32-byte Range request returns 206 and the expected bytes. Authenticated OPTIONS permits the intended read headers and methods. |
| Shared cache | The same segment requested with two distinct valid capabilities reaches the same CloudFront point of presence, and the second response reports a cache hit. |
| Authorization | Unsigned, corrupted, expired, overlong, wrong-session, unknown-key, wrong-instance and write-method requests return 403. Scope checks use the existing fixture object so a missing object cannot produce a false pass. |
| Private origin | An unauthenticated request to the same S3 master object returns 403. |

Each probe has an eight-second deadline and bounded response size. An unusable signer or HLS fixture stops the run early. Other failures are collected in the receipt. Output contains only fixed probe labels, status codes, elapsed time, nonsecret fixture identifiers and sanitized failure codes. It never includes a URL, hostname, token, signature, key, raw exception or response body.

Exit status is `0` for acceptance passed, `1` for acceptance failed and `2` for invalid inputs. A cache point-of-presence change or missing cache-hit evidence is a failure to establish that property; the script does not claim success from matching content alone.

## Evidence and cleanup

Save the redacted JSON receipt with the release evidence. Keep the separate upload receipt containing object version IDs. After acceptance, delete only those exact fixture object versions, checking for any delete markers or additional versions within that exact random fixture prefix. Do not remove the source bucket, signing store or any unrelated Live session assets.

Successful synthetic delivery establishes this fixture's signer, authorization, cache and origin path. A real Daily broadcast, playback on supported clients, reconnection, provider webhooks, recording, clip rendering and load acceptance remain separate checks. The receipt explicitly leaves provider-broadcast and measured-capacity verification false.

## Local verification

```sh
node --test supabase/tests/live-cdn-acceptance-helper.test.cjs
```

The local suite uses the actual signer and CloudFront authorization implementations with synthetic keys and an in-memory origin. It checks complete delivery, fail-closed authorization, integrity and range failures, missing shared-cache evidence, credential redaction, redirect and body limits, deadlines, and fixture-path validation. It makes no hosted requests.
