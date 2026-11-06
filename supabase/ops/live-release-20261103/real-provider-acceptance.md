# Live broadcast, protected playback and native acceptance

## Current evidence and scope

The acceptance preparation is ready. Actual broadcast and physical device acceptance remain unperformed in this workspace. The evidence file `evidence/live-native-readiness.json` records the local results and limitations. This procedure uses the deployed application contracts and ordinary test users; it does not certify capacity for five million users.

The local host is Linux x86_64. It has Node, Java, ffmpeg and ffprobe, but no connected device interface, Android SDK/emulator, Xcode/iOS simulator, Maestro, USB bus or KVM. Consequently, an iOS or Android device result cannot be produced here. A custom native application build is required; Expo Go does not contain the Daily native SDK and ReplayKit extension.

The existing `prepare-native-ui.cjs` overlay installs synthetic fetch/WebSocket transport for its QA navigation fixture. Its results are useful UI regression evidence, but they do not demonstrate a real Daily broadcast, AWS write, camera capture or protected CDN playback. Do not run that overlay in the real-provider test build.

## Prerequisites and bounds

The release operator must establish these conditions before using a hosted test:

1. The expected Daily domain and HMAC webhook are installed and verified; real webhook events must control the session lifecycle. The Daily role assumption and S3 write check must pass. Provider billing or account permission failures must be resolved through the owner’s normal account controls.
2. The configured CDN capability verifier, signer and bucket protection pass the existing acceptance checks. Raw S3 and unsigned CDN paths must remain inaccessible.
3. The actual clip renderer is deployed, can receive an authenticated job, and can write its private output through the existing worker protocol. Application and worker gates are intentionally configured by the operator for the chosen test environment. This procedure neither changes nor bypasses those gates.
4. Use three distinct, active, ordinary application accounts: **host**, **invited viewer**, and **uninvited outsider**. A fourth account is needed to test a separate guest camera/co-host. Do not substitute an administrator or service-role credential for any of these users.
5. Sign in through normal application authentication. Store any CLI test-user access tokens in an operator-controlled file readable only by its owner. Do not paste tokens, keys or signed media URLs into chat, screenshots, receipts or Git. The helper does not refresh expired user sessions.
6. Have an installed custom QA/release build of this exact source on one physical iPhone and one physical Android device, plus a separate viewing device/browser. Record source commit, app build, OS version and device model. Device installation, signing and distribution remain an operator task; this preparation does not distribute a build.

Use one invite-only session, one host and at most one guest on stage. Keep the first broadcast under five minutes; stop and record a blocker if the ready clip or provider lifecycle cannot be confirmed in that window. Queue one clip at a time. This is a functional canary, with no load generation, broad audience, gifts or external social publication.

## Reproducible audiovisual source

Create the local fixture:

```bash
node supabase/ops/live-release-20261103/prepare-live-e2e-fixture.mjs \
  --directory /absolute/scratch/parent
```

The command performs no authentication, upload or provider calls. It generates a 150-second H.264/AAC MP4 with moving video, an elapsed clock and short audio chirps every five seconds, a WebVTT source caption file, and clip specifications for 15, 30, 60, 90 and 120 seconds. The manifest records SHA-256 hashes and ffprobe output. Keep the generated video outside Git.

The fixture generated during this preparation is at `/workspace/scratch/4c1d55b8bab6/platinum-live-e2e-bspk32/source.mp4`; its companion `fixture.json` records the file hashes. Recreate it if that transient path is unavailable. Play it in a shared window for screen capture, or point the physical test camera at its moving clock. Start source playback when the broadcast starts and record any offset. The clip range is relative to the actual recorded session, so use the backend’s available bounds and the observed clock rather than assuming the source and recording start in the same frame.

## Bounded real-provider sequence

### 1. Set up the private session

The host creates a Live session with audience **Invite only** and recording enabled. Record only its UUID and non-sensitive title in evidence. Invite the viewer and, if needed, one guest using the normal Team UI. Each invited user accepts their own invitation. Leave the outsider uninvited.

Before any broadcast, confirm that the viewer can open the session and the outsider cannot. Camera/microphone permission prompts must arise from the user’s studio action. Denying permission must keep capture off and provide a clear recovery path. Backstage entry must not automatically publish a public live stream.

### 2. Start and watch actual live media

On the host device, open **Studio → Enter backstage**, enable the microphone and camera deliberately, confirm the preview, then press **Go live**. Start the synthetic source clock. If testing a guest, invite the guest backstage, select the guest’s camera in the appropriate layout and confirm both sources in the viewer’s resulting stream.

Record the server-confirmed state transition to `live`, its start time, and the provider event receipt through existing operator evidence. The viewer must receive HLS from the CDN; an ordinary viewer must never join a Daily stage room. Verify moving video and audible chirps on the separate viewer. Measure startup time and the observed source clock delay, but do not use a single sample as a latency service-level claim.

