# Bounded book, shelf and inbox readers

This change adds versioned readers and integrates book, shelf and inbox paging into web and native clients. Existing complete APIs remain available. Installation leaves both capabilities disabled. A successful local test does not authorize activation or establish production capacity.

## Contracts

| Reader | Bound | Preserved behavior |
| --- | --- | --- |
| `get_memory_book_page_v2` | At most 40 pages; clients request 24 | Canonical book access on every request; exact initial count; selected cover even when outside the first page; creative documents, soundtrack and current media rights |
| `get_memory_books_page_v2` | At most 12 books | Default book first, then creation time and ID; exact per-book counts and selected covers; all authorized books remain reachable |
| `get_next_memory_book_v2` | One neighbor | Canonical visibility and ordering; native visitor option skips empty books |
| `get_inbox_page_v2` | At most 50 conversations; clients normally request 30 | Existing RLS, pinned/activity order, settings, request state, profile visibility and exact legacy unread branch sums |
| `get_inbox_unread_totals_v2` | Three scalar totals | Web context badges retain the existing full-inbox unread definition; page size never determines a badge |
| `get_context_inbox_page_v2` | At most 50 conversations; native Market and Jobs request 30 | Exact context-reader request, membership, unread, sender and listing/job subject semantics, with null activity last |
| `get_business_inbox_page_v2` | At most 50 conversations; native business inbox requests 30 | Canonical acting-business authorization, exact latest-message and unread rules, full Primary/Requests counts and null activity last |

Book continuations seek by `(sort_order, created_at, id)`, retaining timestamp precision. Shelf continuations seek by `(default rank, created_at, id)`. An owner-library revision rejects a continuation after a page, story projection, order or cover changes. Views do not invalidate a cursor. A library with no visible books returns a fixed empty response, without exposing its private revision.

The inbox seeks by pinned state, millisecond activity time and ID. This is a live order: a new message can move a conversation to the head. Clients must merge a fresh head and revalidate retained IDs, rather than treat a cursor as a long-lived database snapshot. The cursor binds the viewer and all selection/order options.

Inbox filters run on the server before the page limit. Native search preserves case-insensitive literal name matching without trimming; web search preserves trimmed title-and-username matching. Percent signs and underscores are literal characters. Native archived mode retains its established behavior of ignoring search, tab, community and request exclusions. An explicit ID window bypasses UI filters and folder selection while retaining authorization, context, group inclusion and deleted-row restrictions.

`summary.total` and `summary.archived_personal` describe the complete base scope, independent of search, tab and page size. Native context badges continue using their established `get_context_unread` definition. The separate web total exists because those legacy definitions differ.

The native Market and Jobs reader is a separate additive migration. Its original contract excludes all `is_request` rows, permits membership-only direct messages, includes deleted receiver messages in the unread count, and ignores personal inbox archive/delete settings. It preserves each of those rules, the sender prefix and the listing/job subject under the existing RLS policies. Its cursor uses full-precision activity time followed by ID, with null activity last. It shares the disabled inbox capability; when that capability is available but this newer RPC is absent, only an initial read may use the original context API.

The separate native acting-business reader retains `get_business_conversations` authorization through the current `is_business_member` helper, including inherited organization roles, delegated scopes, expiry and legacy membership. The initiating human session authenticates each call; the requested business is separately checked on every page. As before, the preview comes from the latest message, Requests means no message has been authored by the business, deleted receiver messages still count as unread, and personal archive/delete settings do not filter this inbox. The versioned reader retains that established definer projection. Unauthorized businesses return a fixed empty envelope with zero totals; a mid-read revocation clears retained client rows. The cursor binds the human viewer, business, tab and full-precision activity time. Normal pages include exact complete Primary/Requests counts, while ID revalidation returns only the selected scope.

## Client behavior

The shared reader checks response completeness, cursor progress, duplicate IDs, revision consistency and full-count agreement. Each request pins the initiating bearer when supported, binds the viewer, supports cancellation and checks the caller's current identity before publishing a result. A missing or explicitly disabled capability uses the original API. Permission, transport and data-consistency failures do not silently downgrade to another reader.

The initial book contains 24 pages and its complete cover metadata. One adjacent window can preload, with later windows requested near the reading boundary. Appending existing ordered page IDs preserves an in-progress page-turn animation. Reordering, removing or replacing IDs still cancels that animation. A boundary gesture waits for the next authorized window and cannot wrap or skip a page.

Films, export validation, the complete page grid, cover/settings editing and membership-sensitive add/reorder actions finish reading the book before using its complete contents. They do not truncate a movie or mistake the loaded prefix for the whole book. A failed continuation leaves the already loaded reader usable and offers retry. An account or route change retires the pending complete-book action.

The shelf starts with a small window. Opening the full collection continues through the remaining authorized books, preserving all search and visibility-filter results. A partial collection does not display a false "no matches" result. Owner restoration keeps the previously loaded window through a refresh; it reauthorizes that content and retains account/revision fencing. Native titles and open controls remain available while cover signing completes. Book pickers and callers that require a complete shelf use the complete-reader option.

Only appended media is hydrated on continuation. The combined book retains the earliest media capability expiry, including when a later chunk contains no private media. Existing source/rights checks and signed-media refresh rules remain in force.

The main inbox loads 30 conversations initially and uses server search/filtering for later results. Restoring a loaded range revalidates displaced rows by bounded IDs; deep links and forwarding destinations do not depend on membership in page one. Separate full summaries and unread totals retain complete badge and archive counts. Message invalidations batch authorized ID reads rather than downloading the complete inbox per message. Commit ordering and removal markers prevent a delayed older response from restoring a conversation after a newer access check removed it.

