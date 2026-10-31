# One-time QA notification credential installation

This package connects the repaired notification handlers to future QA database events. It accepts no caller-supplied credential, target, SQL, account operation or event payload. It creates no Auth account and sends no test notification to a person. Catalogue and music readiness are unaffected.

## Installed prerequisites and order

The owner preference/call authorization and private dispatch claim migrations are recorded in `docs/quality/backend-acceptance-20261031/notification-installation.json`. The exact initiating-session provenance and current recipient check are recorded in `notification-origin-installation.json` in the same directory. The repaired Edge readbacks and unauthenticated denials are in `docs/quality/notification-acceptance-20261031/edge-deployment.json`.

1. Recheck those live contracts and the recorded Edge sources. `send-push-notification` must use exact service authentication; `send-voip-push` must use current caller and per-recipient authorization.
2. Apply `supabase/migrations/20261031010711_notification_dispatch_hooks.sql` through `apply_migration`. The private setting starts disabled. Both hooks may exist while disabled; no history is queued or replayed.
3. Apply this directory’s `20261031010712_qa_notification_dispatch_credential_installer.sql` through `apply_migration`. It refuses any project whose existing Vault `project_url` is not exactly the inspected QA project.
4. Obtain a fresh UTC timestamp from the provider or `clock__curr_time`. Run `node scripts/quality/prepare-qa-notification-setup.mjs --server-time TIMESTAMP`. The script verifies every deployed handler source hash and writes its temporary nonce only under a private `/tmp` directory. **Do not use the local container clock**; it can differ from the provider clock.
5. Review the generated non-secret `preparation.json`, rendered `index.ts`, `handler.ts` and `arm.sql`. Deploy only those two TypeScript files as `qa-notification-credential-setup`, entrypoint `index.ts`, with `verify_jwt=false` because this short-lived endpoint verifies its own one-time nonce. Read back both files and compare exact hashes before invoking.
6. Execute the generated `arm.sql` as the approved settings update. It changes only a disabled, unused setup row, refuses an existing dispatch credential, and must return exactly one row. It records the two reviewed handler bundle hashes, exact QA origin and the same ten-minute window as the Edge function.
7. Run `node scripts/quality/invoke-qa-notification-setup.mjs PRIVATE_PREPARATION_DIRECTORY`. The script first checks the exact project’s TLS `Date` header. The request carries only the random nonce and zero body bytes. The Edge reads its own built-in service credential and calls the fixed setup RPC directly. The RPC confirms that the same key authenticated the request, stores one Vault entry, marks the nonce used, and enables the prepared hooks in one transaction.
8. Independently inspect the settings, credential **presence only**, function ACLs and trigger definitions. A timeout or uncertain response must be resolved by this read-only postflight; never retry an unknown setup blindly or overwrite an existing credential.
9. Retire the setup authority immediately: apply a small reviewed migration revoking `service_role` execution on `public.install_qa_notification_dispatch_credential(text,text)`, and replace the temporary Edge endpoint with a constant `410 Setup retired` response. Verify that readback and live response. Delete the private nonce file. The SQL one-use marker and expired window remain additional protections.

## Verification and interpretation

The deployment entry is rendered from `index.ts.template`; the template is not part of native TypeScript compilation. Typecheck the rendered `index.ts` with Deno before deployment.

Run `node tests/quality/qa-notification-setup.cjs` for the real TypeScript handler boundaries, and `node supabase/tests/rpc-authorization/test-notification-dispatch-setup.mjs` for the SQL/Vault/trigger contract. The latter uses synthetic Auth, Vault and `net.http_post` fixtures; it makes no provider request. The actual queued call body is asserted as `{callId: UUID}`, matching the deployed handler. Incoming-call notification rows do not also trigger an ordinary push.

Use the private outbox for non-secret evidence: event identifier, queue request ID, state and error code. `queued` means PostgreSQL accepted an asynchronous HTTP request. It does not establish Edge acceptance, Expo/APNs acceptance, delivery to a physical phone, or notification display. Check the corresponding `net._http_response` status without exposing request headers or secret-bearing bodies. Real device delivery remains separate acceptance work.

The hooks do not automatically retry an uncertain provider attempt. Call delivery is claimed once per recipient, and the handler rechecks the exact initiating Auth session, business binding, current participant/member state, blocks and recipient preferences before each provider batch. Privileged manual call inserts receive no initiating-session provenance and cannot be pushed.

To pause future dispatch, set `notification_delivery.settings.enabled=false` through the authorized operator path. Preserve the Vault credential, event records, outbox, claims, provenance and migration history for diagnosis; no historical replay follows re-enablement.

Primary platform references: [Supabase Vault](https://supabase.com/docs/guides/database/vault) and [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net). Supabase’s asynchronous HTTP work starts after the database transaction commits; group-call invitation rows created in that transaction are therefore available when the handler reads the call.