If the provider rejects start or never produces a real playable manifest, stop the attempt and retain the sanitized error/state evidence. Do not mark the broadcast accepted from a successful button press or a mock fixture.

### 3. Create and verify a clip while still live

Wait until `live_clip_context.available_end_ms` covers the chosen range. The service deliberately excludes the most recent five seconds; the 15-second fixture specification uses 10–25 seconds, so it requires at least 25 seconds of available recording. The operator uses the normal clip editor to submit that specification, including both formats, its title/caption/tags, cover at five seconds relative to the clip, watermark/brand and the two relative subtitle cues.

Wait for the real worker result using the existing UI. A queued/processing row is not a rendered acceptance result. If ready, publish the clip as a **replay highlight** inside this private session. This publication is required for the invited viewer to read it: an unpublished creator draft intentionally remains private to its creator/managers. Do not post the acceptance media to a public feed or social platform.

While the session is still `live`, run the read-only helper below with this clip ID. In addition, play both actual exported versions, inspect the selected cover, compare the first/last clock and chirps with the intended range, and inspect captions near both relative cue times. Record actual dimensions, duration, codec and audio presence from the downloaded files. A ready state, MP4 header or successful ffprobe alone does not certify visual/audio correctness.

### 4. End, replay and clip again

Press **End broadcast**, leave backstage and confirm capture stops. Wait for the server to report `ended` and `replay_available=true`. The replay HLS media playlist must contain `EXT-X-ENDLIST`, and replay must visibly seek and play at the selected positions.

Create a new 30-second clip after `ended_at`. Publish it as a private replay highlight, wait for its real rendered result, and run the helper with `--phase replay` and this new clip ID. The helper rejects a clip whose creation precedes the session’s end, so this produces separate evidence for live and post-stream clipping.

Create any remaining 60-, 90- and 120-second test clips sequentially within the recorded available bounds. Reuse the generated specifications after accounting for the recording/source start offset. Check each actual export’s start/end, cover, captions, audio, vertical/horizontal framing and title/caption/tags. A 120-second clip is the longer-highlight acceptance case; the product’s ten-minute limit is a separate boundary test, not asserted by this 150-second fixture.

### 5. Revoke access

The host removes the viewer from the private session through the normal Team UI. Keep the same viewer signed in. Run the helper with `--phase revoked` and a ready private highlight. New session, playback and clip requests from that viewer must be denied, while the host retains access; the outsider remains denied.

Existing stateless CDN and storage grants can remain usable until their short expiry (up to 120 seconds). Verify that the open application handles the access-change event and stops/clears the player, and that a new grant cannot be minted. Do not claim that an already-issued capability becomes invalid immediately. After expiry, a copied capability must fail; never save the capability itself in evidence.

### 6. Clean up

End the broadcast even if an earlier step fails, leave all stage participants, stop operating-system screen capture and remove test invitations. Use authorized application controls to remove the fixture clips/session when evidence is complete. Do not manually delete unrelated storage objects or modify provider domain settings. The release operator owns any provider-room/recording cleanup and restoring acceptance gates. Record cleanup confirmation independently from the acceptance result.

## Read-only ordinary-user verifier

File: `verify-live-user-journey.mjs`.

Supply a regular file owned by the invoking user with permissions `0600` or stricter. Its contents must provide:

```text
SUPABASE_ANON_KEY=<publishable key or legacy anon JWT>
LIVE_E2E_HOST_ACCESS_TOKEN=<host ordinary access JWT>
LIVE_E2E_VIEWER_ACCESS_TOKEN=<different viewer ordinary access JWT>
LIVE_E2E_OUTSIDER_ACCESS_TOKEN=<different uninvited ordinary access JWT>
LIVE_E2E_CDN_ORIGIN=<exact configured HTTPS origin>
```

The helper accepts only the existing QA and production project references. User tokens must have an authenticated role, distinct user IDs, an active session ID and at least three minutes remaining. The server independently verifies them. Never use a service-role, Daily API, webhook, signing or worker credential.

```bash
node supabase/ops/live-release-20261103/verify-live-user-journey.mjs \
  --project-ref uaulhuelcfkjwojtymmw \
  --session-id <private-session-uuid> \
  --clip-id <ready-private-highlight-uuid> \
  --phase live \
  --env-file /protected/test-accounts.env \
  > /protected/live-user-acceptance.json
```

Use `--phase replay` with the separate post-stream clip, then `--phase revoked` after the viewer is removed. Production’s exact reference is `prlkikhckbifseosbukl`; choosing it does not change any authorization or gate. The operator chooses the authorized environment explicitly.

