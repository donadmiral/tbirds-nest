# Current Edge deployment packages

The unchanged bundle source was verified at `ecf5e5a960106d7cb04c211ee99e9e89c09642cc`.
The manifest was refreshed to make clear that current authorization covers rollout
after the actual technical gates. Its source commit and individual current-file
hashes are recorded explicitly in the package index.
It contains exact arguments for the normal `supabase_deploy_edge_function` tool,
including complete file contents, repository-relative paths, entrypoints,
the one explicit import map, and each function's JWT setting. The 16 request
files contain 42 unique source files. No deployment or activation occurred.

## Verification and current target

Run `node scripts/quality/build-music-candidate.mjs --check`, followed by
`python3 scripts/quality/completion-edge-packages.py --check`.
Both checks passed. The refreshed historical candidate changed only generation
metadata, the config file hash, and test/runner hashes. All 14 affected bundles
and both existing prerequisite bundles are byte-for-byte unchanged from their
previous reviewed manifests. Its October 30 hosted observation remains explicitly
historical; the current target observation is in
`provider-request-status-observation.json`.

Fresh supported Edge source readback is recorded in
`edge-deployment-current-readback.json`. The existing `limited-media-file` and
`chat-media-sign` prerequisites match the current bundle sources and JWT settings.
The other ten existing bundles differ from the candidate. Four functions are
absent: `business-owner-access`, `music-asset-finalize`, `music-maintenance`, and
`music-catalogue-ingest`. ACTIVE metadata alone does not establish source equality.

## Database and rollout order

The QA database remains at private business-auth stage 3. The supported stage-4
request has no terminal provider result; its late outcome remains unknown.
The independent readiness helper repair succeeded and is journaled as
`20261101021335`, with 13 actual Storage references, zero missing objects,
zero unbound references, and all five buckets private. This success does not
resolve the separate business-auth or atomic-support requests.

The exact migration paths, hashes and expected fingerprints are recorded in
`ordered-completion-dependencies.json`. After the outstanding business operation
has a safe, established terminal state, use only the ordinary supported path for
remaining stages 4–8, with the unchanged guards and exact postflight after every
stage. Stage 8 remains one atomic activation. Then apply the three ordered music
migrations and their postflight. Do not replay the already-installed market offer
serialization or the QA prerequisite adapters.

| Group | Functions | Required state before replacement |
| --- | --- | --- |
| 1 | business-signin, business-owner-access, daily-get-token, crisp-bridge, link-preview, apple-music, replicate-proxy, create-business | Activated business-auth contract and exact postflight; current Auth sessions must pass the guarded handler path. |
| 2 | music-asset-finalize, content-media-sign, media-content, account-storage-erasure | Business and complete music contracts; private media and erasure prerequisites remain valid. |
| 3 | music-maintenance, music-catalogue-ingest | Both music operations and catalogue migrations; caller authentication stays scoped and readiness stays disabled initially. |

For each replacement, require a terminal tool success, an ACTIVE returned version,
exact JWT/entrypoint/import-map settings, and source readback matching every file
hash in `edge-deployment-packages/index.json`. A submitted request does not satisfy
those checks. Both matching existing prerequisite functions can remain in place.

Enable original uploads only in disposable QA once its contracts and bundles pass,
then record real Auth, upload, stored-byte finalization, preview, post/story/book
attachment, audience denials, no-store delivery, revocation, cleanup and erasure.
Disable the QA readiness switch on any failure. Production original readiness
requires its own successful acceptance. Licensed catalogue ingestion/playback
remain disabled; these packages contain no commercial credentials or rights.
Music maintenance also requires its existing scoped Vault setup, disabled-mode
rejection, authenticated heartbeat, cron verification and actual disposable orphan
Storage cleanup. Never place a long-lived credential in provider-readable queues.

## Independent notification dispatch package

`notification-dispatch-edge-request.json` renders both reviewed templates without
changing their contents and includes their two shared dependencies. The source
accepts only the exact QA origin and authenticates a one-use canonical event
capability. Its local handler suite passes 14/14 and its actual SQL fixture suite
passes 16/16. The migration leaves dispatch disabled, inserts no historical jobs,
and preserves the provider-owned pg_net ACLs. The normal tool's SQL classification
is preserved, including the explicit operator-only bounded-retention DELETE.

Any migration/deployment attempt has its own receipt. A successful disabled
installation must still be followed by exact RLS/ACL/trigger/source checks. No
provider message or ordinary-user notification is part of this preparation.
Provider acceptance and installed-device display remain distinct evidence.

## Production

No production request file is generated. Once the required gates pass, we will
execute the authorized rollout using the exact production prerequisite manifest
and fresh target-specific preflights, coordinate installed-client compatibility,
then bind the same reviewed bundle source to the production target. QA repair
projections and the QA-only notification dispatcher
are not production migrations. The package does not turn a local check or a QA
pass into production acceptance.
