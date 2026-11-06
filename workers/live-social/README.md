# Optional direct clip publishing

This package is an executable pull worker for explicit creator-approved video posts. It uses the durable queue in `20261103061323_live_direct_social_publishing.sql` and the `live-social-worker` Edge broker. It does not use a user's browser session or a ChatGPT connector login. All platform admission gates start off.

## Creator flow

The web clip library and clip detail page link to `/live/clips/<UUID>/publish`. The creator chooses a platform, loads the real connected account and latest publishing options, previews the selected clip rendition, edits the post details, and explicitly confirms the post. YouTube visibility and child-audience status have no defaults. TikTok visibility, interactions, music confirmation, commercial disclosure and AI-content flags are explicit controls. The server verifies clip ownership/team authority, an active Auth session, approval/copyright clearance and a public source audience.

`/live/connections` starts scoped OAuth through `live-connect`; the exact redirect is `https://platinumcircles.app/live/connections/callback`. Native handoff opens these fixed web routes and may require browser sign-in. No session token or OAuth code belongs in a handoff URL. The native handoff is not an embedded native publishing form.

`/live/clips/<UUID>/captions` requests optional Amazon Transcribe drafts and requires explicit review before applying subtitles and queuing a new render. Its executable worker and infrastructure are separate under `workers/live-transcription` and `infrastructure/live-transcription`.

Existing clip `share` and `retry_post` actions continue to record `export_required`. A device export is never labeled as a confirmed external post. Direct requests use `live_social_command` and show their own durable history.

## Implemented provider paths

| Platform | Publishing sequence | Initial scope and limits |
| --- | --- | --- |
| X | v2 media initialize, bounded append segments, finalize, processing status, then one `POST /2/tweets` | Reviewed caption, video rendition, current grant with `media.write` and `tweet.write`; account/API media limits still apply. |
| Facebook | Page Reels start, private file URL upload, processing status, one finish, then publishing-state verification | Eligible Page, vertical video from 4 to 60 seconds in this release. |
| Instagram | Professional-account Reels container from private file URL, wait for `FINISHED`, one `media_publish` | Professional account linked to an eligible Page through Facebook Login; consumer Instagram accounts are unsupported. |
| YouTube | Confirm exactly one OAuth-owned channel matches the connection, initialize one resumable upload, bounded chunks, preserve the session URL for status/reconciliation | Vertical clips up to 3 minutes; explicit visibility and made-for-children status. YouTube decides Shorts classification. A returned channel ID must match the selected channel. |
| TikTok | Query current creator controls, initialize `PULL_FROM_URL`, then query publishing status | Server-hosted media must use an app-verified first-party origin. The clip must have no platform-added watermark, fit the current account's duration limit, and be at most 128 MiB for this bounded proxy path. |

TikTok `FILE_UPLOAD` is deliberately not used by this server worker. Current TikTok guidelines reserve that transfer for device-resident media and require URL pull for server-hosted files. Its unaudited API mode has private-account/private-post and small creator limits; broad public use requires the Content Posting audit and an approved creator quota.

## Credentials and approvals genuinely required

These are operator configuration requirements, not credentials already available in this repository:

| Provider | Registration, review and creator authorization |
| --- | --- |
| X | An X developer application with appropriate API access, confidential OAuth 2.0 code flow, the exact callback above, and creator consent for `tweet.read tweet.write users.read offline.access media.write`. Verify the application's current API and upload quotas before enabling admission. |
| Meta | A Meta application with Facebook Login, approved relevant permissions/advanced access and any required business verification for external creators. Facebook needs `pages_show_list pages_read_engagement pages_manage_posts`. Instagram additionally uses `instagram_basic instagram_content_publish` and an eligible Page-linked professional account. Each creator chooses only a provider-returned Page/account. Complete Meta's required privacy, data-deletion and app-review setup in the actual application before public activation. |
| Google/YouTube | A Google Cloud project with YouTube Data API enabled, an OAuth web client, exact authorized callback and consent-screen/domain verification. Scopes are `youtube.upload` and `youtube.readonly`. Complete the actual application's OAuth verification and quota/compliance requirements for its intended audience. One user must authorize the specific channel. |
| TikTok | A TikTok developer application with Login Kit and Content Posting `video.publish`, approved scopes `user.info.basic,video.publish`, the exact callback, creator OAuth consent, Content Posting audit for public distribution and verified domain/URL ownership. The application is intended for Platinum Circles creators, not an internal account-upload utility. |

No generic social connector login substitutes for those app registrations or creator grants. No live platform publishing call has been used to validate these modules; provider request tests are local contract fixtures. Provider approvals, actual OAuth acceptance and a deliberately approved test post remain activation gates.

Edge environment names:

