# Apple Music and original story audio

The integration separates song sharing/listening from soundtrack rights. An Apple Developer membership and MusicKit key allow catalog requests and approved playback. They do not license songs to be extracted, downloaded, mixed into videos, or distributed as story soundtracks.

## Server configuration

Create a MusicKit-enabled Media identifier and associated MusicKit signing key in the Apple Developer account. Configure these as **Supabase Edge Function secrets**, never `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*` values:

- `APPLE_MUSIC_TEAM_ID`: Apple 10-character Team ID.
- `APPLE_MUSIC_KEY_ID`: associated 10-character key ID.
- `APPLE_MUSIC_PRIVATE_KEY`: the complete `.p8` PEM value (real newlines or escaped `\n`).
- `APPLE_MUSIC_ALLOWED_ORIGINS`: comma-separated exact HTTPS web origins, without paths or trailing slashes. Add each approved preview origin explicitly. No wildcards.

Deploy the `apple-music` function with JWT verification enabled. It also validates the authenticated user and rejects anonymous accounts. Catalog calls are server-side. The browser receives only a ten-minute ES256 token restricted to its allowed origin. MusicKit handles Apple Music authorization and subscription entitlement; our backend never requests or stores a Music User Token. Playback stops and disconnects on component exit or an observed account change.

When secrets are absent, search/playback return an explicit unavailable state. Members can still share a validated `https://music.apple.com/...` song link. Native clients open approved listening in Apple Music; they do not decode protected audio.

## Surfaces

- Native `AppleMusicSheet`: `visible`, `onClose`, `onSelect(track)`.
- Web `AppleMusicPicker`: `onSelect(track)`; opt-in protected MusicKit playback.
- Web `/music`: catalog search and system sharing, with clipboard fallback.
- Native story `MusicSheet`: optional `onShareTrack(track)` for the composer's link sticker. Song references never become `StoryAudioDraft`.

## Original sound rights

Apply migration `20261022211311_story_sound_rights.sql` before enabling original sound reuse. Existing sound rows start as `unverified`, and cannot be selected for new stories. A newly recorded voiceover requires ownership/participant-permission attestation. Separately opting into public reuse calls `publish_story_sound`, which authenticates story control, validates original voiceover metadata, and creates at most one catalog row per story. Direct client insert/update access is revoked. Rights-reviewed licensed rows can be curated by trusted administration; setting `rights_status = 'blocked'` prevents new selections. Blocking does not recall existing copies automatically and is not a complete copyright takedown system.

## Validation

Run `node --test tests/quality/apple-music-regressions.cjs` and the existing story publication regressions. Real-device recording/playback and a configured Apple test account are required for external acceptance: grant/deny microphone, background during recording, close during permission/start, authorize/cancel Apple Music, play/pause, unavailable regional track, expired token refresh, account switch, denied origin, and successful original sound publication/retry.

Official references:

- https://developer.apple.com/musickit/
- https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens
- https://js-cdn.music.apple.com/musickit/v3/docs/index.html
- https://developer.apple.com/support/terms/apple-developer-program-license-agreement/
