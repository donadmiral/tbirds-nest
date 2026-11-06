# Discover covers and Live foundations, 6 November 2026

## Scope

Behaviour only, on web, phone, admin and database. No layout, colour or component was redesigned. The visible additions are states that were missing: a decoded frame where a video tile showed "Video", a "Reply" action and a reconnecting notice in the web chat, a reaction indicator and admin warnings on the phone chat, a "Leave the live" control for accepted guests, a "Retry guest layout" link after a failed automatic scene, "Press play" when a browser refuses autoplay, and a one-line stage roster in the admin moderation section.

## Discover video tiles

- A video post without a stored cover now paints a real frame at view time on web (`web/components/VideoFrame.tsx`, `web/lib/videoFrames.ts`, `web/lib/videoFrameCache.ts`): decoded from the delivered MP4 through a hidden video element, keyed by the media object rather than the signed URL, two decodes at a time, only for tiles near the viewport, never under data saver, retried after a minute, and discarded when the account scope changes. A stored cover that fails to load falls back to the same frame. The player poster and the search grid use it too.
- Every place that chooses a cover now also reads `edit.thumbnail`, the key a live clip is published with. A migration copies that poster to `coverUrl` for existing clip posts, keeps the cover when a live clip is published, and keeps `edit` on Studio-published posts.
- Planned (Studio) videos capture a first frame at upload, like composed posts do.
- Phone thumbnails wait for a decoder instead of failing at the eleventh tile, and the twelve-second deadline starts when a decoder takes the job rather than at mount.

## Live chat

- Web viewers follow a chat topic rotated by a removal or block aimed at someone else; before, they stayed on the retired topic until a thirty-second poll. History is read after the channel joins, so nothing sent between a snapshot and the join is lost. Without a socket, both apps read the canonical history every twelve seconds, and the web empty state says "Reconnecting to chat…" instead of "Start the conversation."
- The phone shows a sender's own reply from the command result, shows reactions from others and admin warnings, keeps the newest 150 messages whichever way a page came from, stops paging at the bound, and keeps the composer editable while a command is in flight.
- People a viewer blocked are hidden from live broadcasts and pins on both apps, matching the history read.
- A non-follower in a followers-only chat is told to follow (`FOLLOWERS_ONLY`), a closed chat still says closed, an empty message and a reaction on a reconnecting stream get their own words, and the rate limit says to wait. Reactions are offered only while the stream is live.
- Web replies render the line breaks people type, the message list is a polite live region, and a "Reply" action prefills the author handle as the phone already did.

## Joining and the viewer count

- The viewer lease is no longer dropped by a rebuffer or a grant renewal. On web a renewed capability is handed to the running hls.js engine through its loader (`web/lib/livePlaybackRenewal.ts`), so a playing stream is never torn down; a paused or native (Safari) player still rebuilds, and that rebuild is not counted as the viewer leaving. On the phone the source swap during renewal is likewise not a pause.
- A renewal that fails while the grant in use is still valid keeps playing and tries again before the grant runs out, on both platforms. Playback grants stay at 120 seconds: the CDN verifier in `infrastructure/live/viewer-request.js` refuses anything longer.
- Heartbeats run every twenty to thirty seconds so one lost request cannot lapse the ninety-second lease. A closing web tab sends its leave with a keepalive fetch (`web/lib/liveViewerLeave.ts`).
- Before the first frame the web player says "Starting the stream…", and a refused autoplay shows "Press play" instead of a silent black box.
- The viewer count is measured on its own per-minute job as well as at the end of maintenance, so an earlier maintenance failure cannot blank "N watching". Directory cards show the count for reconnecting streams too and refresh their live cards in place every sixty seconds.

## Group live

- A guest can leave the stage (`leave_stage`): the place frees, the stage grant is revoked, an eject is queued, the request is cancelled and the person may ask again. Wired to "Leave the live" (web panel, phone guests sheet), "Leave studio" and "Leave camera" for guests.
- Removing or blocking a guest who is on air revokes their grant and removes them from the published layout at once, so the minute sweep no longer ends the whole broadcast over a participant who is already gone.
- Declined viewers are told so instead of seeing the section vanish or a dead button; a full stage no longer blocks queueing a request; the phone offers "Request to join" only when the server allows it.
- Web automatic guest scenes wait for a live stream (the server refuses them while reconnecting) and a failed scene offers "Retry guest layout" instead of staying stale.
- Phone error text now names guest-request outcomes instead of "your access has changed".

## Verification observed

- Typecheck: web, phone and admin pass.
- Unit suites on the merged branch: web 1107 passed, admin 343 passed, phone 3493 passed, 0 failed, 0 skipped.
- Database (PGlite) on the merged branch: 34 passed, covering guest requests (18, including leave and on-air removal), chat rules (4, including followers-only), viewer presence (10) and video covers (2).
- Browser: live harness 16 checks (chat, playback, guests, clips); Discover frame harness 8 checks against real MP4s on a second origin.

## Left as mapped, not changed

- Scene re-send when the same guest returns with a new Daily session id.
- Accept and decline notifications for a viewer who left the screen.
- The phone's second chat-topic channel for polls and questions.
- Control-plane recovery for a rejected start or a missing end event, admin visibility of provider outbox failures, and the six-hour room expiry.
