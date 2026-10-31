# Reviewed staged business authentication installation

This package is an alternative **QA installation procedure** for the unchanged
reviewed migration `20261030034752_business_bound_auth_sessions.sql`. It is not a
new authorization design, a production cutover, or evidence of hosted success.
The original source SHA256 is
`66a842a61708dbbe5715352484f9bee0c42665e8d2d3418b1a06e65854723996`.

The full 33,277-byte migration previously produced no connector result or
approval form, and independent database checks found no installation. Smaller
reviewed migrations, including the 9,338-byte creative-book foundation,
subsequently succeeded through the same supported tool. This package narrows the
transport and approval boundary while retaining a complete, reviewable rollout.
Neither payload size nor a lost elicitation has been proven to cause the stall.

## Exact source and activation boundary

`candidate.json` records every original statement index, original and generated
hash, temporary function signature, expected prior/next catalog fingerprint, and
the exact official Supabase MCP destructive classification. `combined.sql` is a
local fixture input. Apply the numbered SQL units individually, in order, using
`supabase_apply_migration`; do not submit the combined file or route DDL through
`execute_sql`.

Original substantive statements 3–50 each occur once. The six new public
functions are created under the private `business_auth` schema with the same
basename and **byte-identical function bodies**. Only the CREATE header's schema
changes. The original transaction boundaries and timeouts are regenerated for
each unit, with a fixed local `pg_catalog` search path for reproducible catalog
deparsing.

Every committed intermediate stage has private-schema access, table privileges,
and function execution denied to `PUBLIC`, `anon`, `authenticated` and
`service_role`; every private table has RLS enabled and no policy. No new public
function, trigger, restrictive policy, request hook, data seed or grant is active.
The already-installed creative and notification functions therefore continue to
observe the old public contract. A schema comment records the exact source hash
and completed stage; it is removed at activation and leaves no extra permanent
installer object.

The final transaction locks `public.profiles` and `auth.sessions` in SHARE ROW
EXCLUSIVE mode, with the existing three-second lock timeout. It rechecks all
drift and existing-business-session gates; moves the six private functions to
their intended public schema; installs the five original triggers; seeds current
business identities; installs the original restrictive policies, request hook,
existing-function replacements and grants; removes the stage comment; and
notifies PostgREST. A failed statement rolls back all activation together. The
profile trigger/lock precedes the seed, preventing a concurrently created
business profile from falling between those operations.

The final activation unit is larger than the private units. Its exact byte
count is in the manifest. Splitting that boundary would expose partially active
authorization or replace existing functions before their public guard exists.
The package retains that atomic boundary and the complete inline drift guard.

## Approval semantics

The exact reviewed official classifier is executed by the builder, not
reimplemented. Original statement 29 (expired attempt/grant cleanup inside the
member-sign-in function) and statement 39 (dependent session cleanup trigger
function) are classified destructive. They remain explicit, unchanged, and
classified destructive in stages 4 and 7 respectively. Their provider approval
path must be preserved. Do not rewrite, encode, reorder their function bodies,
set `skip_elicitations`, or introduce a different execution bridge to avoid a
confirmation requirement.

If a call produces no result, its remote outcome is unknown. Do not assume the
timeout canceled the database operation or retry blindly. Independently inspect
the migration journal, stage marker, catalog fingerprint and active migration
queries. The package can remain safely private at any completed stage; do not
expose grants or activate downstream Edge functions while it is incomplete.

## Review and local validation

The builder expects the official classifier source from commit
`ed5084d1957541c5130f551d5f7e0fee5e3ddfeb` at
`packages/mcp-server-supabase/src/tools/destructive-sql.ts`. It refuses a source
whose SHA256 is not
`e350da140fa468ed224fca628885cd6212a78aaf7cb7ae1ff4d8468c0ba52c46`.

```sh
SUPABASE_MCP_DESTRUCTIVE_SQL_SOURCE=/path/to/reviewed/destructive-sql.ts \
  node supabase/tests/rpc-authorization/build-business-auth-staged.mjs
node supabase/tests/rpc-authorization/test-business-auth-staged.mjs
PLATINUM_QA_BUSINESS_AUTH=1 BUSINESS_AUTH_STAGED=1 \
  node supabase/tests/rpc-authorization/test-business-auth-chain.mjs
```

