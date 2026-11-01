# Exact stage-4 recovery review

**Conclusion:** one further byte-identical stage-4 submission through the normal
supported migration tool is defensible under a fresh exact stage-3 preflight.
The prior requests remain unknown. This is a narrow concurrency assessment,
not a claim that changing the calling agent fixes the provider tool.

Reviewed source:
`supabase/ops/qa/business-auth-staged-20261031/04_private_member_signin.sql`,
SHA256 `ba49c5c8b8545952288ac1885bcf3421d4b42bb21c054d87391b891ed7edb749`.
No SQL, guard, permission or timeout was changed and this review executed no
migration. The complete current user authorization already covers installation.

## Why identical delayed requests cannot apply the stage twice

The source begins one explicit transaction. Before creation, its SET LOCAL
commands are session/transaction configuration, and its DO guard only reads the
current role, exact stage marker, catalog fingerprint, private-table counts,
RLS exposure and existing business sessions. It then creates exactly one new
function with `CREATE FUNCTION`, without `OR REPLACE` or an error-catching clause.

At 03:21:29 UTC, the actual PostgreSQL 17.11 target had a valid, immediate unique
`pg_proc_proname_args_nsp_index` over `(proname, proargtypes, pronamespace)`.
The stage-4 signature was absent and the stage-3 marker remained present.

| Ordering | Database result |
| --- | --- |
| One request commits before a delayed request checks the guard | The delayed request sees stage 4 or a changed catalog and raises before creating anything. |
| Two requests both pass the old stage-3 guard | Both attempt the same function key. PostgreSQL waits on the competing uncommitted unique entry; after a winning commit, the other conflicts and its transaction aborts. |
| The first request rolls back | A waiting identical request may proceed; only the successful transaction can commit the function and stage-4 marker. |
| A wait or any statement fails | The retained 3-second lock and 60-second statement limits can abort the SQL. No exception handler resumes after the duplicate CREATE, and no savepoint recovers the failed transaction. |

PostgreSQL documents that a function with the same name and input types cannot
already exist in the same schema, and that unique-index insertion waits for a
conflicting uncommitted transaction before deciding whether to reject it.
See [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
and [Index uniqueness checks](https://www.postgresql.org/docs/17/index-unique-checks.html).
The uniqueness rule is observed directly on this target rather than assumed
only from documentation.

## Effects and limits

The function body's expiry DELETEs, rate limiter, row locks and grant INSERT are
stored definition text. This migration never calls that function. Its subsequent
DO block reasserts RLS and revokes private access; schema/function revokes and
the stage-4 comment share the same explicit transaction. Any losing transaction
rolls them back. There is no public wrapper move, hook activation, provider call,
session issuance, original-audio activation or canonical user-content mutation.

The target's active DDL event triggers were also inspected. The only applicable
one is `pgrst_ddl_watch`, which sends a schema-reload NOTIFY. The other active
triggers target table creation, extension creation or drop events absent from
this stage. PostgreSQL delivers NOTIFY only after the enclosing transaction
commits: [NOTIFY](https://www.postgresql.org/docs/17/sql-notify.html). Extra attempts
can still produce provider/SQL error logs and short-lived lock contention; the
review does not claim literally no operational trace.

This proof is limited to identical reviewed stage-4 transactions, an exact fresh
preflight, normal PostgreSQL transactional behavior, and no unrelated privileged
writer changing the guarded schema/data concurrently. It does not prove retry
safety for atomic support, notification dispatch, another business stage or any
other migration. It also does not bound time spent in a provider confirmation
interface before SQL reaches PostgreSQL; earlier tool waits exceeded the SQL
timeouts without observed active statements.

## Coordinated recovery boundary

The coordinator may choose one normal supported attempt after its fresh complete
preflight, leaving the SQL and destructive classification untouched. Keep all
earlier outcomes recorded as unknown. A terminal tool result and exact catalog,
ACL, data and migration-journal postflight are still required. If another copy
wins the race, inspect and accept only the exact intended stage-4 result; never
treat a duplicate error itself as successful installation.

The earlier blanket no-retry rule was a conservative operational choice. This
source-specific uniqueness/transaction evidence supports revising it for this
one candidate without changing user authorization or bypassing a provider control.
The successful readiness call also occurred in this child lane (cell g2:88), so
there is no evidence that root-agent context alone makes the provider available.
