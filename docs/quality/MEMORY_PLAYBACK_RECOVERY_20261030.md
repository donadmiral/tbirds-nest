# Continuous memory playback recovery, 30 October 2026

## Changes

The native and web film players now time photo and text artwork from the same elapsed clock as page playback. Pausing freezes both the page and its timed artwork.

Loading deadlines exclude manual pauses, background time and active calls. Native inactive films are excluded too. A video that becomes ready but stops advancing now fails after 20 seconds of expected foreground playback, stops its player and leaves the existing Retry and Next memory controls available. Deliberate pauses, changing position and browser autoplay denial reset or exclude that deadline.

Ready, failure and progress callbacks are fenced to the current page and playback attempt. A slow result from a previous page or earlier loop cannot replace the current page's state. A native video error or completed playback remains terminal until its player is remounted; background/foreground or active-state changes cannot restart it.

The web prefetch path now applies the shared private-image cache policy, matching the native player's exclusion of signed, authenticated and limited-view delivery capabilities from speculative prefetch.

## Verification

- Existing and expanded native film suite: 14 cases passed.
- Existing and expanded web film suite: 10 cases passed.
- Independent native lifecycle suite: 8 cases passed.
- Independent web lifecycle suite: 6 cases passed.
- Native, web and admin TypeScript checks passed during integration.

The lifecycle suites independently reproduced loading timeouts during a pause, stale event contamination and native error recovery restarting terminal playback before these fixes. They execute the real component logic with controlled media, app-state and timer adapters. They are not physical-device acceptance.

## Scope

The branch includes the continuous memory-film presentation, its original instrumental score, native graded MP4 export and browser composed-video export. Browser encoded-output and native compile receipts are maintained separately. This change does not add licensed catalogue music, an album-length movie download, animated GIF/sticker export, nested video/dual-camera composition, or export of added songs and voiceover. Those outputs must not be presented as completed features.

Physical iPhone playback, the user's exact failing files, Photos export, interruptions, device codecs and audio routes still require the real-device checklist. TestFlight distribution remains held.