The native Market and Jobs lists also start with 30 rows and load further windows on scroll. A focus refresh revalidates the loaded range and any displaced IDs. Reads pin the account token, abort on blur/background, time out with retry feedback, and reject results after account or context changes. Retry repeats the failed operation; a failed full refresh cannot accidentally turn into a continuation. Subject images, names, previews, navigation arguments and the separate unread-store refresh remain intact.

The native acting-business list uses the same small initial window, bounded continuation, revalidation and cancellation rules. Tab counts remain complete even when the active tab is empty. Switching tabs retains each already loaded range, and chat navigation retains the business `actAsId`. Legacy fallback still supplies both complete tabs. Permission errors never switch to the legacy definer reader.

## Validation

The database compatibility fixture executes the existing legacy reader bodies as its oracle. It verifies ordered concatenation, later-page cover selection, current rights, account/session/business/erasure gates, deleted/moved stories, stale cursors, hidden shelves, profile RLS, exact unread branch overlap, full badges, Unicode search and retained-ID lookup.

```sh
node supabase/tests/paged-readers-db.test.cjs
node supabase/tests/context-inbox-db.test.cjs
node supabase/tests/business-inbox-db.test.cjs
node tests/paged-readers.test.cjs
node tests/inbox-window.test.cjs
node tests/native-inbox-pagination.test.cjs
node tests/context-inbox-pagination.test.cjs
node tests/business-inbox-pagination.test.cjs
node web/tests/messages-quality-regressions.cjs
node --test tests/quality/native-memory-album-loading.cjs tests/quality/memory-page-turn.cjs tests/quality/profile-shelf-lifecycle.cjs tests/quality/memory-media-regressions.cjs tests/quality/memory-stability-regressions.cjs tests/quality/memory-creative-plan.cjs tests/quality/memory-soundtrack-save.cjs tests/quality/native-memory-modal-lifecycle.cjs
```

The opt-in real PostgreSQL harness requires an isolated Unix-socket database named `pc_scale_paging`. It recreates only that database's synthetic schemas. The `PC_TEST_PSQL`, `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` variables must point to the isolated fixture, never a hosted database. It checks overlapping edits, rollback, real lock waits and account-erasure cascades.

```sh
node supabase/tests/paged-readers-concurrency.test.cjs
node supabase/tests/paged-readers-capacity.cjs
```

The capacity script uses synthetic pages, conversations and messages to compare actual plans and examined rows before and after the seek/unread indexes. It is a query-shape experiment, not a concurrent production load test.

The context database test also supports the real PostgreSQL variables above, with a separate required disposable database named `pc_scale_context`. The same tests run against the captured legacy function body, including receiver/deletion semantics, membership-only DMs, hidden profiles and subjects, microsecond ties, null tails, cursor binding and the unread index with large synthetic read/unread history. Without those variables, it uses the local PGlite fixture. Its native component fixture verifies complete multi-window access, disabled/missing-RPC fallback, subject and navigation preservation, retained-row reauthorization, retries, timeouts and account/context/background races.

The business database test uses the separate disposable `pc_scale_business` database with the same variables, or PGlite when they are absent. It runs the captured legacy business reader and canonical organization access helpers as its oracle. It checks both complete tabs, inherited/delegated/expired access, full counts, latest-message semantics, deleted-message unread behavior, null tails, cursor scope and revocation. The native component fixture verifies acting-business navigation, all pages, tab restoration, legacy fallback, retry/timeout and human-account/business/tab races.

```sh
node web/tests/browser/memory-paging.cjs
```

The browser fixture runs actual web components and the shared paging client against local synthetic transport. It verifies a 61-page book, a 31-book shelf, delayed continuation, full selection/search and account replacement. It blocks requests outside its local origin. The native full-screen fixture separately verifies complete film/settings/grid preparation, failed continuations, account replacement, and all existing authorization, timeout and reaction races.

## Activation and remaining capacity gates

1. Review the migration against the target schema and canonical reader bodies. Keep both capability settings false during installation and client rollout.
2. Review index-build time and lock impact. The core migration builds three indexes; the separate context inbox migration adds one unread index because its legacy count intentionally includes deleted messages. These builds are transactional with short lock/statement deadlines. A large production table needs a separately reviewed concurrent index preparation and a compatible installation migration; do not blindly run the transactional builds during peak traffic.
3. Validate web and native against the same QA backend, including a multi-window private book, nonowner custom access, account replacement, reordered/deleted memories, films, exports, pickers, shelf restoration and full inbox badges.
4. Validate representative inner plans, query counts and latency under mixed reader/writer load. Watch book revision contention for unusually active owners and inbox candidate/search work for users with very large memberships.
5. Enable only the validated capability through the service-only configuration RPC, using explicit Boolean values for both settings. Monitor errors, stale-cursor retries, request/response volume, read latency, media readiness and database saturation.

Exact first-page book/shelf counts and cover choice still examine a book's own contents. Inbox ordering/search and archive summaries still examine the current viewer's relevant memberships; full unread badges retain their existing canonical computation. The acting-business reader still checks latest-message and request status across that business's candidate conversations to retain exact order and tab counts; only final profile/message-text/unread hydration is page-bounded. These changes bound response size and avoid broad detail hydration, but they do not replace those remaining per-owner/per-viewer computations with maintained projections. Larger projection/counter changes require an explicit consistency contract and independent validation.

The web/native Studio inbox is a distinct, existing recent-work queue that merges direct messages, offers, applicants and reviews with fixed branch limits. This change does not reinterpret that queue as an acting-business chat archive or change its existing collection limits. The admin support inbox is separate again. Validate each actual route's workload rather than treating their names as interchangeable APIs.

Turning a capability off stops new v2 reads after the short capability cache expires. An already open paged reader can receive a readiness error and must refresh. Keep the original APIs deployed for compatibility and verify this fallback as part of rollout.
