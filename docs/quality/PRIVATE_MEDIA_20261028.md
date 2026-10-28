# Private attachment implementation and release checks

This change adds recipient-only, limited-view image/video sessions on phone and web. It is source-ready for integrated QA; physical camera detection and platform capture behavior still require the acceptance checks below. The native source is prepared, but no compatible new native binary has shipped. The new web flow stays disabled by default while common web, memory-book, story and Discover improvements ship. It is not end-to-end encryption, protection against every external camera, or forensic proof of who leaked an image.

## What the user gets

- A private-view notice before opening. Opening consumes one of the sender's allowed views (one or two); reopening an active request is idempotent. Closing ends that request permanently. A two-view attachment can open one additional new request.
- No save, export, forward, picture-in-picture or fullscreen bypass in this viewer. Image/video content remains within its watermarked surface. Video has explicit play/pause controls so browser autoplay denial does not strand the user.
- A visible, repeated recipient account UUID and viewing-request UUID. Staff can correlate the request with the private audit table. A visible watermark can be cropped, obscured or altered; it does not reliably identify a leak by itself.
- Close and hide on backgrounding, account changes, expiry, reported screenshots, media errors, detected phones, or camera-guard failure. Native OS capture protection stays enabled until the viewer unmounts, including the closed confirmation surface.
- Optional camera guard, with explicit camera permission and an honest description. It detects COCO's `cell phone` class at confidence >=0.65; it does not detect every kind of camera or guarantee that detection beats a shutter. Detection and failure close the viewer immediately when the callback arrives. Analysis runs sequentially, with one second between completed frames, a 90-second setup deadline and a 15-second frame watchdog.

## Access and lifecycle

The database snapshots intended recipients when a new private message is inserted. New group members cannot inherit old private media. Continued group membership, both users' profile state, block relationships, an existing non-anonymous Supabase Auth session, attachment expiry, and the specific viewing request are checked for every new media HTTP request.

`open_private_media` returns only request metadata. `read_private_media` returns an internal canonical object locator to the authenticated proxy; that locator is not a signed URL or a public read permission. `private-media-session` verifies the user, authorizes the request, reads Storage with the service identity, rechecks the grant after Storage responds, and streams only supported image/video types with no-store headers. Tokens stay in headers. Each request is bound to the Supabase `session_id`, not just an account UUID. The old signed-URL consume API is disabled at cutover.

A close arriving before an open creates a closed tombstone without spending a view. A delayed open with that same request cannot resurrect it. Clients capture the original access token for close calls; switching accounts never uses the next person's token. Both viewers reject late opens and late bytes after a close. Web aborts a pending download and revokes its in-memory blob URL; native removes the media view and does not request persistent video caching. Native image responses are also no-store.

An opened grant lasts at most 15 minutes and cannot outlive the attachment's seven-day expiry. Offline close cannot guarantee an immediate server-side revoke: local content hides immediately and the server grant expires at its original deadline. Bytes already delivered to a modified client cannot be taken back. There is no claim that a screenshot, system recording, mirroring session or second camera is universally blocked.

## Camera model and data handling

`shared/privateCameraModel.ts` pins TensorFlow.js 4.22.0, COCO-SSD 2.2.3, the ssdlite_mobilenet_v2 graph and five weight shards by exact byte count and SHA-256. Phone downloads all eight public assets (about 20 MB); web bundles the pinned libraries and verifies the graph/weights before loading. Public assets are fetched from jsDelivr and Google's model host. No account credentials or camera frames are sent to those hosts.

Phone uses Expo Camera to obtain low-resolution JPEG frames, deletes each temporary camera file after handing its base64 bytes to an offline WebView, and runs inference in that local WebView. The generated runtime contains only the public model assets; its CSP denies networking. Its bridge reports ready/detection/failure states only. Web processes its local `getUserMedia` video directly. Neither implementation uploads or persists the camera feed in our service. A device crash can interrupt cleanup of an operating-system temporary camera file; the feature is not a secure-erasure guarantee for compromised devices.

The model is Apache-2.0 licensed; the bundled license is in `docs/licenses/TENSORFLOW-APACHE-2.0.txt`. The source URLs and hashes are retained in the manifest. The compatibility tool validates all eight downloaded assets and runs an actual blank-frame model inference; this verifies loading compatibility, not detector accuracy, latency, energy use or resistance to evasion.

## Conservative original-file cleanup

The erasure queue only enrolls new private uploads and historical attachments that are genuinely opened under the new authorization rules. Migration backfills recipient snapshots and expiry metadata, not the erasure queue. A legacy close-before-open, blocked/expired open, or deletion does not enroll old files. There is no historical mass purge.

