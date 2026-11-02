# Bounded feed delivery: rollout and remaining scale gates

This is an additive, **disabled-by-default** delivery protocol. It changes how
clients learn that existing feed data changed. It does not change feed ranking,
layout, wheel/touch scrolling, row keys, media ownership, or the new-posts pill.
It is capacity preparation, not evidence that a deployment supports five million
daily active users.

Migration: `supabase/migrations/20261102070343_feed_live_broadcast.sql`, generated
with Supabase CLI 2.122.0. Applying it does not create a Cron job or enable the
capability. Old clients and deployments without the capability continue using
the existing subscriptions and RPC contracts.

## Delivery and client budgets

| Work | Bound and conditions |
|---|---|
| Interested posts | 12 by default, hard maximum 24, including a small look-ahead window. |
| Logical private channels per feed | At most 27 by default: 12 post topics, up to 12 author topics, one viewer topic, one head topic, one recovery topic. Hard maximum 51. A populated new-posts pill removes the head topic. |
| Socket ownership | Topics share a reference-counted lease on the same SDK client. Rapid focus/account teardown waits for the previous leave before acquiring that same topic. Different topics may have asynchronous leave acknowledgements in flight. |
| Scroll subscription changes | Trailing 350 ms debounce and a two-second cooldown for ordinary window replacements. A completely disjoint default window can create up to 24 joins and 24 leaves per replacement; at the hard maximum it can create 48 of each. Entry, session/focus recovery, capability probes and head-pill changes are additional lifecycle work. |
| Canonical live state | One RPC for at most 24 IDs; 350 ms coalescing; 1.6–2.4 seconds of jittered cooldown after a successful dirty read. There is at most one in-flight read, with a trailing read when another hint arrives. Continuous viral changes do not starve displayed updates. |
| Healthy idle feed | No recurring coordinator state/head reads. Existing foreground/focus and four-minute full feed/media/access refreshes remain. |
| Global new-post hint | One `get_feed(limit:20)` read, or the existing bounded native Discover equivalent. No retained-page visibility sweep, media hydration, or metadata fanout. At least 15.8–16.2 seconds after the previous check finishes; first join performs one catch-up check. Stops while the pill is populated. |
| Targeted privacy change | An author/viewer invalidation rechecks applicable retained IDs through the existing visibility RPC in batches of 100, at most two requests in flight. This is separate from the global head check. |
| Degraded connection/worker | Bounded 24–30 second recovery reads, plus coalesced dirty retries with backoff up to 30 seconds. A transient capability transport failure does not re-enable global Postgres Changes on already-enabled clients. |
| Recovery hints | Refresh interested IDs, retained access and the head. Repeated global recovery hints budget retained-access sweeps to approximately once per 15 seconds. A changed recovery generation on the normal probe also catches a missed recovery hint. |
| Hidden/background feed | Disconnects its leases, cancels current reads, stops new access batches, and invalidates old callbacks. Resume rejoins and reauthorizes. |

These are per-client logical bounds. They are not purchased provider quotas.
Private-channel authorization performs database policy checks when joining;
the post policy calls the existing canonical visibility function. Repeated
scrolling therefore still has authorization cost. At large concurrency, count
all other app channels, SDK heartbeats, joins/leaves, reconnect bursts, transient
in-flight leaves and delivered Broadcast messages. One socket with 27 topics is
not 27 sockets, but it is 27 logical subscriptions. A custom provider quota and
measured reconnect/authorization budget are required before a five-million-DAU
claim. Daily users must first be converted into active concurrency and session
behavior; they are not a concurrent socket count.

## Authorization and consistency

Post events contain only a known `post_id`. Author, viewer, head and recovery
events contain no content or actor identity. Clients display values only after
an authenticated, security-invoker canonical read. Deleted, hidden, blocked,
private and otherwise inaccessible posts are absent from that read.

