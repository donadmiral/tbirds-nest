# Bounded inbox clients

This change prepares the personal phone inbox and all existing web `MessagesApp` contexts for the additive, default-off inbox reader. It preserves the existing layouts, list styles, chat history, read receipts, composer, drafts and forwarding flow. It is a request-shape and concurrency change, not a demonstration of production capacity at five million daily active users.

## Deployment contract

- Apply and validate the additive reader migration and its RLS oracle tests before enabling `read_paging.settings.inbox_ready`. The operator entry point is the service-role-only `configure_paged_readers`; preserve the separate book setting when changing inbox readiness.
- Include `20261102075616_bounded_inbox_mentions.sql` in that validation. Its native mention reader uses the same disabled inbox capability, keeps both underlying tables' RLS, denies anonymous/service-role execution, and creates the reviewed recipient/time/message index. An unexpected index-name collision fails the transaction; inspect the definition and production build cost before rollout. The migration has a two-second lock timeout and a 30-second statement timeout.
- The clients discover `get_paged_reader_capabilities`. An absent function or an explicitly disabled capability selects the existing legacy reader. A failed authorized v2 read is surfaced as a recoverable error and does not silently fall through to another authorization path.
- Capability discovery is cached in memory for 60 seconds per SDK client/viewer. Rollback is therefore not instantaneous for a mounted client. Continuation reads on a disabled server may fail until a fresh first-page read observes the disabled capability; loaded content remains available with the existing retry control.
- Native Market/Jobs and acting-as-business inboxes have different historical projections and authorization/count semantics. Their separate adapters and migrations are included in this preparation batch and have independent SQL/native regression suites; the personal reader is not substituted for them. Their enabled rollout still requires the corresponding QA and capacity gates.
- No infrastructure, feature flag, scheduled worker, production load test or deployment is performed by these client changes.

## Reads and list behavior

| Operation | Enabled reader behavior |
| --- | --- |
| New personal phone inbox | One page of at most 30 conversations, full archive/total summary, optional deferred private group-avatar grant |
| New web inbox | One page of at most 30 conversations, optional bounded group-avatar grant |
| Scroll near the list end | One additional 30-row page; overlap guards and ID deduplication preserve live ordering |
| Search / Groups / Unread | A debounced first page using the server’s complete authorized search/filter scope; not a filter over only the first cached page |
| Native Archived | Full archive count is independent of loaded rows; the existing archive view deliberately ignores the active search and Groups/Unread filters |
| Deep link / selected cached chat / newly created chat | Authorized lookup of the specific ID without downloading intervening pages; absence from page one does not close the selected conversation |
| Foreground / reconnect / explicit refresh | Re-read only the range already loaded, then reauthorize retained rows displaced from that range in batches of at most 50 IDs with at most two simultaneous batches |
| Live conversation/message change | Coalesce affected IDs and read at most 50 at a time; ordinary enabled-mode updates do not reload every loaded conversation |
| Web forwarding | Independent paged destination collection, so an inbox search or Unread tab cannot hide a valid recipient; existing community-chat destinations are retained |
| Web Market unread dot | Exact full-inbox aggregate RPC; it does not sum one page or fetch conversation rows to calculate the badge |
| Native mention highlights | Latest authorized mention timestamp for the loaded, relevant conversation IDs only; at most 50 IDs per RPC and two simultaneous reads |

The first enabled read also needs one capability RPC unless its 60-second cache is warm. Legacy behavior stays available while the capability is off; the client optimization is not effective for a deployment that has not completed the reader rollout.

### Concrete local request comparisons

A synthetic inbox containing 50,000 rows returns 30 rows on a fresh enabled opening. Fetching a deep-linked row outside that page adds one ID lookup with an upper limit of 50, not a traversal through all older pages. A 95-row synthetic web inbox opens 30 rows and reaches all 95 in four page requests with no duplicate cards. An inbox with 125 archived conversations displays 125 in the archive entry while only 30 active rows are loaded.

The prior native personal reader performs four parallel initial reads (DM conversations, group memberships, settings and unread counts), followed by profile/group detail reads when those IDs exist. The prior web reader performs three initial reads followed by profile/group details. These full-inbox queries remain the compatibility fallback. The v2 path replaces their conversation projection with one bounded page RPC; private avatar grants remain separate and authorized.

The live update queue starts a batch after 200 ms rather than resetting the timer on every event. After completion it waits 640–960 ms before another queued batch. It retains events that arrive during a pending read, retries failures with jitter up to a 30-second ceiling, and aborts a request at 12 seconds. A queued enabled-reader operation keeps its transport slot until the actual work settles, including after timeout or background/resume; a paired batch also waits for both transports before returning a failure. Direct UI loads retain their recoverable timeout behavior. More than 200 pending distinct IDs collapse into one canonical loaded-range refresh. It pauses while the screen/tab is inactive and performs a canonical refresh when returning. It performs no idle timer polling after healthy work is complete. A continuously active queue can still perform roughly one batch per second; that is a request budget, not evidence that the backend sustains a particular concurrency.

The mention path previously fetched the viewer's seven-day mention ledger and then the associated messages whenever the conversation list changed. Enabled mode instead asks for one latest timestamp per loaded conversation, with the SQL aggregate avoiding the old API row cap. Ninety loaded conversations use two initial mention RPCs (50 and 40 IDs); a synthetic 151-row interest window uses four requests with at most two in flight. Repeated avatar/unread-only renders create no additional mention reads. New rows, changed message previews, foreground and reconnect trigger coalesced checks, and a final update arriving during a pending read is retained. Missing mention RPCs or a disabled capability retain the authorized legacy path; permission errors do not select that fallback.