- `LIVE_SOCIAL_REDIRECT_URI`: exact canonical callback above.
- `LIVE_X_CLIENT_ID`, `LIVE_X_CLIENT_SECRET`.
- `LIVE_META_CLIENT_ID`, `LIVE_META_CLIENT_SECRET`, `LIVE_META_GRAPH_VERSION` (a currently supported explicit `vNN.N`; no guessed default).
- `LIVE_YOUTUBE_CLIENT_ID`, `LIVE_YOUTUBE_CLIENT_SECRET`.
- `LIVE_TIKTOK_CLIENT_ID`, `LIVE_TIKTOK_CLIENT_SECRET`.
- `LIVE_INTEGRATION_VAULT_KEY_ID` and `LIVE_INTEGRATION_VAULT_KEYS`: active key ID and a server-only JSON map of up to three 32-byte base64url AES keys. Retain old keys during rotation until old envelopes are migrated or connections are reauthorized.
- `LIVE_SOCIAL_WORKER_SECRET`: a dedicated high-entropy server bearer, separate from renderer/transcription/provider-operation credentials.
- `LIVE_TIKTOK_VERIFIED_ORIGIN`: set to the exact callback origin only after that domain is verified in the actual TikTok application. It is absent by default. The gate still remains off until the proxy is accepted.

OAuth states are hashed, single-use, ten-minute records bound to the initiating user and Auth session. X and Google use S256 PKCE; TikTok's supported web flow uses its confidential code exchange. Tokens and upload checkpoints are AES-GCM envelopes bound to purpose, creator, connection/job and platform; the token payload also binds the selected external account. Tokens never appear in creator RPC responses. Rotating refresh tokens use a database lease/version compare-and-swap. An ambiguous refresh exchange requires reconnecting instead of retrying a potentially consumed refresh token. Disconnect deletes stored credentials, invalidates in-flight jobs and prevents subsequent provider work; creators can also remove the app grant in the platform's own account settings.

## TikTok first-party pull

`web/next.config.ts` externally rewrites only:

`/api/live/social-pull/<job UUID>/clip.mp4?token=<opaque capability>`

to `live-social-pull` in the configured Supabase project. The public URL stays on `platinumcircles.app`; there is no redirect to a Supabase URL and no Vercel Function buffering the video. This route skips cookie-session middleware because its dedicated capability is the authorization mechanism. All other routes retain their existing middleware behavior.

The broker creates one stable encrypted capability per TikTok publication, with a 70-minute expiration. This covers TikTok's documented one-hour download window after initialization. The capability is not an Auth token, provider access token, or worker credential. The database resolver checks current source rights, render revision, connected account and creator Auth session on every request and again before first byte. It permits at most 32 HTTP requests and 8 requests per minute per job. Closing the local request, disconnecting, changing copyright/source rights, deleting the Auth session, disabling admission or expiry denies new downloads.

The endpoint streams only the exact private vertical MP4, supports HEAD and single-byte ranges, verifies Storage version and length, rejects redirects/oversized responses and cancels upstream on disconnect. It reuses the existing media-content streaming implementation. `Cache-Control`, `CDN-Cache-Control`, `Vercel-CDN-Cache-Control` and the rewrite-caching switch prevent shared caching. Never log capability URLs or add them to analytics. A download already accepted by an external platform cannot be recalled by removing local access.

Vercel documents a 120-second external proxy timeout. This implementation ends a request at 110 seconds and caps files at 128 MiB. The 70-minute capability lifetime permits the provider to retry within its one-hour fetch window; it is not a claim that one connection can run for an hour. Validate a realistic maximum-size clip through the actual proxy before enabling TikTok. A slow or unsupported transfer fails without claiming publication. Larger exports remain available for device posting.

TikTok domain verification is completed in the app's URL properties, preferably with the actual provided DNS verification value. This code does not fabricate or create that value. The allowed origin must also equal the OAuth callback origin.

## Durable execution, retries and stopping

The service claims one job at a time; the database permits at most two active worker leases. Each creator has at most five active/uncertain requests and ten new requests per hour. Credentials/options reads are rate-limited. Jobs expire after 24 hours or 100 claims. Each worker operation has a 110-second deadline, individual network limits, private temporary files and a 512 MiB media cap for non-TikTok transfers. Idle polling is approximately once a minute; outages back off from 15 seconds to five minutes with jitter. SIGTERM/SIGINT interrupts work, with a separate five-second budget to record a known receipt or conservative failure. No provider payloads, tokens, URLs or captions are logged.

Every external request rechecks current source/account/lease authorization. The worker persists a checkpoint before create/final-publish requests. Safe processing/status calls can retry with backoff. An uncertain irreversible request becomes `confirmation_required`; it is never automatically submitted again. YouTube can recover a lost final acknowledgement through the same resumable session. TikTok can inspect its saved publish ID. Facebook verifies its saved video ID and never repeats an accepted finish. X and an Instagram container with an unrecoverable media ID require checking the provider account. The creator can explicitly close a checked local request; this does not delete an external post.