The private-topic policies include restrictive guards **TO PUBLIC**, so an
older broad permissive policy cannot let authenticated or anonymous clients read
unauthorized feed topics or forge feed events. The topic authorization helper
returns false immediately for a missing authenticated user. It does not bypass
posts/profiles RLS. The service sender uses its intended privileged path.

Native and web fence slow full refreshes, metadata enrichment and live snapshots
against newer privacy removals and local like/save/repost mutations. An older
request cannot roll a confirmed local action backward. Newer authorized absolute
values replace it after settlement. Web snapshot writes use the cache revision
captured at request start, so a slow refresh cannot recreate disk content after
a privacy purge. Edited text still passes existing muted-word filters. Removal
does not become a permanent user hide; later authorized reads may restore it.

## Durable queue and outage behavior

Healthy writes coalesce by topic in two-second time buckets. A drain claims only
expired buckets using `FOR UPDATE SKIP LOCKED`, with a maximum of 1,000 rows per
call. Coalescing does not postpone the original due time. Send failures retain
the row and use bounded retry backoff. A transaction committed after a previous
drain remains visible to the next drain; rollback emits nothing.

Current healthy writes use a different bucket from a slow drain, avoiding the
normal writer-versus-drain row-lock coupling. Privacy topics use a consistent
order for reciprocal block changes. Profile heartbeats compare access fields
directly and return before queue work or whole-profile JSON conversion.

When the drain heartbeat/backlog exceeds 15 seconds, or delivery has failed,
ordinary per-topic accumulation stops. Canonical post/comment/privacy writes
continue. Outage transactions instead retain one marker per transaction in a
fixed 1,024-shard recovery queue. The recovery generation changes only when
transitioning into recovery; ordinary outage activity does not repeatedly write
the settings singleton. A marker upsert holds its lock until the canonical
transaction commits, so a late writer cannot disappear behind an earlier
recovery hint. The writer rechecks the recovery flag after that wait. Queue locks
precede settings locks in both writer and drain paths.

The queue bound is **normal traffic captured during the 15-second health window,
plus in-flight transactions, plus at most 1,024 outage markers**. It is not a
fixed total row cap independent of write rate. The drain coalesces marker shards
into a private, ID-free recovery hint. A recovery writer can wait for its shard
while a drain completes; this rare-path contention is deliberate to retain a
late final commit. Measure that wait and keep the worker transaction deadline
short. No trigger performs per-subscriber fanout.

The worker heartbeat and successful SQL sender call do not prove browser/device
delivery. In particular, provider-side partitions, transport, authorization and
quotas require hosted verification. The local SQL fixture uses a transactional
sender stub and does not establish the provider's runtime guarantees.

## Activation sequence

1. Apply the additive migration to isolated QA first and verify it remains
   disabled. Check the actual deployed schema, effective grants, pre-existing
   Realtime policies, RLS and expected RPC result types before production use.
2. Verify private Broadcast end to end with separate authenticated test users.
   Check public/private posts, hidden/muted content, block/unblock, follower and
   community-membership changes, deletions, comment edits and account switching.
   Verify anonymous access and forged client feed sends are rejected even when
   a broad unrelated policy exists.
3. Configure a supervised bounded drain. An operator example, after confirming
   the installed Cron version supports seconds, is:

   ```sql
   select cron.schedule(
     'feed-live-drain',
     '1 second',
     'set statement_timeout=''5s''; select public.drain_feed_live(1000);'
   );
   ```

   The five-second deadline is a proposed starting budget, not a measured
   production result. Confirm transaction rollback on timeout and job behavior
   under overlap. Establish bounded `cron.job_run_details` retention for this
   job: a one-second schedule can otherwise create 86,400 log rows per day.
   Use an existing approved retention mechanism or a bounded deletion job;
   do not disable audit logging for unrelated jobs.
