# QA video fixture repair — 28 October 2026

Status: applied and browser-verified in QA project `uaulhuelcfkjwojtymmw` only.

## Diagnosis

The two synthetic fixture URLs pointed at Vercel deployment-protected files. Ordinary HTTPS clients received an HTML sign-in page instead of MP4 content, while an authenticated cloud browser could play them. The user's own uploaded video was unaffected.

## Repair

The two existing synthetic files were uploaded through Platinum's normal authenticated QA composer. The existing `post-media` bucket remains private. Its canonical stored URLs are resolved by the content-media service to signed read capabilities.

| Asset | Bytes | SHA-256 | Actual object path inside `post-media` |
| --- | ---: | --- | --- |
| `web/public/qa/video-landscape.mp4` | 506091 | `ed599b38361d5e0bf0e37b4609fe8a0b8f3615064391b4f48e0480a3fa6e101b` | `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/1793200944527_nrfunj.mp4` |
| `web/public/qa/video-portrait.mp4` | 512671 | `8a3ad9b10f015052d5b562a8d0c9688eaa3a05618540d2c233ddab2efebc16f0` | `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3/1793200945157_hfc3i6.mp4` |

Storage owner, MIME type (`video/mp4`) and byte sizes were verified before changing references. A guarded transaction updated only synthetic post `5e19ecba-5ec9-4ad4-96fb-096f178789fd`, author `b946f2c6-ead9-4e1a-a10a-37e0b12aafa3`: gallery rows `a8ed59ab-048e-4f2d-ab07-3155d7d25eb6` and `936bc310-df2b-44a4-b0a6-114d22587110`, plus its parent fallback URL. Dimensions, order and other post content were preserved. The transaction required the original URLs still to match. Both new object paths were then verified in `content_media_bindings` for the original post.

The temporary upload post `3d39a676-2973-4f7c-aea0-43cae0c17720` was removed after transfer using exact ID, author, caption, archive-state and retained-binding guards. The uploaded files remain associated with the original synthetic post. User video `f9f2ac4d-fe23-4834-bab9-d741184d5a6c` was not modified.

## Browser verification

Both gallery videos resolved to signed QA Supabase Storage sources. Landscape reached `readyState=4`, played beyond 10 seconds, and reported no media error; portrait reached its 12-second end with `readyState=4` and no media error. Signed URLs are deliberately omitted from this record. This confirms web playback; actual iPhone acceptance remains a device test.

The live check also exposed portrait cropping in post detail, subsequently corrected in the web player with full-frame containment. See the media-quality release note for the follow-up verification.
