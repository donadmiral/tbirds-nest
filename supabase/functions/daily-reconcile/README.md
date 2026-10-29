# Call revocation worker

Deploy `daily-reconcile` with `daily-get-token`, the message/call and private-storage migrations, and updated clients. It must run every minute; a one-off invocation is insufficient.

The worker uses existing `DAILY_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` edge secrets for provider and database access. Its invocation credential is separate and does not grant database or banking access.

## Default: Vault-managed credential

1. Apply `20261023190325_scoped_call_worker_credential.sql`. It generates 256 random bits inside the database, stores the token in Vault as `call_reconcile_secret`, and saves only its SHA-256 digest in `private.call_worker_credentials`. Rerunning preserves the existing credential and synchronizes its digest. The token is never returned by the migration or validation RPC.
2. Configure the **nonsecret** Vault entry `project_url` with this project's HTTPS Supabase origin. Do not use another project's URL or include a trailing slash.
3. Deploy with `supabase functions deploy daily-reconcile --no-verify-jwt --use-api`. The handler validates the bearer token through the service-role-only `validate_call_worker_token` RPC before any cleanup or provider call. Ordinary user tokens and the service-role key itself are not accepted as worker credentials.
4. Run `supabase/ops/install-call-revocation-cron.sql` as the database owner. It enables `pg_cron` / `pg_net`, verifies the Vault token matches its stored digest, and creates or updates one named every-minute schedule. Cron reads the token inside the database when making the request; no secret needs to be copied into source code, a command line, or a deployment tool.

An optional `CALL_RECONCILE_SECRET` edge environment variable overrides database validation. If configured, it must match the Vault token used by cron. Leave it unset for the default path above. Never put a worker credential in client builds. Do not disable JWT verification on the user-facing `daily-get-token` function as part of this operation.

The worker first sweeps expired ringing calls and abandoned group calls, then leases and processes revocations. The absence of group participant rows does not end a healthy direct call. Every failed provider attempt remains retryable with bounded backoff.

Monitor `call_provider_revocations` where `completed_at is null`: alert on pending age over two minutes or repeated `last_error`. The worker leases 50 rows and bans the old provider admission identity. A new authorized group admission rotates that identity.

Existing group sessions using pre-migration tokens must end during rollout; a newly added identity cannot revoke an unrecorded old token. Previously issued attachment URLs remain valid until their expiration; deploy the short-TTL signer before the private-media cutover.

Do not report revocation as live until a test removal creates a queue row, a scheduled invocation completes it, and Daily rejects the removed admission's token. This is transport authorization, not end-to-end encryption.
