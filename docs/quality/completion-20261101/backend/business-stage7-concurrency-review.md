# Narrow concurrency review: unchanged private business-auth stage 7

**Conclusion:** after the fresh source-bound preflight passes, a coordinator may
make one ordinary supported submission of this exact stage-7 transaction while
retaining the earlier request as unknown. Concurrent or delayed identical
transactions can commit the five private functions and stage marker at most once.
This conclusion concerns database effects; it does not promise provider availability,
resolve an earlier request, or bypass the required destructive confirmation.

## Exact source and effects

Source: `supabase/ops/qa/business-auth-staged-20261031/07_private_revocation.sql`.
Its 8,926 bytes have SHA256
`a9869a35210cf5706eb2473781b9ec6d80c2704626e41d346081a17517f2f982`.
Original statement indices 32, 33, 35, 37 and 39 remain unchanged apart from the
previously reviewed private-schema CREATE header. The official destructive
classification remains true; statement 39 is retained openly.

The transaction starts with `BEGIN`, the original three-second lock timeout,
60-second statement timeout and fixed `pg_catalog` search path. Its unchanged
guard requires postgres, the exact stage-6 marker and full catalog fingerprint
`1eb5ad671173842667ced9e052f232bd`, empty private tables, no unfenced authenticated
application table and no existing business Auth session.

The first effect after that read-only guard is **CREATE FUNCTION** for
`business_auth.triniti_business_cancel_signin(uuid,uuid,uuid)`. Four more CREATE
FUNCTION statements install `revoke_member_sessions`, `revoke_device_sessions`,
`revoke_owner_sessions` and `cleanup_session`. None uses CREATE OR REPLACE or
invokes the stored body. DELETE and UPDATE operations inside those dollar-quoted
bodies remain stored code. The transaction installs no trigger that could invoke
them. No Auth session, private grant, ordinary application row or provider resource
is changed by those stored statements during installation.

The remaining DO block only reasserts existing private-table RLS and revokes;
schema/function revokes keep PUBLIC, anon, authenticated and service_role out.
The marker advances to stage 7 and the transaction commits. No public function,
activation trigger, restrictive business policy, request hook or application grant
is installed until stage 8. There is no savepoint or exception handler that could
continue a failed stage-7 CREATE or commit a partial installation.

## Delayed and concurrent identical requests

A request whose guard runs after another has committed sees stage 7 and fails the
stage-order/catalog check before effects. If two requests both read stage 6, they
next try to create the same first private function. The actual PostgreSQL 17.11
catalog has the valid, immediate unique `pg_proc_proname_args_nsp_index` over
`proname, proargtypes, pronamespace`. At most one transaction can commit that
function key. The other waits for the conflicting transaction and then fails
uniqueness, or reaches the existing lock/statement timeout. Any failure rolls back
its complete transaction, including later private functions and the marker. If the
first transaction rolls back, the other may become the sole successful installer.

The source-derived after fingerprint is `070a20dc374c50741b19573e21822048`
with 107 catalog rows. The postflight also requires one source-identical stage-7
journal entry, five exact new bodies, closed private privileges and no public
activation. A committed catalog without its matching provider journal is not
accepted as a complete operation; the provider boundary must be resolved.

## Actual DDL event-trigger boundary

The active event-trigger inventory was inspected at **04:06:23 UTC** and is saved
in `business-stage7-ddl-trigger-review.json`. Only
`extensions.pgrst_ddl_watch()` applies to this transaction's command tags. Its
inspected body emits `NOTIFY pgrst, 'reload schema'`; PostgreSQL delivers that
notification only when its transaction commits. The other enabled handlers apply
to table creation, extension changes or drops, none of which stage 7 performs.
The prepared fresh preflight pins the complete enabled-trigger names, tags,
handler identities and body hashes so an intervening trigger change fails review.

Provider error logs and brief lock contention remain possible. SQL timeouts do
not bound time spent waiting for a provider confirmation before SQL starts.
The previously interrupted child call remains unknown: its local lost cell is
not cancellation. No claim is made that a root context inherently fixes provider
availability; the main-thread call can preserve the ordinary user confirmation.

## Required conditions and ownership

Use `business-stage7-next-apply-package.json` and the exact request it references.
Root owns the next mutation. Immediately before it, run
`business-stage7-recovery-preflight.sql` and require `allGatesPassed: true`.
Besides the unchanged source guard, it verifies all five target functions absent,
no stage-7 journal, the actual immediate unique function index, the reviewed DDL
handlers, closed private ACLs and no other active/open client or prepared
transaction. Quiescence is only a snapshot; coordinate so no unrelated privileged
writer changes the state afterward.

Keep the source, destructive classification, transaction and timeouts unchanged.
Use only `supabase_apply_migration`. After a terminal result, run
`business-private-stage-observation.sql` and require every explicit gate in the
package before stage 8. Do not infer success from existence alone or cancel old
receipts. This review does **not** authorize retrying support, notification,
stage 8 or an arbitrary future migration.

Primary PostgreSQL contracts used in this reasoning:

- [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [Index uniqueness checks](https://www.postgresql.org/docs/17/index-unique-checks.html)
- [Transactional NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html)