4. Verify worker runs, oldest pending age, retry attempts, recovery generation,
   row-lock waits and actual subscriber receipt. Inspect the oldest indexed
   pending rows and scheduler status; avoid repeated full queue counts on the
   request path. Stop the worker deliberately, continue synthetic canonical
   writes, and prove bounded outage markers, recovery, final late commits and
   no rollback events before activation.
5. Test client capability/fallback against both an older server and a disabled
   server. Confirm normal feed reading, comments, sharing, reposting, privacy,
   discovery and the new-post pill remain available.
6. Only after those checks, a service/operator may explicitly call:

   ```sql
   select public.configure_feed_live(true);
   ```

   Enabling requires a recent successful drain. Continue a small monitored
   release before wider activation. Disable with `configure_feed_live(false)`
   if delivery or quotas degrade; updated clients fall back at their next
   capability/state check. Older clients retain their prior behavior.

Do not apply production-scale synthetic load to a live project without an
isolated environment, representative accounts/content, agreed provider limits
and explicit load-test scope. The rollout must include hot posts, private
audiences, irrelevant global inserts, cold/reconnecting clients, outages and
long scroll sessions. Proposed gates include no steadily growing queue, no
write deadlocks, bounded p95/p99 drain/lock waits, no wrong-account or revoked
content, complete final-burst recovery and stable media/scroll behavior.

## Deliberately unresolved retained-history bound

The realtime interest window is bounded; mounted feed history is not fully
bounded. Native keeps all paged rows and associated maps, although FlatList
limits mounted rendering. Web retains every feed DOM row to preserve the current
wheel-scroll behavior. Its interaction store cannot evict entries that still
have mounted listeners. Tab memory has a 16-tab/30-minute bound, but a tab can
contain all its retained rows. Disk snapshots are bounded to 20 eligible public
rows, 160 KB and 15 minutes.

Do not silently truncate history or restore the prior scroll-jumping
virtualization as part of activating this protocol. A separate solution needs
measured-height page segments, a bounded active-page cache, an account/session
scoped cursor-and-anchor ledger, reload-before-entry of evicted segments and
input-aware scroll restoration. Test long sessions, returning to prior tabs,
variable-height images/video, media renewal, browser back/forward and immediate
wheel/touch intent before declaring that memory gate solved.

## Local verification scope

- `tests/feed-live.test.cjs`: production coordinator with deterministic clocks,
  canonical RPC doubles and private-channel doubles. Covers final bursts,
  hot updates, initial join gaps, bounded head/scroll/recovery work, background
  cancellation, owner changes and SDK topic-lease reuse.
- `tests/feed-live-merge.test.cjs`: native publish-time privacy/mutation fences
  through delayed hydration, while retaining new media grants.
- `web/tests/home-feed-quality.cjs`: production controller including head work
  with 1,000 retained rows, muted edits, stopped access batches, cached tab
  behavior and rendered/disk privacy races.
- `web/tests/media-social-regressions.cjs` and
  `web/tests/feed-repost-live.cjs`: actual interaction store/hook reconciliation
  without per-card live-read fanout.
- `supabase/tests/feed-live.test.cjs`: real isolated PostgreSQL with canonical
  visibility helpers and a synthetic transactional sender. Covers broad legacy
  policies, anon denial, 1,201 separate outage transactions, the shard bound,
  late commits, rollback, slow sends and safe recovery lock/generation order.

Current relevant primary guidance:

- <https://supabase.com/docs/guides/realtime/broadcast>
- <https://supabase.com/docs/guides/realtime/authorization>
- <https://supabase.com/docs/guides/realtime/postgres-changes>
- <https://supabase.com/docs/guides/cron>
- <https://github.com/citusdata/pg_cron>

Current Postgres Changes documentation permits DELETE filters only with
`REPLICA IDENTITY FULL`; the protocol does not rely on the older blanket claim
that DELETE can never be filtered. Its reason for using Broadcast is the
per-subscriber authorization/fanout cost of global Postgres Changes at large
concurrency.
