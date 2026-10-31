# Creative memory-book persistence

The QA database now stores editable cover artwork and film preferences, with live-session authorization, ownership checks, strict JSON validation, revision conflicts and safe create retries. No Storage bucket, media URL, materialized film plan or music readiness switch is added by this package. Exporters derive their current authorized scenes from the saved preferences and book pages.

## Exact installation order

Use `apply_migration` for each SQL unit and inspect its postflight before continuing. These are separate atomic transactions; the first two do not expose the creative RPCs. The source timestamps differ from the provider-assigned migration versions, so retain the mapping in the installation receipt.

| Source | QA provider version | Purpose |
| --- | --- | --- |
| `supabase/migrations/20261031001826_memory_book_creative_presentation.sql` | `20261031013937` | Private schema, strict cover/film validators, preserved legacy defaults, revision and current-session write trigger |
| `supabase/migrations/20261031012445_memory_book_creative_mutations.sql` | `20261031014002` | Private owner-locked create/save implementations and request-id tombstones |
| `supabase/migrations/20261031012805_memory_book_creative_public_contracts.sql` | `20261031014022` | Exact reader-body copies, authorized creative projections, final public RPC grants and capability activation |

The foundation and final activation both require the inspected `memory_book_cover` trigger to be enabled with its exact owner/page validation body. Unexpected reader or trigger drift aborts the transaction. The final activation accepts either the captured visual reader or the reviewed music wrapper around that same reader. Local fixtures exercise both music-before and music-after installation orders.

Run `postflight.sql` after installation. It returns only contract metadata, ACLs, schema defaults, counts and aggregate data fingerprints; it does not return users' book content. The authoritative installation evidence is `docs/quality/backend-acceptance-20261031/memory-creative-installation.json`. Production has not received this package.

## Client contract

`get_memory_book_creative_capabilities()` returns exactly `{ "version": 1, "supported": true }` only to a current authenticated session. A missing or failed capability call leaves creative saving unavailable and the client draft intact.

`create_memory_book_creative_presentation` accepts `p_request_id`, `p_title`, `p_subtitle`, `p_cover_color`, `p_cover_design`, `p_story_ids`, `p_cover_story_id`, `p_cover_artwork` and `p_film_settings`. The request UUID is the new album UUID. The client must retain it across uncertain responses. Up to 80 distinct owned stories are added in the supplied order; the selected cover must be one of them.

An identical retry returns the original confirmed creation acknowledgement while the same owned book still exists. It never overwrites a later edit. A changed creation payload, another owner, an existing unrelated album ID or a deleted book returns `MEMORY_BOOK_REQUEST_CONFLICT`. The private request record survives individual book deletion to prevent resurrection and cascades with profile erasure.

`save_memory_book_creative_presentation` accepts `p_album`, `p_expected_revision`, `p_title`, `p_subtitle`, `p_cover_color`, `p_cover_design`, `p_audience`, `p_cover_story_id`, `p_cover_artwork` and `p_film_settings`. The owner row is locked and its revision compared before mutation. A stale, missing, negative or future revision returns `MEMORY_BOOK_CHANGED`. Every confirmed save advances the revision, including an unchanged save.

Both mutations return `{ id, presentation_revision, cover_artwork, film_settings }`. The actual SQL fixture acknowledgements are parsed by the production TypeScript validators. Legacy presentation updates, direct album writes and cover-page removal also advance the revision when presentation changes, so an older writer cannot silently overwrite an open editor's baseline. Authenticated direct inserts, updates and deletes receive the same live-session and business-binding guard.

## Stored choices and visibility

`cover_artwork` version 1 contains only the inscription, writing style and position, postmark, date visibility, and numeric photo crop choices. Inscription/postmark limits are 160/32 Unicode codepoints. Tabs and normal newlines are preserved; disallowed control characters, unknown keys, missing fields, invalid types and out-of-range crop values are rejected.

`film_settings` version 1 stores the automatic/original mode, reflective/bright/cinematic style, short/standard/full length, book/chronological order, title-card choice and original-audio choice. Existing books and legacy-created books retain `mode: "original"` and `titleCard: false`. Creative creation persists its explicit submitted settings, including the new client's automatic default.

The book reader, default-album reader and shelf expose these documents and the revision only through the existing book visibility checks. Private helper functions and request records have no application or service-role grants. The package does not widen the existing album/page table policies.

## Verification and remaining acceptance

Run the following three fixture orders:

```sh
node supabase/tests/rpc-authorization/test-memory-book-creative.mjs
MEMORY_CREATIVE_MUSIC_ORDER=before node supabase/tests/rpc-authorization/test-memory-book-creative.mjs
MEMORY_CREATIVE_MUSIC_ORDER=after node supabase/tests/rpc-authorization/test-memory-book-creative.mjs
```

There are 31 declared behavioral cases. The current QA shape passes 30 with one explicitly paired business-binding skip. Both complete business/music orders pass all 31. These are overlapping fixture invocations, not 92 unique scenarios. The suite covers disabled/modified cover guards, interrupted-stage ACLs, atomic rollback, full 80-page ordering, Unicode/JSON bounds, stale revisions, legacy writes, lost-response retries, deletion tombstones, profile erasure, real session rows, actual business issuance/revocation, reader privacy and unchanged catalogue state.

Hosted verification confirms exact migration history, function bodies, ACLs, active triggers and unchanged existing book/page fingerprints. The separate browser acceptance must still exercise a real signed-in create/save/reload. These database results do not establish physical-device movie export, licensed catalogue playback, or the installation of the separate business/music backend. Those readiness gates remain explicit in their own receipts.
