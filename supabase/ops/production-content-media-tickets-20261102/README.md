# Additive production content tickets

This package supplies the missing content-ticket contract required by the already-installed media gateway. Install `20261102162736_production_compatible_paged_readers.sql` first, then `20261102163428_production_content_media_tickets.sql`. The root release coordinator owns hosted installation.

The migration creates `media_delivery.tickets`, its private session/provenance/issuance helpers, a private readiness setting, `public.issue_content_media_delivery(jsonb,jsonb)`, and `public.resolve_media_delivery(text,text,text)`. It changes no existing public or Auth function, Storage policy, bucket visibility, account deletion, login, or chat contract. An in-transaction preservation check verifies the existing function definitions/ACLs, Storage policies, and bucket flags before commit.

The issuer accepts the existing content and upload manifest contracts. Eligible buckets are `post-media`, `story-media`, and `media`; eligible source kinds are post, story, sound, story draft, memory album, highlight, and owned upload. Existing canonical authorization still decides visibility. There are no chat issuers, legacy chat-grant triggers, `music-audio` capabilities, rights grants, or account-erasure workflow changes.

## Installation and verification

Run the read-only `preflight.sql` immediately before installation and inspect every result. The migration separately checks the exact captured canonical function bodies, owners, safe search paths, and ACL sets; required managed Auth columns; and absence of both an existing delivery contract and business Auth authority. `read_paging_support` remains independent and may already exist.

Run `postflight.sql` afterward. Expected installation state is zero tickets, `prerequisite_settings.enabled = false`, issuer execution only for `authenticated`, resolver execution only for `service_role`, and no direct client/service access to private tables/helpers. All existing source buckets remain public and media processing/delivery gates remain false.

`preservation.sql` records the same protected existing contracts used by the migration. Capture it immediately before and after this migration for a standalone receipt. It includes all old public/Auth functions and ACLs, including the existing account deletion and login helpers, plus every Storage policy and bucket visibility flag.

## Explicit later activation

Installation does not issue tickets. The issuer fails closed with `MEDIA_CONTENT_DELIVERY_NOT_READY` and the resolver returns null until the private setting is enabled. There is deliberately no client-facing configuration RPC.

After the exact Edge issuer/proxy and scoped gateway have passed the coordinated authorization, revocation, range-read, and playback acceptance checks, the operator can explicitly enable ticket issuance in the protected database session:

```sql
update media_delivery.prerequisite_settings set enabled=true where singleton;
```

Disable the same setting to refuse new issuance and invalidate redemption of outstanding tickets. It is independent of `media_renditions.settings.delivery_enabled`, processing admission, worker/maintenance gates, and web/native adaptive build flags. Enabling any of those is a separate rollout action. Tickets expire after five minutes and pin the actual session, object ID, version, owner, canonical source, and current audience. Expiry cleanup uses a captured cutoff and the `(expires_at,token_digest)` index, deleting at most 2,000 expired rows per issuance request.

Original source buckets can remain public throughout an opt-in adaptive rollout; released public-URL clients keep their existing playback. Their eventual privacy cutover requires its separate reviewed client/CDN procedure.

## Existing QA and future full migrations

QA already has a complete canonical `media_delivery` installation. This production-specific migration deliberately raises `CONTENT_TICKETS_EXISTING_DELIVERY_REQUIRES_FORWARD_RECONCILIATION` there. It must not replace or downgrade that installation. Its focused tests use the actual captured production visual baseline followed by the new compatible readers, with no fake music/erasure/ticket schemas.

Do **not** replay `20261029231440_bounded_media_delivery.sql` after this package. A later reviewed forward migration must inspect this package's exact table/function/ACL hashes and readiness state; preserve any unexpired tickets; reconcile the content-only source-kind constraint and private setting; and add any approved chat contracts separately. The presence of `media_delivery` alone does not mean the full historical package is installed.

Likewise, the complete business-session rollout must reconcile the new resolver before activating its authority. Preserve the canonical resolver anchor and add the reviewed `business_auth.accounts` / `business_auth.session_allowed(user_id,session_id)` check. This package explicitly refuses an already-present `business_auth` schema rather than guessing its authority. Music, erasure, restrictive upload policies, and original-bucket privatization remain separate changes with their own compatibility review.

## Focused test command

```sh
PGDATABASE=pc_scale_media_tickets node --test supabase/tests/media-content-tickets-db.test.cjs
```

Use the repository's existing local-only `PC_TEST_PSQL`, Unix-socket `PGHOST`, `PGPORT`, `PGUSER`, and runtime library environment. The test refuses any other database name, rebuilds only that disposable local database, installs the real captured baseline and compatible readers, and exercises readiness, ACLs, current audience/session checks, replacement/revocation, excluded buckets, legacy provenance, preservation, and bounded expiry cleanup.