A new private message requires its own previously unreferenced upload. Queued paths are reserved against new message/channel/group-avatar/CV references and against replacement Storage writes, including while merely pending. Tombstones remain after deletion to prevent reuse. Cleanup preserves any live ordinary message, unread recipient allowance, active viewing grant, channel reference, group-avatar reference or CV reference. Claims use bounded batches, row locks, per-object advisory locks and expiring two-minute worker leases; the worker rechecks safety before deleting the exact path and completes only its own live lease. A storage failure is retried rather than reported as deletion.

`faststart-video` must stop processing private chat buckets before cleanup starts, and in-flight old remux jobs must drain. Otherwise an old processing job could recreate an object after deletion. Permanent erasure from backups or provider retention systems is outside this worker's promise.

## Credential and deployment order — hold the whole cutover

The current common web release must keep `NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED` unset or `false`. `MessagesApp` gates the new private-view button and viewer on this flag and preserves the existing “Open in phone app” fallback while it is disabled. Shipping the dormant viewer source with common web, memory-book, story and Discover changes does not authorize its activation or the backend cutover. The flag is a public client build setting, not a secret or an authorization control; actual access always depends on the database and Edge authorization checks.

Hold the entire private change set: private migration, `private-media-session`, updated `chat-media-sign`, `faststart-video` exclusion, cleanup worker, credential SQL and cleanup schedule. Do not enable the new web flow or deploy these private backend changes until the compatible native build is available and the cutover is coordinated. Old native clients use the old consume contract and will not open private attachments after the cutover. An OTA-only update cannot add the new `expo-screen-capture` native dependency. Preserve this build boundary while unrelated improvements ship.

1. Build and accept-test the new iPhone/native client. Confirm `expo-screen-capture` and its app-switcher protection actually initialize. Test both normal and optional-guard viewing. Android acceptance remains separate when an Android device/build is available.
2. Once the new native binary is ready and the coordinated cutover begins, deploy the faststart exclusion and wait for old chat remux invocations to drain. Inventory relevant legacy references, but do not backfill their erasure queue. This exclusion remains held during the earlier common web release.
3. In that coordinated release window apply `20261028150938_private_media_sessions.sql`, deploy `private-media-session` and the updated `chat-media-sign`, and publish compatible native clients. Only after the backend and native readiness checks pass, enable `NEXT_PUBLIC_PRIVATE_MEDIA_SESSIONS_ENABLED` for a compatible web build and publish it. Test recipient/non-recipient access and close-before-open before enabling cleanup. Existing authorization/storage migrations are prerequisites. The two full-history locator indexes can need an appropriate low-traffic migration window on a large database.
4. Run `supabase/ops/setup-private-media-cleanup-credential.sql`. It creates a random dedicated secret inside Vault and only a SHA-256 verifier in a private table. Re-running preserves the existing secret. Do not copy tokens into source, logs, browser scripts or chat. The validator is executable only by `service_role`, and the worker rejects use of the service key as its invocation token.
5. Deploy `private-media-cleanup` with the checked-in `verify_jwt=false` setting. Both new functions use explicit handler authentication; the session function still requires a validated user/session, and cleanup requires the separate Vault credential. These are not anonymous endpoints.
6. Confirm one `project_url` Vault secret contains the exact project HTTPS origin, then run `supabase/ops/install-private-media-cleanup-cron.sql`. It verifies unique secrets, validates the credential digest and schedules a bounded minute worker. Do not enable the schedule before all prior gates pass.
7. For rollback, disable the cleanup cron first, stop new private opens, disable the web flag in a rebuilt web release as appropriate, and preserve closed grants and erased-path tombstones. Do not revive old signed URL consumption or imply erased media can be recovered by a UI rollback.

## Verification

Automated checks execute the actual migration and credential SQL in PGlite, exercise the Edge handlers with controlled authorization/storage dependencies, and run the shared native/web session coordinator through delayed-response races. They cover recipient/session isolation, group membership changes, block/deactivation/revocation, expiry, consumed limits, close-before-open, original credentials after account change, proxy range/input checks, server recheck after delayed Storage response, live-reference preservation, replacement reservations, legacy queue enrollment, lease completion, credential hashing and native capture-lease overlap/failure.

Run:

```sh
node --test tests/private-media-session.test.cjs tests/private-media-cleanup.test.cjs tests/private-screen-capture.test.cjs supabase/tests/private-media-session-db.test.cjs supabase/tests/private-media-credential-db.test.cjs tests/quality/chat-media-signer.cjs
node tools/verify-private-camera-model.cjs /path/to/the/eight/downloaded/model/assets
```

Physical/browser acceptance must include: real phone detection and false positives; slow model downloads; denied/revoked permissions; detector hangs; screenshot/screen recording/app switching; OS backgrounding during each open/download/decode phase; sign-out and account switching; network loss on close; repeated taps; a second device trying the same grant; guard enabled on low-memory phones; video autoplay denial and replay; no camera tracks after close; visible watermark readability; and removal of consumed originals without deleting ordinary, channel, avatar or CV content. A successful blank-frame model run and TypeScript checks do not replace these tests.
