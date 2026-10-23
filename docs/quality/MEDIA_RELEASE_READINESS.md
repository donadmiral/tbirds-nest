# Media and story release readiness

Checkpoint: 23 October 2026. This document records source and test readiness, not a production deployment certificate.

## Deployment unit

Apply the branch's full migration chain in timestamp order. These media dependencies must be present together:

1. `20261022211259_platinum_story_editor_and_hiring.sql`: atomic/idempotent story publication and editor payload validation.
2. `20261022211311_story_sound_rights.sql`: original-sound permissions and rights state.
3. `20261022211400_creator_product_entitlements.sql`: caller-bound creator subscription access checks.
4. `20261022211648_content_media_manifests.sql`: owner-bound object registration and audience-specific manifests. The release coordinator reports this migration already applied to QA; subsequent database changes belong in a new migration.
5. `20261023190047_content_owner_upload_previews.sql`: owner-only previews before a post or story exists.
6. `20261023190601_platinum_storage_bootstrap.sql`: create missing upload buckets, constrain old permissive object policies, and preserve existing bucket visibility.

Deploy `content-media-sign` with the matching clients. Its `references` mode uses the caller's JWT to authorize posts, stories, highlights, memory albums, drafts and sounds. Its separate `uploads` mode authorizes actual storage ownership. The service role only signs objects returned by these manifests. Neither URL possession nor a client-supplied entity ID grants access.

Deploy `apple-music` for Apple catalog search and web MusicKit tokens. This can be disabled independently of original voiceovers and the rest of story publishing.

## Storage bootstrap finding

A read-only production metadata check found only `application-cvs`, `channel-media` and `story-media`. The bootstrap creates missing `post-media`, legacy `media`, `chat-media`, `chat-files`, `avatars` and `market-media`; it also works on an empty storage setup when the preceding channel/CV migrations are applied. Existing buckets retain their visibility and limits. New content and chat buckets are private. Avatars and marketplace catalog images intentionally remain public presentation assets.

Content buckets receive restrictive owner-only direct reads, even if legacy broad public SELECT policies remain. Other viewers receive URLs only through the audience-checked signer. Content objects cannot be overwritten/deleted by clients; replacements use a new object name. Chat-specific read, insert, immutable and deletion restrictions are unchanged. Owner upload paths include the marketplace `listings/<actor>/...` convention. Native post uploads now disable upsert.

`storage-bootstrap-db.test.cjs` passed six PostgreSQL/RLS tests: repeated application, preserved settings, valid owner uploads, rejected impersonation/traversal/anonymous writes, restricted direct reads, immutable content, public catalog semantics and chat-policy coexistence. Provider Storage API upload checks remain part of the coordinator's QA deployment.

## Private media rollout

QA coordinator update, 23 October: the matching web build and `content-media-sign` are deployed, and `post-media`, `story-media` and `media` are private in `uaulhuelcfkjwojtymmw`. The corrected cutover audit returned zero rows. A fresh anonymous GET for the existing synthetic story returned HTTP 400 (`NoSuchBucket`); a previously cached GET initially returned 200. This verifies origin denial, not worldwide cache eviction. Signed owner playback and compatible phone acceptance still require an authenticated test. Production visibility was not changed.

No media bucket visibility was changed by the media implementation lane. The manifest migrations deliberately leave `post-media`, `story-media` and legacy `media` visibility untouched. Public buckets bypass the new audience checks, so staging these checks alone does not enforce private or paid media.

Before changing those buckets to private:

- Ship the matching web and phone readers and signer. Older clients using public URLs will no longer load protected media; the mobile release needs an enforced compatible version or an explicit migration plan.
- Run `supabase/ops/check-content-media-cutover.sql`. It lists referenced objects lacking storage or an authorized binding. Inspect any legacy uploader mismatch rather than inventing ownership. The automatic backfill only accepts proven ownership.
- Verify owner upload/draft previews, post/gallery/article images, paid posts, stories, original audio, highlights and memory albums with real QA objects. Verify denied access from an unrelated user, blocked account and expired subscription. Test anonymous direct public-object URLs after the cutover; they must fail.
- Deploy clients, signer and database contracts as one coordinated release. Switching a bucket back to public is not an acceptable recovery path for private content.

The code now hydrates the native and web feed, profile/discover/search/social surfaces (other integration lanes), story viewers and archive, highlights, memory albums, article Markdown image bodies and galleries, story drafts, and Studio planner/content/overview previews. Nested post/card/gallery readers and notification thumbnails are covered by the social lane. Upload previews keep canonical editable values separate from signed render copies, so saving a draft or story does not persist temporary tokens. Reference manifests authorize embedded content separately.

Long-lived readers renew capabilities on foreground/focus or retry. Owner upload preview hooks renew every four minutes and clear on auth changes. Album readers renew and reject late account responses. Story retry obtains a fresh capability. Native story video errors produce a retry state without logging signed URLs.

Signed URLs are short-lived bearer capabilities, not instant revocation. Storage/CDN cache lifetimes are independent of the signing token's expiry, and an already delivered/downloaded object cannot be recalled. Product privacy language must not promise immediate disappearance of bytes after revocation. Critical removal needs object deletion/CDN invalidation in addition to denying future signatures.

## Apple Music boundary

The implementation supports catalog discovery and song-link sharing; web MusicKit supports authorized subscriber playback on approved origins. It does not download, mix or export Apple's catalog into user videos. Native sharing opens the catalog link; this is not a native embedded MusicKit playback implementation.

Required server configuration:

- `APPLE_MUSIC_TEAM_ID`
- `APPLE_MUSIC_KEY_ID`
- `APPLE_MUSIC_PRIVATE_KEY` (private key stored only in server secrets)
- `APPLE_MUSIC_ALLOWED_ORIGINS` (exact HTTPS web origins)

The handler reports `soundtrackAvailable: false`. Apple developer membership and a MusicKit key are not proof of soundtrack/synchronization rights. Original/reusable audio requires `creator_attested` or `licensed` rights state and owner-bound storage. Actual Apple credentials, subscriber playback, storefront availability and commercial soundtrack licensing were not verified by this implementation lane.

## Verification evidence

Behavior and database suites cover owner-only upload manifests, anonymous denial, audience/block/subscription checks, nested permission boundaries, malformed and foreign object URLs, unsigned signer-response rejection, token stripping before persistence, Markdown image replacement, late auth responses, draft/editor behavior, and original-sound publication.

Focused commands:

```sh
node --test tests/quality/content-media-regressions.cjs supabase/tests/content-media-db.test.cjs tests/quality/story-publication-regressions.cjs
node --test tests/quality/apple-music-regressions.cjs supabase/tests/story-publication-db.test.cjs web/tests/story-*-regressions.cjs
node --test tests/quality/upload-preview-regressions.cjs tests/quality/story-viewer-privacy-regressions.cjs tests/quality/memory-media-regressions.cjs web/tests/planner-choice-regressions.cjs
```

The first command passed 46 tests. The final album/owner-preview check passed 12 tests; the earlier preview/story-cache/planner check passed 16. Full web/native/admin gates are recorded by the release coordinator. Unit and local database tests do not establish real-device upload performance, native camera/microphone behavior, Apple subscriber playback or production-scale capacity.
