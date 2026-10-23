# RPC authorization regression tests

Run this isolated test package with:

```sh
npm ci --prefix supabase/tests/rpc-authorization
npm test --prefix supabase/tests/rpc-authorization
```

The tests execute PostgreSQL in a disposable local PGlite instance. They do not
connect to Supabase, require credentials, or contact real users/devices. The
package pins PGlite independently of the application's dependencies.

The recorded migration is the only source of patched SQL. The loader verifies
its SHA256 and extracts the individually tested components by sealed byte
offsets. Fixtures preserve the vulnerable function definitions and relevant
trigger behavior; synthetic schemas and identities provide minimal surrounding
tables, roles, and request settings.
Original CRLF bytes inside deployed function bodies are retained so source hash
preconditions remain meaningful on every checkout.

Coverage includes two push-registration exploits, direct community admission,
group-chat membership bypass, role rejection, legitimate self-registration and
metadata updates, device-token reassignment, community approval and member
triggers, limited membership, service calls, and group idempotency. Source/ACL
drift tests verify that a later precondition failure rolls back earlier changes
when the migration runs as one transaction. There are 13 push checks, 19
community/group checks, four atomicity checks, and a read-only postflight with
six expected role denials.

The helper intentionally still permits synchronization of another already
entitled group member. It never establishes the underlying community/club
membership. The existing checked admission wrappers retain their internal
access, and the explicit service-role contract remains available.

PGlite 0.5.10 uses PostgreSQL 18.6 WASM. These single-connection tests do not
replace PostgreSQL17/PostgREST verification, concurrency testing, or real device
delivery tests. The push fixture's UUID default uses `gen_random_uuid()`; its
table, RLS, deduplication trigger, and vulnerable function come from the sealed
source. Group fixtures use the exact affected function/trigger bodies with
minimal synthetic tables. This focused patch does not audit every privileged
routine or repair the separate legacy direct community-insertion client flow.


## Admin contracts and integration chain

`node test-admin-commands.mjs` loads the complete public schema reference, applies
all October 22–23 candidate migrations in order, and executes admin operations
against PostgreSQL in PGlite. It covers all current admin operation names,
role-matrix parity, live MFA/session checks, audit rollback, idempotency, safe
provisioning identity checks, moderator-removal persistence, and financial history
retention during deletion requests. `node test-pending-migration-chain.mjs` also
checks the full migration sequence with function body checking enabled.
Both suites are included in `npm test` in this directory.

Managed Auth, Storage and Vault APIs are local fixtures. Duplicate concurrent
JavaScript requests exercise command replay, but PGlite serializes database work;
this is not a multi-backend lock/deadlock stress test. Hosted GoTrue account
creation, MFA and browser sessions still need deployment integration checks.

A deletion command disables account access and creates a `retention_review`
request visible at `/users/deletions`. It deliberately preserves the auth identity,
financial history and audit records. It does not claim to finish personal-data
erasure; a retention-aware processor is a separate integration.
