# Performance follow-up

Baseline: `0ed045c4f23cd928913b483cabff7dce4232bfca` (QA build 32).

## Changes

- Native startup shares concurrent initialization and retains established auth listeners. An App remount no longer replaces an already-ready navigator with the startup loader.
- Feed profiles start loading on press-in. The existing account-scoped request cache deduplicates navigation and aborts obsolete work. Post image prefetch uses the existing bounded public-image policy and honors data saver.
- Web interaction reconciliation groups simultaneous cards into at most 100 IDs per batch, with at most two batches active. Four simultaneous cards use one counter request and two membership requests instead of twelve database calls. Queued work is cancelled on account changes. Mutation confirmation remains authoritative.
- Web social page reads propagate cancellation to media hydration. Replaced or unmounted readers also abort obsolete media-renewal requests.
- Native group receipts derive the latest-message summary from the existing member watermark snapshot. This removes the duplicate five-second query. The remaining reader is bounded, single-flight and active only while the chat is focused and foregrounded.
- Native notification events coalesce through a bounded refresh queue. Entry reads remain immediate. Leaving the screen or backgrounding cancels obsolete work.
- Notification rows and derived thumbnails retain matching, unexpired delivery grants while replacements load. Missing, denied, changed and expired media clears, including expiry during a stalled request. No private-media disk caching was added.
- The iPhone feed test no longer centers an already-visible video underneath the sticky header. The retained failure geometry left only 47.2% of its post visible, below the production 55% autoplay threshold. All four real playback assertions retain their original 15-second limits.

## Requirement status

The existing route inventory covers 98 native registrations, 105 member web pages and 35 admin pages. This is source coverage, not a claim that every physical-device journey or frame has been measured.

| Requested mechanism | Verified source position | Remaining work |
| --- | --- | --- |
| Disk-first cold launch | Eligible public feed snapshots and a profile cache exist. Ready startup is preserved on remount. | Durable inbox, notification and story-tray snapshots are not implemented. Most navigation snapshots remain memory-only. |
| Complete precomputed feed | The feed RPC returns complete cards. Indexed ranking and exact-ID hydration exist. | The indexed frontier still ranks for the viewer during the request. It is not a precomputed per-user page. Production indexed ranking is off. |
| Refresh without flashing | The preceding release preserves loaded content across the audited routes. This change further reduces repeated initialization and obsolete requests. | Full cold reload is distinct from same-screen revalidation. Device/network timing is not universally measured. |
| Early prefetch | Native fetches with seven rows remaining, warms two videos, and now fetches profiles on press-in. Web has early intersection and intent prefetch. | Connection-aware tuning and representative device measurements remain necessary. |
| Stable media geometry | Uploaded dimensions and reserved media geometry already exist. | Older records can lack dimensions and use fallbacks. |
| Image pipeline | Stable display identities, bounded prefetch and eligible caching exist. | Private media remains nonpersistent. Cold access still needs valid authorization and bytes. |
| Adaptive video | Native has a three-player limit including two lookahead players. Adaptive delivery code exists. | Production adaptive admission, workers and delivery remain disabled. Universal HLS delivery is not claimed. |
| Optimistic actions | Existing like/bookmark and messaging paths update locally and reconcile with the server. | A generic offline queue for every write does not exist. Payments and deletion retain dedicated confirmation semantics. |
| Normalized cache | Web like/bookmark state is shared and bounded. Cross-card confirmation is now batched. | There is no universal native post/user entity store. |
| Bounded rendering | Native uses virtualized lists and bounded media ownership. | Some live web collections retain unbounded rows. Discover's grid is not universally virtualized. |
| Event-driven updates | Recipient-scoped notification delivery and message events exist. Notification refresh bursts are coalesced. | Live story presence still polls. Group membership is not published to Realtime. Some older subscriptions remain broad. |
| Network resilience | Existing deadlines, cancellation, backoff, request deduplication and a durable account-bound message outbox remain in use. | Offline replay is specialized rather than universal. |

## Hosted configuration readback

Read-only queries inspected production `prlkikhckbifseosbukl` and QA `uaulhuelcfkjwojtymmw` on 2026-11-05. They did not alter configuration or spending.

- Production enabled: notification worker and capacity monitoring.
- QA enabled: notification worker, notification dispatch and adaptive maintenance.
- Both disabled: indexed feed, distributed counters, feed broadcast, notification fanout, book/inbox paging, maintained reporting, adaptive admission/worker/delivery and media sandbox dispatch.
- `conversation_members` is absent from `supabase_realtime` in both projects. `messages`, `conversation_typing` and `notifications` are published. RLS is enabled on membership records.

Five million daily users remains a design goal. These source changes and small functional checks do not certify that capacity. Activation, representative authenticated load, connection/fanout tests, regional playback, soak and failure-recovery evidence remain required.

## Verification boundaries

The baseline release passed fresh connected Live acceptance, browser acceptance, all quality jobs and the complete Android UI journey. QA build 32 finished. Its iPhone journey failed at the visibility setup described above. A separate memory test remained on the system Open confirmation and did not exercise capture. Successful build and isolated regression tests do not replace full iPhone acceptance.

The follow-up is verified with executable regressions for initialization, prefetch, account fencing, batched reads, cancellation, receipt derivation, notification refresh and retained visibility geometry. Final test and release receipts must identify this follow-up's exact source. QA build 32 does not contain these later changes.
