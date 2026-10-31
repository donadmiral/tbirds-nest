# Music operations and disabled catalogue pipeline

Date: 30 October 2026. Continuation of the original-audio implementation on `codex/app-quality-20261029`.

## Delivered scope

Two additional migrations extend the existing original-audio contracts:

1. `20261030203619_music_catalogue_operations_and_cleanup.sql` adds immutable catalogue metadata batches, a private server-operation journal and staff CSV report, original-upload cleanup leases and quota release after verified Storage deletion.
2. `20261030204339_licensed_catalogue_pipeline.sql` adds an actual provider-neutral byte ingestion and delivery path, immutable versioned signed-grant records, licensed-provider state, current territory/use/window/export authorization, provider retention bounds and abandoned-catalogue cleanup.

The new Edge entrypoints are `music-maintenance` and `music-catalogue-ingest`. Both explicitly authenticate scoped credentials. Neither accepts an application JWT or a service key as the caller credential. The existing media signer/proxy remains the only client byte-delivery path.

All catalogue service switches start false. The migration inserts no catalogue credentials, signed grants or licensed providers. The admin interface has no licence activation command. Nothing in this work acquires, imports or enables a commercial recording in a hosted environment.

## Catalogue flow

Authorized staff stage a version-1 JSON manifest through Music and audio. A batch accepts up to 100 tracks and 256 KiB. Provider, track and revision form a stable identity. A revision cannot silently change its title, artist, asset hash or rights-reference metadata. An exact batch-request retry reuses its previous result, and a conflicting or invalid batch rolls back completely.

After the separate licensing review, a privileged operator must provision the actual provider credential, immutable signed-grant version and track-to-grant assignments. The system requires provider status `licensed`, an enabled scoped ingestion credential, explicit hosting permission, finite current rights dates and recorded agreement evidence. The database has no app/staff RPC that performs those activation steps.

The provider-neutral `music-catalogue-ingest` endpoint accepts a raw WAV, MP3 or audio-only M4A recording. Required headers are Authorization with the scoped provider credential, X-Catalogue-Track with the staged UUID, X-Audio-Sha256 with the staged digest, Content-Type and Content-Length. The supported bound is 50 MiB and 1 to 600 seconds, matching the validated decoder. This is a push protocol. It never fetches a caller-supplied remote URL.

The handler reserves the exact asset, verifies the pushed bytes, uploads through the Storage API without upsert, reads the actual stored bytes again, validates the stored digest, MIME and duration, and finalizes against the exact observed Storage version. It rechecks the live provider credential and signed grant during finalization. Timeouts, malformed audio, changed bytes or licence revocation cannot create a playable sound. Retries reuse an existing verified sound and cannot adopt unrelated bytes after a Storage conflict.

Catalogue recordings use the existing private `music-audio` bucket under `catalogue/<provider>/<track UUID>/<digest>.<extension>`. Catalogue sounds are platform records with `source='library'` and no personal-account owner. A database constraint still requires every original sound to have an owner. Platform media therefore remains separate from personal erasure.

Playback, attachment and download each require the current Auth session and business-session contract where applicable. The catalogue evaluator additionally checks a verified immutable asset, current nonrevoked agreement, allowed use, finite rights dates, licensed-provider state and current server-managed territory verification. An unlimited or malformed territory verification timestamp is rejected. Export requires a separate `export_allowed` grant. User-editable profile metadata cannot supply territorial authority.

`get_original_audio_capabilities()` now returns version 2 with the established original-upload fields and a real catalogue playback flag. `authorize_music_audio_export(sound, use)` preserves original owner-only export rules and applies the extra licence checks for library recordings. The original version-1 export RPC remains owner-only. Root-owned clients accept library results only behind the verified version-2 capability.

The existing soundtrack validation, story publication, book persistence, content manifests and no-store delivery resolve the verified library sound. Stored URL identifiers are not public playback capabilities. Each ticket redemption rechecks current rights and Storage identity. Revoking a grant blocks already-issued tickets, including subsequent range reads. Already downloaded or buffered bytes cannot be recalled.

## Automatic abandonment cleanup

Original reservations become eligible 24 hours after their 24-hour reservation expires. Catalogue reservations become eligible 48 hours after their last reservation attempt. Verified or published sounds are never selected. All limits remain accounted until actual deletion is acknowledged.

The maintenance worker alternates original and catalogue queues so a sustained original backlog cannot starve provider cleanup. Each invocation handles at most 10 jobs within a 45-second deadline. Each Storage request has an additional 10-second deadline. A separate scoped worker credential, stored as a digest, protects invocation. Vault/cron setup files keep the plaintext credential out of source code and cron definitions.

Claiming a job permanently fences the old reservation against renewal, insertion and finalization. The worker checks its current lease and exact object identity, deletes through the Storage API, then acknowledges only when the database confirms that the object path is absent. A false success response cannot release quota. Failures back off, expired leases can resume, and changed ownership/version enters review. Cleaned request/revision tombstones prevent stale clients from recreating the old path. A provider can stage a new immutable track revision after cleanup.

Catalogue Storage writes use a narrowly scoped trigger because the service role bypasses RLS. The guard takes a shared lock on the reserved asset, checks its deadline, provider, current hosting grant and expected size, and rejects late service writes after cleanup. It does not change Storage table ownership or upload/delete metadata through SQL. The corresponding trigger function and application state live in `music_library`.

Supabase recommends treating its managed Storage schema as read-only apart from supported access controls/indexes. This integration follows the application's pre-existing erasure-write-guard pattern, but it still needs hosted Storage acceptance and review against future Storage provider updates. Local SQL fixtures establish the database invariant, not actual provider-level orphan cleanup or concurrent hosted transactions.