The queue marks a job `published` only after a real provider receipt. A success received while source rights are being revoked remains an honest receipt with `revoked_after_dispatch`; it does not create another media grant. A receipt lost before durable completion is reported as uncertain instead of guessed. Permanent format/account rejection may require changing the clip or reconnecting and submitting a new confirmed request. A UI retry does not override an uncertainty fence.

## Building and activating the service

`infrastructure/live-social/service-template.mjs` generates a separate Fargate service. It defaults to zero tasks; the template does not enable a database integration. It requires existing reviewed VPC/subnets, ECR repository, image digest, exact dedicated broker Secret ARN and its KMS key. The execution role can pull that repository, read only that secret through its key's encryption context and write its log group. The running code has no AWS task role, inbound listener, container capabilities or writable root filesystem. Scratch video files use mode 0600 and are deleted after every attempt.

1. Apply the reviewed optional foundation and direct-publishing migrations with all gates off. Deploy `live-connect`, `live-social`, `live-social-worker` and `live-social-pull` from the same reviewed source. Deploy the web rewrite and creator screens.
2. Provision the vault and dedicated broker secret through the owner's approved secret-management process. Do not print or put values in source files. Install the same broker bearer in the exact AWS secret and Supabase Edge secret.
3. Package the reviewed source with `python infrastructure/live-social/package-source.py`. The dedicated build specification resolves official `node:24.22.2-alpine3.24` for AMD64, verifies the version and builds only from the resolved immutable digest. Its final image has no FFmpeg, application dependencies, npm, Yarn or build toolchain. It runs offline container tests, records Node/OpenSSL/Undici and OS-package versions, and publishes only after those checks pass. The exact shared CodeBuild overrides and owner scan gate are documented in `infrastructure/live-social/README.md`. No container build or scan is claimed from local source tests.
4. Generate the service template with `node infrastructure/live-social/service-template.mjs`, validate it, and create the reviewed service with `DesiredCount=0`. This package creates no OAuth app or social post.
5. Complete actual provider registrations, approvals and approved callback/domain configuration. Enable only the reviewed platform's OAuth connection gate for a controlled creator. Complete that creator's OAuth consent and verify the returned account identity.
6. Start one worker only after its broker/health/receipt checks pass. Keep each `publishing_enabled` gate off until provider quota, media delivery and deliberate test-post acceptance are approved. Enable one destination at a time. Verify publish receipt, uncertainty recovery, disconnect/source revocation and no token leakage before a wider rollout.
7. For rollback, disable the destination's publishing gate, stop the Fargate service and inspect unresolved requests. Do not reset uncertain jobs to `initial`. Remove external posts only through an explicit creator/provider operation.

The initial two-lease cap is a guarded rollout setting. It is not a five-million-user throughput claim. Direct-post volume must be admitted against each platform's app/creator quotas and a measured queue/egress budget; viewer scale remains on the existing CDN path. Increasing publisher workers alone cannot bypass provider quotas.

## Focused local verification

```sh
node --test workers/live-social/test/publishing.test.mjs
node --test supabase/tests/live-social.test.cjs supabase/tests/live-social-pull.test.cjs
node --test supabase/tests/rpc-authorization/test-live-social-publishing.mjs
node --test web/tests/live-connections.cjs web/tests/live-optional-flows.cjs
node --test infrastructure/live-social/test/service.test.mjs
```

All provider interactions in these tests are explicit synthetic fixtures. SQL tests execute the actual migrations and permission checks in isolated PGlite. They do not demonstrate provider approval, successful production OAuth, a real social post, or five-million-user load.

## Primary specifications checked

- [X authorization-code flow](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [initialize](https://docs.x.com/x-api/media/initialize-media-upload), [append](https://docs.x.com/x-api/media/append-media-upload), [finalize](https://docs.x.com/x-api/media/finalize-media-upload), [processing status](https://docs.x.com/x-api/media/get-media-upload-status).
- [Meta's official Facebook API workspace](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [Instagram Reels container](https://www.postman.com/meta/instagram/request/5kkpkh6/upload-a-reel-to-an-ig-container), [publish Reel](https://www.postman.com/meta/instagram/request/gabnx7r/publish-reel).
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [YouTube resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [video insertion](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [owned channels](https://developers.google.com/youtube/data/reference/rest/v3/channels/list).
- [TikTok Login Kit web](https://developers.tiktok.com/docs/en/login-kit-web), [token lifecycle](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [direct posting](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [publishing status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status), [content-sharing requirements](https://developers.tiktok.com/docs/en/content-sharing-guidelines), [verified URL media transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide).
- [Vercel external rewrites and cache controls](https://vercel.com/docs/routing/rewrites), [proxy timeout](https://vercel.com/docs/limits#proxied-request-timeout), [Supabase Edge runtime limits](https://supabase.com/docs/guides/functions/limits).