The builder applies the exact original and staged procedures to independent
matching QA fixtures and requires identical final function definitions, owners,
ACLs, schema/table/column/constraint/index definitions, triggers, policies and
request-hook settings. Account seed IDs must also match. The staged fixture
includes the installed creative and notification contracts and exercises every
intermediate state, wrong-stage and data/schema/function/ACL drift rejection,
new business-session cutover rejection, and late activation rollback. The
existing 27-case business suite then exercises the staged result's owner,
member, device, issuance, refresh, revocation and media behavior.

These are local SQL/provider-contract fixtures. They do not prove actual hosted
Auth token issuance, installed-client cutover or external provider behavior.

### PostgreSQL catalog version normalization

The first hosted foundation postflight exposed one catalog-version difference:
PGlite uses PostgreSQL 18.6 and records 28 additional named `NOT NULL` constraint
rows; QA uses PostgreSQL 17.11 and represents those constraints in
`pg_attribute.attnotnull`. The 92 other catalog records, including every raw ACL,
matched exactly. The inventory now excludes only table constraint rows whose
`contype='n'` while continuing to fingerprint every column's mandatory
`attnotnull` flag. A regression drops that flag before each subsequent stage and
requires drift rejection. No ACL normalization or hosted schema change is used.

This follows the primary PostgreSQL
[18 release notes](https://www.postgresql.org/docs/18/release-18.html) and the
[17 catalog contract](https://www.postgresql.org/docs/17/catalog-pg-constraint.html).
The original foundation SQL and provider journal remain unchanged. The initial
manifest is retained at `review/candidate-before-catalog-normalization.json`;
the mismatch, complete raw diff and corrected future guards are recorded in the
installation evidence.

### One bounded payload-size diagnostic

The normalized seven-stage package installed private stages 1 and 2. Its 10,066-byte
classified member-sign-in stage produced no connector result within 45 seconds;
an independent read still showed exact stage 2 and no active migration query.
The current eight-stage package separates original statement 28 (private device
helper) from statement 29 (private member-sign-in function). The latter remains
byte-identical and classified destructive, with full guards/fences, and is below
8,000 bytes. Installed stages 1 and 2 remain byte-identical. This single reviewed
diagnostic distinguishes a smaller payload while preserving the provider's
approval semantics; it is not permission to repeat stalled calls. If it also
stalls, stop apply attempts, verify actual remote state and retain the safe
private stage. The prior numbered files and manifest are retained under
`review/seven-stage-normalized/` as evidence, not alternative current steps.

## Hosted order and postflight

1. Review the exact generated files and manifest, plus the local verification
   receipt. Inspect current hosted baseline functions, business Auth sessions,
   table RLS, migration history and request-hook configuration. QA project ref
   must be `uaulhuelcfkjwojtymmw`.
2. Apply one numbered unit through `supabase_apply_migration`, preserving any
   provider confirmation. Record tool outcome and provider migration version;
   never assume the local filename became the hosted version.
3. Run the read-only `postflight.sql` and compare the stage marker and complete
   expected fingerprint. Independently check all private privileges and public
   activation objects remain absent. Verify the provider's recorded SQL hash.
4. Continue only after that exact stage passes. At final activation, verify the
   private/function catalog against the manifest and require a correct
   restrictive policy on every current eligible hosted RLS table. Hosted table
   enumeration may differ from the lightweight fixture; do not substitute its
   policy count for actual coverage.
5. Only after final postflight may the dependent business Edge bundles deploy.
   Then install the reviewed original-music/operations/catalogue backend chain
   through its own complete, reviewed installation procedure and postflights.
   Music uploads, workers, ingestion and catalogue playback remain disabled
   until their separate readiness and real acceptance gates pass. Licensed
   catalogue access remains disabled pending licensing.

The original migration is retained as the immutable reviewed specification.
This alternative package lives outside automatic migrations so a routine CLI
push cannot accidentally install an incomplete staged proposal. If installed,
record the actual provider stage/version mapping before deciding how future CLI
history reconciliation should be represented. Do not fake a migration-history
row or claim the original single migration ran.
