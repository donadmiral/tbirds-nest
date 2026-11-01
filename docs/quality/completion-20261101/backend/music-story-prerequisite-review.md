# QA story prerequisite for the unchanged music release

The first reviewed music migration refuses an unknown story publisher body. Its required visual-publication body was present in the production fixture, while the actual QA database retained the earlier soundtrack-aware publisher. A fresh exact preflight exposed this mismatch before a hosted music request was submitted.

The new QA-only transaction changes **one function body**, `public.publish_story_v2(uuid,uuid,jsonb)`, from definition MD5 `f915d1249e96ac5d72ba01b7daecca1a` to the current tested source body `a45f9673c681b1da88e2d790c652c7e0`. All eight surrounding story function definitions already match that source. Their existing execution privileges, all four triggers, the restrictive media-tag policy and existing rows remain intact.

The transaction is `supabase/ops/qa/20261101044417_qa_story_music_prerequisite.sql`, SHA256 `24255e33d3c8f5aeb1f791313d511919a7fa4fde749ebdf8248f796557b3ce19`, 14,170 bytes. It was created with pinned Supabase CLI 2.122.0 and placed in the QA ops directory so a generic production migration chain cannot apply this QA-specific transition.

## Guards and atomicity

The source binds the exact old bodies, owners, execution privileges, security-definer attributes and search paths of all nine functions. It also requires the source-identical repaired business activation journal, no music schema, and the inspected legacy book soundtrack column at position 9. A change in any required contract fails before replacement.

All four inspected legacy audio counts were zero at 04:41:56 UTC. The transaction locks the affected story, sound, book and post-media tables and refuses any audio discovered before replacement. It does not delete or rewrite existing audio. The current visual publisher remains deliberately unavailable for added soundtrack audio until the unchanged music migration installs its verified replacement. No readiness or licensed-catalogue flag is enabled.

The shared table locks serialize identical concurrent attempts. A later attempt acquires the lock after the first commit, observes the new publisher hash and rejects the exact-old-body guard. A late error rolls back the complete replacement. The SQL retains its ordinary function body, including existing story draft cleanup, and must pass through the normal supported migration tool with its actual provider classification.

## Verification

`node supabase/tests/rpc-authorization/test-qa-story-music-prerequisite.mjs` executes 12 actual SQL cases. They cover the old/new read-only projections, body and ACL drift, companion-function drift, source journal mismatch, an already advanced schema, new legacy audio, book column drift, atomic rollback, the single-function change, a late duplicate and the unchanged three-migration music chain.

The QA fixture now recreates the actual historical column order from the two original column statements in `20261028151016_memory_book_design_and_soundtrack.sql`. It also restores the captured, hash-checked legacy soundtrack resolver before applying the reviewed transition. The ordinary production fixture remains unchanged by default.

Run `verify-story-music-prerequisite.py` with `--phase preflight` on the fresh root observation before normal apply, then with `--phase postflight` on the saved installed observation. The verifier requires strict JSON types, exact source bytes and journal identity, all nine function contracts, no legacy audio and no concurrent client transaction. The retained local observations are explicitly isolated fixtures and do not claim a hosted installation.

The three original music migration payloads remain byte-identical. Their regenerated projections additionally bind the repaired business activation and this exact prerequisite journal.