The Market unread dot retains its existing 30-second visible refresh cadence, with no overlap and a fresh check on focus/online. It pauses hidden tabs and fences replacement sessions, including an A→B→A account round trip.

## Correctness and privacy protections

Every actual v2 page and ID lookup pins the initiating token and checks the current viewer/session before and after the request. Cursor identity includes context, order, folder, deleted/group policy and search/filter options. Native navigation cache retains the same owner/session namespace and initial prefetch deduplication. A replacement session for the same user invalidates the mounted inbox as well as its cache.

Range, continuation, direct-lookup and live-update results reconcile by request order. Local receipts and settings fence older reads. A canonical removal creates a conservative tombstone: an already-running authorized lookup cannot later restore that row or reopen its thread. A later request must reauthorize it. Appending a page stamps only IDs actually checked on that page, so it cannot suppress a newer update to an older loaded row. Foreground refresh reauthorizes loaded tails instead of treating every row missing from page one as deleted.

Native private group avatars fill after authorized text is ready. Their per-conversation request versions prevent a grant from another page, older refresh or former session from replacing a newer image. Avatar completion updates only images, preserving newer preview text and unread counts. Native sender prefixes survive a canonical refresh only when the retained or Realtime preview has the same authorized message text and exact microsecond timestamp; a different message clears the old prefix.

The global badge uses `get_inbox_unread_totals_v2`, which preserves the two legacy web unread branches. It intentionally does not substitute the native context badge semantics or a page sum. The native global unread store is unchanged.

Mention reads pin the initiating token and reject stale owner/session completion. SQL returns only viewer-owned mention ledger rows joined to messages still readable under existing RLS, with no new deletion predicate. Its strict timestamp cutoff is `greatest(requested_since, transaction_timestamp() - interval '7 days')`; callers cannot widen the reader into arbitrary history, and the response reports the effective cutoff. Existing opened-time stores keep their clocks. First-use amnesty persists one owner cutoff after a successful authorized snapshot and draft-store hydration, covering old mentions on pages loaded later while allowing new mentions to highlight the existing preview UI.

## Validation and release gates

Focused executable checks are in:

- `tests/inbox-window.test.cjs`: finite initial reads, full summaries, cursor/filter identity, retained-ID batching, canonical removal, receipts, final live bursts, background pause/backoff and private-avatar enrichment.
- `tests/native-inbox-pagination.test.cjs`: actual native screen handlers, complete archive access, server search, pagination/overlap, background pause, blur cancellation, sender prefixes, same-owner session replacement and timeout recovery.
- `tests/inbox-mentions.test.cjs`: bounded ID/concurrency reads, exact response validation, server-clock cutoff compatibility, missing-function fallback, session cancellation, retained final events, first-use amnesty and unchanged drafts.
- `supabase/tests/inbox-mentions-db.test.cjs`: seven SQL cases, also run on isolated PostgreSQL 17.11 in `pc_scale_mentions`, including both-table RLS equivalence, latest mention beyond 1,000 rows, strict cutoff/clamp, cardinality validation, ACLs and index definition.
- `tests/quality/navigation-cache.cjs`: existing legacy prefetch/session/cache behavior and deferred avatar regressions.
- `web/tests/messages-quality-regressions.cjs`: actual web chat component handlers, retained histories/drafts/receipts, paged scrolling/search/deep links, canonical update races, complete forwarding choices and full unread badges.
- The reader migration’s PostgreSQL fixtures independently compare search, Unicode, retained-ID authorization, unread semantics and cursor scope with their canonical SQL oracles.

These are deterministic local tests with synthetic records and transport. They do not measure database throughput, provider limits, network delay, device GPU frame time, hosted Realtime delivery, or production active-user capacity. Before activation, exercise the enabled capability in an authenticated QA environment with large inboxes; cover membership removal/blocking during a pending read, reconnect after missed changes, last-page ordering changes, archive/Unread/search counts, restored selected chats, forwarding and both private and public group avatars. Then canary the release while measuring page latency, ID-batch latency, rows/bytes returned, errors, requests per visible user-minute and cold/warm device rendering.

## Remaining capacity limits

The current loaded inbox history is retained to preserve scrolling and navigation. Native `FlatList` bounds rendered cells, but its loaded row array, navigation snapshots, per-row state and web DOM history can grow with the amount of history the person visits. Refresh work is bounded per request and proportional to the loaded range; it is not a constant-memory or constant-total-work guarantee for a person who loads an entire huge inbox.

The existing inbox Postgres Changes subscriptions remain in place. The new feed Broadcast protocol does not automatically migrate chat delivery, and the same project-wide Realtime authorization/fanout limits still require capacity validation. Mention input/output and concurrent reads are bounded; physical database work still depends on that viewer's mention volume within the seven-day window and the selected conversations. The legacy fallback retains its previous broad mention reads and navigation-prefetch timeout behavior. Read receipt, active message history, stories used for avatar rings, global native unread counts and media signing each have their own budgets. The separate Market/Jobs and business adapters preserve their context and acting-identity semantics, but their synthetic correctness suites do not establish hosted throughput. None of these remaining costs should be hidden by describing this change as a complete five-million-DAU proof.
