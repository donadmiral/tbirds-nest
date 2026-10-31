# Creative memory books and native whole-book movies

This is a disabled native candidate with a working browser export path. It adds editable cover writing, postcard stamps, owned-book photo framing, persisted automatic-film settings and whole-book encoder infrastructure. It does not activate licensed music.

## Persistence and ownership

The client requires `get_memory_book_creative_capabilities()` version 1 before a creative write. Creating a book uses one owner-scoped request UUID, retained through an uncertain response, and `create_memory_book_creative_presentation`. Editing uses `save_memory_book_creative_presentation` with the loaded presentation revision. Both operations pin the starting JWT, verify its owner, and reject acknowledgement after any account change, including an A → B → A round trip.

The database migration is `20261031001826_memory_book_creative_presentation.sql`, owned and tested by the backend installation lane. It must be installed and its actual postflight recorded before this report can establish hosted persistence. A missing capability produces an explicit unavailable result; the client does not fall back to a partial legacy save. The planned film is derived from the authorized pages, so it adds no stored delivery URL or new media bucket.

## Movie behavior

Automatic cuts have a deterministic selection and order, opening and closing title cards, three pacing styles, and gentle photo movement and fades. Short, standard and full cuts stay within a five-minute limit. Existing books without the versioned settings retain their original timing. The same plan drives preview and export, and measured source-video duration replaces estimates before encoding.

Native preparation refreshes book access before each scene, stages only authorized private media into a bounded disposable workspace, normalizes still images before capture, and captures each timed artwork window separately. Plain entity-card images and reshared-story avatars now participate in the existing image-readiness protocol. Capture waits for layout, image decode and subsequent paint frames; a failed image or overflowing writing stops the complete movie. Private sources are limited to 512 MiB in total. The output is an actual 720 × 1280 MP4, limited to 256 MiB and 82 scenes including the title cards.

Original video audio retains its saved trim, speed and gain with pitch preservation. Page audio follows its own excerpt. Continuous book music loops only its selected excerpt and uses an explicit gain window for every scene. Audio export rights are checked before staging, throughout the active session, after encoding, and again before the explicit Photos save. A book change, lost access, account change, interruption, cancelled capture or revoked soundtrack discards the pending result and temporary files.

The iOS engine uses the existing verified Story renderer for bounded scene movies and AVFoundation for their final composition. Its shared reservation stays held until native readers/writers stop and temporary files are removed. Android uses one Media3 composition with scene video, independent page audio and finite continuous book-audio sequences; it retains the existing pinned 1.8.1 dependency graph. Both new native capabilities remain `memoryMovieVersion = 0` until actual simulator/emulator output acceptance passes.

## Verification at this candidate

- **61 native/shared tests passed:** creative documents and deterministic planning, owner/JWT/revision fences, media reader behavior, private streaming bounds, capture failure/cancellation cleanup and native bridge acknowledgement validation.
- **32 focused web tests passed:** static-image inspection, book shelf lifecycle, film controls, saved edits, interruption handling and React module boundaries.
- **7 Skia pixel tests passed:** exact neutral/color/grade behavior used by captured stills.
- Native and web TypeScript checks passed; strict lint passed for all changed client files. These are scoped results, not a claim that every historical module is lint-clean.
- The browser run encoded real original and automatic movies, decoded their picture/audio, checked both title cards, timed artwork, saved video grade/trim/speed, original-audio scene boundaries, invalidation before download, and mobile film entry/exit. It used a deterministic test Auth/RPC adapter and synthetic media, not the hosted database. The automatic output measured 12.216399 seconds; it contained 7,379 opening-title and 13,388 closing-title non-background pixels in the tested regions.
- The Android source and all 39 declared instrumentation tests compile and package. Its independent review binds all 14 source/asset hashes and both APK digests. **Instrumentation execution is still pending.**
- The iOS source received an independent review. Its isolated harness requires all **11 named cases, seven MP4s and two normalized PNGs**, including decoded orientation/alpha pixels, changing music across a page/duck boundary, pitch and track coverage, direct animated-byte rejection, cancellation cleanup and retry. **Apple-platform compilation and execution are still pending.**

Exact file hashes and the publication list are in `client-candidate.json`. Browser measurements are in `browser-creative-receipt.json`; both native source-review receipts are kept beside it. Runtime acceptance must bind the actual tested source tree and generated-file hashes before either capability changes to 1.

## Work still required

This phase does not implement animated stickers/GIFs, nested-video or dual-camera composition. Those layers are rejected explicitly rather than reduced to a still poster. Android video-color preview and the separate camera Boomerang encoder are also separate requested work. These remain implementation tasks after this coherent whole-book checkpoint.

Hosted creative persistence installation/postflight, cover form visual and round-trip browser acceptance, actual bundled React Native capture-to-movie UI acceptance, and simulator/emulator generated-file verification remain outstanding. No physical-device, Photos-library write, production privacy cutover or provider licensing acceptance is inferred from these fixtures.

The older QA source post `dd607e75-0383-4f75-9301-c2f96aa8ae7d` has a dark 1080 × 1920 image. Its previous receipt establishes decodability and the shared-story/card journey but contains no original-raster hash or non-dark pixel measurement proving that source image was deliberate. Its provenance remains unconfirmed; it is not used as evidence of successful artwork capture in this new candidate.
