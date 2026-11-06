# Prepared feed rollout

The migration `20261105044917_prepared_feed_snapshots.sql` installs a default-disabled prepared-ranking path behind the existing `get_feed` RPC. It preserves the existing full-card result shape and does not persist media capabilities or rendered cards.

An authenticated read queues only that viewer, session scope and feed mode when its existing `x-client-info` header contains the exact `platinum-cache/1` token. Whitespace and comma delimiters are accepted. Legacy clients retain canonical responses without queueing work. New native and web clients send the token and support expired-cursor recovery. After the two narrow-ranking follow-up migrations, the bounded worker ranks up to 200 IDs with one private frontier proof. It checks exact scores at growing candidate intervals and returns only IDs and ranking keys. Unsupported or unproven frontiers use the unchanged canonical candidate/diversity expressions without card hydration. Ranking runs as the dedicated `prepared_feed_reader` role, which is NOLOGIN, NOBYPASSRLS and inherits the authenticated policy role. The worker never ranks with service-role RLS bypass. The verified request claims are private, expire no later than their JWT, and are removed by bounded cleanup. Account deletion cascades through both tables.

Prepared head pages remain fresh for 60 seconds. Existing cursors refer to an immutable snapshot for up to five minutes. At most eight snapshots remain per viewer/scope/mode. Follow, block, mute and hidden-post changes invalidate head generations immediately. Every returned card is batch-hydrated through current caller visibility and RLS, including on old snapshots. Hydration starts with the requested page size or 20 IDs, whichever is greater, and refills through at most the original 200 IDs after privacy changes. An ordinary 20-card warm page hydrates 20 IDs. Deletion, blocks, private audiences and hidden posts can therefore remove a previously ranked ID immediately.

Prepared cursors occupy a disjoint exact-integer double-precision range below -4,000,000,000,000,000. Clients must treat `sort_key` as opaque. Exhausting the prepared 200 rows resumes the canonical query using its original private ranking key. An expired or wrong-scope prepared cursor returns SQLSTATE `22023` with message `PREPARED_FEED_CURSOR_EXPIRED`. Clients retain existing cards and scroll position, reset the request cursor and merge a new head page after this error. They must not repeatedly retry the expired cursor or clear the list.

## Verification before activation

Run `PREPARED_FEED_NARROW=1 node --test supabase/tests/prepared-feed-db.test.cjs` after installing the indexed-feed and deterministic-author-tie dependencies. The 16 cases cover exact 200-ID ordering across modes and enabled/disabled frontiers, tied author boundaries, hydration-free preparation, current access and stale cursors. Run `node supabase/ops/prepared-feed-staged-20261105/verify.cjs` to verify staged installation equivalence. For an isolated PostgreSQL server, set `PC_TEST_PSQL`, a Unix-socket `PGHOST`, and the disposable database name `PGDATABASE=pc_scale_prepared_feed`. The suite deletes its disposable fixture schemas and must never target a hosted project.

Review the hosted migration with the existing schema and permission advisors. Confirm the role does not already exist and that no existing function called `prepared_feed.canonical` exists. The migration intentionally rejects an existing role instead of adopting unknown privileges. Check all application clients understand expired prepared cursors before activation.

The existing reader remains the fallback while preparation is disabled, missing, expired or awaiting work. Reads for unknown modes retain the canonical implementation. No paid provider, new infrastructure or media processing is activated.

## Explicit QA activation

Install the migration in QA first. The supported staged alternative is documented in `prepared-feed-staged-20261105/README.md`. Follow it with `20261105051142_prepared_feed_narrow_ranking.sql` and `20261105051152_prepared_feed_single_snapshot_rank.sql`, then `20261105051338_prepared_feed_bounded_hydration.sql` and `20261105051457_prepared_feed_client_capability_gate.sql`. Keep preparation disabled until the native PostgreSQL capacity gate passes. Create one bounded database scheduler only after validating the installed functions:

```sql
select cron.schedule(
  'prepared-feed-refresh-v1',
  '10 seconds',
  'set statement_timeout = ''8s''; select public.drain_prepared_feed_v1(1);'
);
select public.configure_prepared_feed_v1(true);
```

Do not add another schedule if this job name already exists. Reuse its job ID through `cron.alter_job`. The job invokes one demand item per tick, builds at most one 200-ID snapshot and prunes at most 500 expired rows from each table. Six failed preparations stop automatic retries until the demand expires or a viewer preference changes. This initial operating rate is deliberately bounded and is not a five-million-DAU capacity setting.

Use two controlled authenticated actors to request the same modes. Verify their rows and cursor scopes differ, the second request hits a prepared snapshot, a newly hidden/private/deleted row disappears, and expired cursors keep the existing client list visible while recovery completes. Record `EXPLAIN (ANALYZE, BUFFERS)` for the canonical miss and prepared hit without attributing mixed shared-server activity to this change.

## Observation and rollback

`select public.prepared_feed_status_v1();` returns bounded queue/failure counts, oldest due work, current activation and fixed row/TTL limits. Values capped at 10,001 mean the bounded count reached its observation limit. Observe queue age, worker duration, fallback frequency and database load before changing throughput.

To stop serving prepared heads, call `select public.configure_prepared_feed_v1(false);`. Existing negative cursors still need a refresh if they cannot be resolved, so deploy the client recovery path first. Keep the scheduler running for expiration cleanup or explicitly prune through the same worker until retention expires. No snapshot or request contains an API token.

Production activation is a separate observed rollout after QA. This implementation provides prepared ranking and bounded work, not measured production throughput or a five-million-user sign-off.