## Reporting and admin behavior

The private journal records attachments, detachments, delivery authorizations and export authorizations. It deduplicates repeated redemption of one media ticket and ignores unchanged soundtrack recipes. Deleting content records detachment. Erasing an original sound cascades its usage rows, including stored titles.

These are server-operation counts. They do not measure listening duration, completed downloads, unique listeners, billable streams or royalties. The export precheck and final recheck are separate authorization calls. Personal erasure can change historical original-audio totals. The CSV is therefore not a finalized royalty statement.

The staff CSV endpoint validates a 1-to-31-day UTC window, rechecks the current staff session, uses an exclusive end date, rejects oversized report results and returns no-store responses. It quotes fields and neutralizes spreadsheet formulas in external titles or identifiers. Failures return an error rather than an empty success file.

Music and audio now shows actual ingestion/playback switches, worker heartbeat, separate original/catalogue cleanup counts, immutable catalogue revisions and separate agreement/asset status. It can stage a manifest and download the operations CSV. It cannot activate licensing.

## Installation order

First verify the established admin, private-media compatibility, bounded delivery and Storage-first erasure chain for the exact target environment. The complete prerequisite and bundle hashes are in `candidate.json`.

Install and verify `20261030034752_business_bound_auth_sessions.sql` before `20261030153811_original_music_library_and_delivery.sql`. Then install `20261030203619_music_catalogue_operations_and_cleanup.sql` followed by `20261030204339_licensed_catalogue_pipeline.sql`. The serialized market-offer migration belongs to the wider combined acceptance chain and is not an audio prerequisite.

Deploy the exact associated business-auth Edge bundles, then the reviewed `music-asset-finalize`, `content-media-sign`, `media-content`, `account-storage-erasure`, `music-maintenance` and `music-catalogue-ingest` bundles with their recursive local imports and the recorded `verify_jwt` configuration. These handlers perform their own current-session or scoped-worker authentication. Deploying with `verify_jwt=false` does not make them anonymous APIs. Preserve all existing secret handling.

Keep original upload readiness, maintenance readiness and both catalogue switches off during deployment. Installation alone is not a readiness signal. Run `supabase/ops/check-music-operations-postflight.sql`, which reads actual switches, credential/grant counts, RLS, trigger status and function ACLs without returning secrets or private object paths.

After the original finalizer/signer/proxy rollout, verify an actual QA upload, byte finalization, preview, story/post/book attachment, audience delivery, revocation and disposable-account erasure before enabling original upload readiness outside that acceptance environment. Turn readiness off if any step fails.

For cleanup only, review and run `setup-music-maintenance-credential.sql`, store this environment's exact URL in Vault as `music_maintenance_project_url`, and verify that the deployed handler rejects invocation while maintenance readiness is disabled. That rejection does not update the heartbeat. In QA, activate maintenance with the service-only readiness RPC, invoke the worker using its scoped credential, verify its successful response and actual heartbeat, then install `install-music-maintenance-cron.sql`. Verify an actual disposable original upload and Storage cleanup before production use. The worker now requires both migrations because it services both queues.

Do not enable catalogue ingestion or playback until the real provider agreement and its actual scope have been reviewed. Use separate synthetic data for acceptance. Do not treat a migration connector timeout as installation success.

## Verification

The exact candidate hashes and local results are recorded in `candidate.json` and `verification.json`.

Run `node scripts/quality/build-music-candidate.mjs --check` before installation to confirm that every recorded migration, Edge entrypoint, recursive local import, import map and operation script still matches the reviewed source. After an intentional reviewed change, rebuild the manifest with `node scripts/quality/build-music-candidate.mjs`, then run the check again. These commands are offline and do not change hosted readiness or deploy anything.

- Operations SQL: 19 passed. Includes grants/RLS, staff sessions, storage-before-quota invariants, cleanup leases, idempotent immutable import, delivery reporting, territory and account-erasure behavior.
- Catalogue SQL: 22 passed. Includes disabled defaults, provider/grant fences, verified platform sounds, immutable licence revisions, search, story/book delivery, warm-ticket revocation, export permission, service-role write guards, cleanup and restoration of capacity after 20 failed pushes.
- Existing original-audio SQL with both new migrations installed: all 31 passed.
- Catalogue Edge handler: 11 passed, exercising actual audio inspection, stored-byte validation, credential/path rejection, exact retries and bounded deadlines with synthetic transport.
- Maintenance Edge handler: 14 passed, including missing objects, false deletion acknowledgement, version/ownership gates, deadlines, provider paths and fair scheduling under both backlogs.
- Admin report/actions: 6 passed. These execute the actual action and route handlers with synthetic service transport.
- Admin TypeScript and scoped strict lint passed. Handler TypeScript passed. Both Edge entrypoints also passed `deno check` under the pinned Deno 2.1.4 runtime against their actual npm dependency graph. TLS verification used the operating system trusted certificate store.

Independent review and the combined production/QA migration-chain checks are recorded by the backend acceptance lane. These results do not claim hosted installation, physical-device tests or real commercial-provider acceptance.

## Licensing handoff still needs real provider inputs

The platform now has a concrete normalized metadata and byte-ingestion contract, private delivery, runtime rights checks and operation reporting. The selected provider's proprietary API adapter, catalog-feed mapping, credential exchange, licensing territory verification method and required commercial report format still depend on the provider's actual specification and agreement. No API or reporting terms have been invented. The generic pipeline is executable and tested with synthetic licensed fixtures, while every hosted commercial activation remains off.
