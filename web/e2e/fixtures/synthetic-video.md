# Synthetic playback fixtures

`/qa/video-landscape.mp4` and `/qa/video-portrait.mp4` are generated test patterns, not user uploads. Each has twelve seconds of H.264 video and a quiet synthesized AAC tone, a visible clock, corner labels, and a white frame border. No external footage or personal information is included.

Use these assets only in controlled QA posts to check aspect ratio, theater mode, seeking, speed, audio controls, and supported picture-in-picture behavior. Landscape dimensions are 640 by 360. Portrait dimensions are 360 by 640. They are ordinary static assets and do not exercise the upload, transcoding, storage authorization, or delivery pipeline.

The patterns were generated with FFmpeg's `testsrc2` at 24 fps and `sine` at 440 Hz. Video uses libx264 CRF 34, yuv420p, and faststart. Audio volume is 0.015 with a 32 kbps AAC target. The files intentionally contain no authentication or privileged route.