The helper makes at most 40 requests with an eight-second deadline per request, no retries or polling, and bounded response bodies. It calls only `/auth/v1/user`, `live_session`, `live_clip_get`, `live-playback`, `live-clip-media` and validated media URLs. Those grant endpoints may write their normal access/audit records; the helper does not perform session, provider, invitation, publication or clip lifecycle mutations. It never calls `live-stage`, `live-control`, `live_command` or `live_clip_command`.

Successful live/replay runs have 21 probes; revoked runs have 23. They verify user identity, private-session ownership/phase, authorized access, outsider/anonymous denials, an actual HLS media sample, unsigned/tampered CDN denial, ready clip creation phase and byte samples for both videos, cover and captions. The replay requires a finalized media playlist. The helper does not decode full media or use a physical device. All receipts explicitly mark audiovisual/device/capacity acceptance as unverified. Exit codes are `0` for all probes passed, `1` for acceptance failure and `2` for invalid inputs. Inspect and retain a failure; do not repeatedly retry an active provider stream without diagnosing it.

## Physical iOS and Android acceptance matrix

Run these on physical devices with the real provider transport. Record each row as passed, failed or blocked, its timestamp, build/OS/model, and a short observation. Keep account addresses, raw serial numbers, access tokens and private signed URLs out of evidence.

| Check | iOS procedure | Android procedure | Acceptance evidence |
| --- | --- | --- | --- |
| Camera and microphone | Allow, deny, then recover through normal system settings; enable front/back camera and mute/unmute in Studio. | Same, including runtime permission revocation while the app is backgrounded. | Preview and remote HLS capture agree; denial never silently activates capture; recovery creates one active capture session. |
| Guest camera and layouts | Join as the separate invited guest; host chooses host/grid/interview and guest source. | Repeat with Android as guest/host. | Actual remote composition changes; an uninvited user cannot obtain stage publishing permission. |
| Screen/game capture | Tap Share screen or game; exercise the real ReplayKit broadcast picker and countdown, cancellation, start and system Stop Broadcast. | Exercise the real MediaProjection consent dialog, cancellation, foreground notification and system stop action. | Only intentional consent starts capture; viewer sees changing source pixels; stop/cancel clears sharing state without a frozen active indicator. |
| Camera during screen capture | Switch host camera and mute/unmute while screen capture is active, then stop the share and return to camera layout. | Same. | Remote layout/source transitions remain correct; camera/microphone are not left capturing after leaving backstage. |
| In-app minimize | Open a Live session, watch HLS, minimize and navigate away, then reopen the player. | Same. | One persistent player, moving clock/audio continue, expansion does not create another playback session. |
| System Picture in Picture | Enter system PiP from the native player, go Home, remain watching beyond a full 120-second grant period, then return. | Enter supported system PiP, leave the app beyond 120 seconds, then return. | Actual system PiP window plays; grant refresh/recovery is observed on the device; no permanent stale/black player or duplicate audio. If the OS suspends the app, record that result explicitly. |
| Background, interruptions and handoff | Lock/unlock, background/foreground, incoming call interruption, then open an in-app call while Live plays. | Same with audio focus change and foreground service visibility. | Permission/capture state and one-owner audio/video behavior remain correct; returning refreshes expired authorization. |
| Revocation/logout/expiry | Remove viewer access on another account, then log out on the viewer device; separately test returning after a grant expires. | Same. | Access-change/logout clears the player; revoked users cannot get new grants; valid users recover on return without exposing an expired URL. |
| Clips and device sharing | Play both exports, inspect captions/cover, invoke the OS share sheet and cancel, then save one copy locally through the supported export flow. | Same, including storage space/error feedback where safely reproducible. | Genuine decoded media and expected framing; cancellation does not create a false successful external-post history entry. |

The local disposable prebuild verifies the generated ReplayKit target, bundle identifiers and shared app group; Android media-projection permission/service and PiP activity flag are also present. That establishes configuration preparation only. It does not prove native compilation, code signing, installation, runtime capture, background execution or a particular OS/device’s PiP behavior.

## Evidence to retain

Keep the following sanitized records for the actual canary: source commit and build IDs; fixture hash; session and separate live/replay clip IDs; start/end and clip creation/ready timestamps; webhook-driven state observations; three helper JSON receipts; decoded format/duration and clock/audio observations; physical device matrix; permission/capture recovery results; and cleanup confirmation. Every blocked item must name the concrete blocker. Do not replace an unavailable physical-device or provider result with a mocked test result.

Scaling to five million users also requires measured concurrency forecasts, CDN delivery/error/egress evidence, application and database load tests, queue/renderer capacity and backpressure, regional latency and failure exercises. This small canary validates a real functional path and its access controls; it supplies no measured capacity claim.
