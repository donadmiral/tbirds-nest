# Additive production reader package

Target: the captured production visual-reader baseline. Apply `20261102162736_production_compatible_paged_readers.sql` **before** the separate additive content-ticket package. This migration refuses existing `read_paging`, adapter, creative, music, media-ticket, or account-erasure schemas. It is not an upgrade for QA, where the canonical full reader package already exists.

Run `preflight.sql` and require `all_gates_passed=true`. After installation, run `postflight.sql` before another package changes the catalog. Require installed/canonical/public/private gates true, both readiness flags false, private tables RLS-protected with no API access, and every revision trigger enabled. Compare preflight/postflight `existing_functions_md5`, `existing_policies_md5`, `existing_columns_md5`, and buckets exactly. Neither query returns user content or credentials.

The source manifest records the exact original source hashes and every occurrence-checked adaptation. This is the replacement installation for these five units on production; **do not replay them afterward**:

- `20261102064915_bounded_book_and_inbox_readers.sql`
- `20261102074640_bounded_context_inbox_reader.sql`
- `20261102075537_bounded_business_inbox_reader.sql`
- `20261102075616_bounded_inbox_mentions.sql`
- `20261102091728_bounded_memory_book_windows.sql`

Cursor binding, ordering, visibility predicates, page/window bounds, RLS modes, existing member checks, unread semantics and selected-window queries are copied from those reviewed sources. Both versions of the new capability function require the current adapter authority, so an unsupported business identity receives `books=false`, `books_window=false`, and `inbox=false`. Existing clients can retain their existing reader path. The default-off flags do not activate new clients or complete business authentication rollout.

The isolated session guard retains the reviewed session ownership, expiry, anonymous, deleted-user and ban checks. The actor also checks active profile and business binding. Before account erasure exists, it retains the same shared advisory-lock key and live identity check. A later complete erasure guard takes over, including pending-job fences; an incomplete schema fails closed. A later creative actor takes over directly. No full-package namespaces, authentication hooks or public authority stubs are fabricated.

The legacy production reader omits creative metadata, soundtrack and page audio. The new readers preserve that omission until the actual creative acknowledgement or canonical music-rights helper exists. Rights failures propagate; missing rights cannot produce playable audio. Optional fields are projected through JSON only when that full contract exists.

The story revision trigger compares the exact relevant existing fields directly. Counter-only changes do not update revisions or serialize whole story rows. A guarded optional-field comparison automatically detects `audio_sound_id` edits after the actual column is installed. Full creative/music/account packages can therefore be reviewed and installed later without adapter namespace collisions. Their own public API/storage/business cutovers still require their independent compatibility checks; this package does not authorize or simulate them.

Focused verification:

```bash
npm ci --ignore-scripts --prefix supabase/tests/rpc-authorization
node supabase/tests/rpc-authorization/test-production-compatible-paged-readers.mjs
```

The test uses the captured deployed visual baseline and real PostgreSQL semantics through pinned PGlite. It verifies absence of the full schemas/columns, byte-identical pre-existing public/Auth functions and ACLs, unchanged policies/columns/buckets/hooks, exact original book count/order/cover, window continuation, revision invalidation, current-authority denial, capability behavior, future-helper delegation, and strict replay/drift aborts. It is a correctness gate, not a hosted capacity measurement.
