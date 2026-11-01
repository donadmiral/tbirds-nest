# Web and admin completion evidence

## Accepted results

The browser workflow passed all 13 groups at source `340fe01b3db1a3072625b27efbae476d8df72d66` in [run 41261405727](https://github.com/donadmiral/tbirds-nest/actions/runs/41261405727). This includes actual React components, generated media, encoded-file decoding, account invalidation, write confirmation, browser navigation, admin controls, original-audio controls and error recovery. Transport in these scripted groups is synthetic; hosted service acceptance is recorded separately.

The current memory-movie group has 27 cases. The two added cases deliberately stall before the first recorded frame and after two rendered frames. Both retain the 1,000 ms rejection threshold, reject partial downloads, close audio and media tracks, and emit only the defined timing fields. Their measured gaps were 1,153.6 ms and 1,164.6 ms. No content, account identifier, media URL or credential is logged.

Actual authenticated hosted QA accepted the following selected flows:

- Admin: 24 settled read routes; Lights out and restoration; private photo decoding/fullscreen/Escape; private video decoding and playback; authenticated full-post review.
- Member: settled primary read routes, creator overview/partnerships/earnings, selected settings/privacy read states and support empty state without sending a message; Light/Dim/Lights out and restoration; reader navigation and captions; film play/pause; unsupported-animation refusal.
- Save: one valid title-save click, full reload and exact readback, then restoration of the original title and another full reload. A prior invalid 33-character automation input was rejected locally; it is not counted as a backend failure. The valid temporary title was exactly `QA memories verified Nov 1` (26 characters). No exact network request-count claim is made for this hosted check.
- Movies: actual downloads of the private one-photo automatic cut and the original synthetic video book on the diagnostic preview. Both retained original rendering guards and required the ordinary Create movie, ready state and separate Download movie steps.

| Hosted file | Actual duration | Encoded frames | Largest source-frame gap | Bytes | Verification |
| --- | ---: | ---: | ---: | ---: | --- |
| Photo automatic cut | 8.2049 s (UI rounds up to 9 s) | 246 | 51 ms | 1,625,692 | Opening title, photo and caption, closing title; audible score; complete decode |
| Original video book | 12.0148 s | 360 | 52 ms | 3,302,510 | Advancing synthetic source timecode, saved caption; audio; complete decode |

Both files are 720 × 1280 VP9/Opus WebM. Source frame timestamps are strictly increasing. Full decoding with a millisecond output timebase produced exit code 0 and no stderr. The video book is 12 seconds; an earlier 31-second description mistakenly referred to another profile post and is not an acceptance claim.

Earlier hosted attempts reached the existing frame-gap rejection guard. The later successful attempts are recorded alongside those observations. The cause of the earlier intermittent pauses was not established, and failure-only diagnostics are not represented as a rendering reliability fix.

## Source and deployment binding

`qa-preview-config-repair.json` records the repair of five existing preview environment entries: only their Git-branch scope changed. Values were not read or changed; production variables and deployment protection were unchanged. Exact-source admin and web previews reached READY. The existing protected QA aliases were reassigned within the same projects and backend to reuse the test sessions.

The tested admin preview is `dpl_BzT1aDFcDKKkQAEZo3mrkgQ1n6KJ` at the repaired source `cc4e936d0a4ad7ac9f4e032fdb7b123ec961a0a3`. The current hosted movie preview is `dpl_7ot6pju1eR8Xm7ysq58Xik3HoEfB` at `340fe01b3db1a3072625b27efbae476d8df72d66`; its READY state, source metadata and tested alias binding were verified. The intervening browser fixture corrections did not change admin product runtime code.

## Evidence files

- `hosted-qa-receipt.json`: actual hosted observations, restoration, limitations and private-fixture disposition.
- `hosted-photo-decode.json` and `hosted-video-decode.json`: file digests, codec/timing measurements and complete-decode results.
- `browser-41261405727/provenance.json`: final source/tree, Actions artifact digest and individual receipt hashes. The verified artifact SHA-256 is `95f64493517afbc804fd195ddc6c73e897f062fcb55d7ca8292bc979eb59de5b`.
- `browser-41260532142`: all 13 groups passing after the admin appearance and commerce acknowledgment fixture corrections.
- `browser-41259529340`: original failures retained as diagnostic provenance. These were stale fixture expectations; the current application correctly retained a draft without a valid offer ID.

Hosted video files, screenshots, extracted frames and raw authenticated page content are kept outside the public repository. The committed receipts contain measurements and synthetic QA descriptions only. The original book title and appearance preferences were restored. The disposable photo book remains Only me; the current editor exposes no reversible book-level archive operation.

## Boundaries

These results do not mean every page, every button, every account role or every content combination passed. Hosted original-audio availability was still blocked by the QA backend contract when observed; backend installation and its relevant follow-up belong to the backend completion work. Licensed catalogue integration remains explicitly deferred. IntoBank provider connection, creator payout readiness and enrollment remain their stated capability/provider boundaries; no financial action was taken. Second-account offer submission and support/admin message submission were not performed in the hosted session.
