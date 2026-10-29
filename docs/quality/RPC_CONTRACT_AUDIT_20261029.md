# RPC contracts, jobs and messaging audit — 29 October 2026

## Scope and release status

This audit compares the current native, web and admin source with metadata from the production Supabase project `prlkikhckbifseosbukl`. It also runs synthetic interaction tests and a local PGlite database built from the same 25 migration units used by the production and parity rollouts. It does not send messages, create real applications, change device approvals, create staff accounts or make payments.

The native changes are source changes awaiting the user's acceptance process. This pass does not create or submit an iPhone build and does not release anything to TestFlight.

Metadata presence, argument compatibility and permission grants are distinct from complete end-to-end verification. A function can exist and still reject a particular account or payload. Device navigation, authenticated role flows and provider operations require their own acceptance checks.

## Findings and fixes

| Area | Confirmed cause | Change | Verification |
| --- | --- | --- | --- |
| My job applications | Production did not contain `my_application_page`; the client already called it. | Deploy the existing applicant self-service migration, including the withdrawal contract and audit events. The primary agent applied it in this pass. | The test first reproduces the missing function on the exact production baseline, then confirms the migration compiles and the applicant page works with account isolation. Live metadata confirms the new signatures and authenticated access. |
| Sending a post | The picker read `community_members` directly, although the production deployment deliberately revoked client table access. A failure in one destination type could hide all usable conversations. | Both clients use `loadConversationTargets`. Communities come from the authorized `get_communities_page` API; direct and group destinations remain independent. Partial failures show a retry warning alongside usable destinations. | Live ACL inspection; local chain reproduces denied direct table reads and confirms the authorized directory API. Shared tests exercise partial failure, group classification, membership pagination and duplicate community chat removal. No new community table grants. |
| Group vs direct chat targets | A legacy group can retain `type = direct`, making that column unreliable for classification. | Filter with the canonical `is_group` flag. Exclude rejected and unaccepted incoming message requests. Avoid anonymous “Member” targets when profile lookup fails. | Synthetic legacy group and incoming-request fixtures execute the actual shared loader. |
| New message and cancel/next | The “find people” message route opened the network/profile journey; group creation used a delayed navigation callback. | Add a recipient search screen; route directly to Chat; synchronously clear the message composer stack before opening Chat. Back has a Messages fallback for a direct/deep-link entry. | Shared navigation and search cases, plus actual web Messages component tests. Root navigator registers the new screen and account/recipient-specific Chat identity. |
| Stalled loading | Recipient search and destination reads had no deadline. A network request that never settled could leave the loading UI indefinitely. | Add bounded reads with cancellation where the query builder supports it. Preserve partial destinations after one timed-out category. Bound the web share sheet's session reads. | Deterministic clock tests prove timeout, partial results, request abort and timer cleanup. Mutation timeouts are not treated as evidence of a failed send. |
| Web message transitions | Cancel, Escape, compact-pane Back and browser history could leave stale selections or overwrite a restored draft. | Close the appropriate editing/composer/conversation level, retain the unsent draft, and fence late responses. | 25 actual registered web messaging tests pass, including the new transition cases. |
| Studio device actions | Both clients sent `p_status` to a live function whose argument is `p_action`. The accepted values are `approve` and `remove`, not status labels. | Correct all four native/web call sites. | Fresh live `pg_get_functiondef` and argument metadata show `studio_set_device(p_device uuid, p_action text)`; the literal-call audit finds no remaining mismatch. No real device approval or deletion was performed. |
| Client diagnostics | Native, web and admin diagnostics targeted a missing `report_client_error` RPC. The old table permitted arbitrary anonymous/authenticated inserts through `cerr_insert_any`. | The primary agent deployed the verified existing redacted-diagnostics migration. It derives the reporter from auth, discards free-form messages/stacks and arbitrary fields, and imposes deduplication and a per-account budget. | Eleven local database check groups pass. An independent post-deployment metadata read confirms the RPC is present. Admin reads use the server service client, so revoking device table access does not remove those reads. |
| Story sticker contracts | The earlier source used missing `get_sticker_response_summary` and `send_sticker_notify` names. | The stories lane replaces the summary call with the actual `get_story_sticker_summary` contract and removes obsolete notification wiring. | The latest literal-call snapshot no longer contains either missing name. See the separate story audit for interaction tests and publish-linked Add Yours behavior. |

## Static RPC inventory

The TypeScript AST scan covers production `.ts`/`.tsx` under `src`, `web/app`, `web/components`, `web/lib`, `shared`, `admin-web/app` and `admin-web/lib`. It does not count test mocks or dependencies. The snapshot was taken during the quality pass; later additions in the Network lane may increase literal counts without changing the findings below.

| Source area | Literal RPC call sites | Distinct names within area |
| --- | ---: | ---: |
| Native `src` | 278 | 211 |
| Web | 211 | 174 |
| Shared | 20 | 19 |
| Admin | 15 | 14 |
| Combined, deduplicating names across areas | 524 | 278 |

At the initial snapshot, 16 distinct literal names were absent from production: the diagnostics function awaiting deployment, six deliberately disabled music/creator functions, and nine admin functions described below. The subsequent diagnostics deployment reduces this to 15. All matched native/web functions grant authenticated execution. All matched admin functions grant service-role execution. There were **zero incompatible named-argument sets among present functions with statically readable argument objects**. This includes optional argument defaults and the distinct installed overload signatures.

Six native/web call sites assemble their arguments through variables or spreads: marketplace order creation on both clients, web promotion creation, native Studio listing updates, and the two Studio draft-save paths. These were inspected at the argument builders: order identity includes `p_request_key`; the promotion adds its request key; listing patches use optional `p_status`; draft save supplies either `p_id` or the owner/request-key pair plus the shared draft fields. Their named keys match live metadata. The two admin provisioning spread calls target an absent function and remain unavailable.

Eight direct `.rpc` sites use a variable or conditional name. Their callers were traced rather than counted as literal calls:

| Forwarding location | Checked contracts |
| --- | --- |
| Native channel actions | `vote_channel_poll`, `react_channel_message` |
| Native Studio planner actions | `studio_cancel_post`, `studio_delete_post` |
| Web community action wrapper | Invite, join/leave, requests, role, member, announcement, pin and sub-community operations |
| Web search map | Nine verticals: people, posts, jobs, listings, media, articles, places, channels and communities |
| Web commerce conditional | `business_catalog`, `business_receipts` |
| Web home feed query wrapper | `get_feed`, `get_feed_visibility` |
| Web `useSocialPages` | Directory/member/community page APIs, including the ten pagination signatures explicitly checked in live metadata |
| Shared marketplace review wrapper | `seller_review_page`, `submit_seller_review`, `report_seller_review`, `report_market_listing` |

The inspected forwarding paths use the installed named arguments: 49 forwarded selections cover 47 names. A separate live query verifies the six search pagination names that do not occur in literal `.rpc` calls. The scan checks names and argument keys, not runtime value validity, every SQL authorization branch, or every direct table query. The Network lane separately found and fixed more direct community table access outside this RPC inventory.

## Remaining unavailable contracts

### User-facing provider features deliberately disabled

| Missing function | Existing gate / implication |
| --- | --- |
| `list_playable_sounds` | `MUSIC_CATALOG_ENABLED = false`; no licensed song catalogue is claimed to be available. |
| `get_playable_sound` | Same music gate; continuous memory soundtrack coordination does not provide licensed audio by itself. |
| `publish_story_sound` | Same music gate; the voiceover catalogue publishing path is disabled. |
| `creator_statement` | `FINANCE_OPERATIONS_ENABLED = false`; advanced creator statements remain unavailable. |
| `creator_commerce_snapshot` | `CREATOR_COMMERCE_ENABLED = false`; creator products/purchases remain unavailable. |
| `creator_save_product` | Same creator commerce gate; no unsupported purchase or payout behavior is enabled. |

These names should not be “fixed” by silently turning on unfinished services. Music rights/catalogue contracts and the supported finance provider workflow must be ready before enabling the associated features.

### Admin deployment gaps

| Missing contract | Current consequence |
| --- | --- |
| `admin_seller_review_reports` | The reports page explicitly displays that seller review reporting is unavailable. |
| `moderate_seller_review` | Review moderation decisions cannot be completed through the new workflow. Direct stale-form submissions now explicitly state that the capability is unavailable and no review was changed. |
| `triniti_platinum_admin_command` | Centralized admin mutations report that no change was made because the action is unavailable. |
| `triniti_admin_provision` | New staff/business provisioning cannot reserve or complete its protected workflow. An absent reservation endpoint now states that no account was created, instead of suggesting repeated retries. If the endpoint disappears after reservation, the error preserves the possibility of an existing reserved identity. |
| `triniti_admin_deletion_requests` | The queue now renders an explicit unavailable state, Back to users and Check availability again. It does not crash on a specifically absent function, imply the queue is empty or claim erasure occurred. This remains separate from the app's older account deletion behavior. |
| `admin_support_triage_read` | Support assignment metadata returns an unavailable capability; ordinary ticket reading is a separate path. |
| `admin_support_triage_update` | The new assignment/priority/escalation workflow is not deployed. A stale direct form now states unavailable/no assignment changed instead of suggesting a retry loop. |
| `creator_finance_admin_snapshot` | Intentionally hidden behind the disabled finance operations gate. |
| `creator_finance_review` | Same finance gate; creator approvals are not activated by this pass. |

The broad admin/provisioning migration had been rejected by automatic approval review earlier in the release. This audit does not retry or bypass that rejection. These are explicit remaining operations gaps, not a claim that the admin app is complete because its public login page responds.

Missing-capability classification remains narrow: only an explicit missing-function response naming the requested endpoint takes this branch. Network failures, permission errors and missing internal dependencies retain their error/uncertainty behavior. Staff authorization still runs before reads or actions. Existing account/report/ticket data remains readable where its separate read contract is present. The installed Next.js 16.2.12 error-handling guide was read before changing the expected-error rendering.

## Database verification

Run from the repository root:

```sh
node supabase/tests/rpc-authorization/test-app-quality-hiring-chain.mjs
```

The runner loads the live-schema fixture, checks SHA-256 hashes for the 18 production and seven parity migration units, and applies the narrow candidates to an isolated PGlite database. It creates only synthetic accounts and records in that local database.

| Candidate | Passing check groups |
| --- | ---: |
| Applicant self-service | 16 |
| Redacted diagnostics | 11 |
| Comment author highlights | 15 |
| Total | 42 |

Applicant checks cover the original missing function, anonymous/signed-out denial, another applicant's isolation, employer denial, concurrent-version conflict, withdrawal, idempotent retry, exactly one audit event and notification, denied direct deletion, closed-state protection and unchanged community ACLs.

Diagnostics checks cover schema compatibility, anonymous/signed-out denial, identity derived from auth, discarded raw message/stack/arbitrary payload fields, allowed fields, duplicate and oversized report rejection, denied direct table reads/writes, a ten-per-ten-minute server budget and independent account budgets. The candidate preserves existing diagnostic rows.

Comment-pin checks cover author permission, denied commenter/stranger writes, visible read policy, one pin per post, safe replacement/stale unpin, top-level eligibility, hidden/spam handling, denied direct table writes, author reaction reads, cascade cleanup and nullable historical attribution when the pinner account is deleted.

Live metadata inspection also confirms:

- `communities` and `community_members` client SELECT/INSERT/DELETE grants remain revoked.
- `clubs` and `club_members` retain authenticated table grants and RLS. Club membership insertion/deletion is self-only; `clubs` has no DELETE policy, despite its table grant. A direct club deletion is therefore not an available flow.
- `client_errors` had RLS enabled but the unrestricted `cerr_insert_any` policy and no diagnostic RPC before the narrow repair. After the repair, the diagnostic RPC exists and device table access is revoked while server service access remains.

## Interaction and environment verification

| Command / suite | Result |
| --- | --- |
| `node tests/quality/conversation-targets.cjs` | 9 registered tests pass, including deterministic navigation, escaped people search, partial failures and deadlines. |
| `node web/tests/messages-quality-regressions.cjs` | 25 registered tests pass against the actual web component handlers. |
| `node tests/quality/build-env-regressions.cjs` | 14 registered tests pass unchanged after allowing their synthetic subprocesses. |
| `node tests/quality/deployment-skip-regressions.cjs` | 15 registered tests pass unchanged after allowing temporary Git fixtures and subprocesses. |
| Native auth custom runner | 31 of 31 named regression checks pass. |
| Web Studio custom runner | 24 actual assertion calls execute and pass; this file uses a custom runner rather than `node:test`. |
| Admin payment reporting custom runner | 13 assertions pass; these are not 13 registered `node:test` cases. |

The first build-environment/deployment-skip attempt failed with `spawnSync ... EPERM` because of the execution sandbox, before exercising its target behavior. The same unmodified tests pass with the necessary subprocess access. No test assertions were removed or relaxed. Tests are invoked as `node file.cjs` so the registered cases actually execute in this runtime; an outer one-file completion is not counted as a full passing suite.

## Final database regression gate

The complete `supabase/tests/rpc-authorization/run-all.mjs` runner and every root `supabase/tests/*.test.*` file completed with exit code zero. Each root file ran directly with `--experimental-strip-types` and explicit `PGLITE_MODULE` / `TRINITI_PGLITE_MODULE` paths. These runs use isolated databases and synthetic identities; no production mutation or provider request is made. No fixture changes were needed.

| Gate | Registered cases | Passed | Failed | Conditional skips |
| --- | ---: | ---: | ---: | ---: |
| All 27 root database/payment test files | 278 | 275 | 0 | 3 |
| Complete RPC runner's registered suites | 96 | 95 | 0 | 1 |
| Updated admin command contracts | 13 | 13 | 0 | 0 |
| Updated admin unavailable-capability rendering/actions | 11 | 11 | 0 | 0 |

The three root-suite skips are visual-release-specific book signing, visual-only manifests and visual-only story publishing. All three execute and pass in the RPC runner's `PLATINUM_VISUAL_RELEASE=1` mode. Conversely, the RPC runner skips soundtrack publication in that mode, and the same case executes and passes in the root suite's default mode. These are complementary mode conditions, not uninvestigated missing coverage.

The RPC runner also passes **117 named custom checks/scenarios**, reported separately from registered `node:test` cases: push authorization 13, community/group authorization 19, combined atomicity 4, admin commands 22, verification integrity 8, parity chain 9, and the three narrow candidates' 42 groups. Additional successful structural gates apply 41 pending migrations locally, verify the 18 production and seven parity units, and run exact-definition/ACL postflight with six expected role denials. The held admin, music and finance migrations remain local fixtures; their test results do not mean those migrations were deployed.

Admin TypeScript checking passes after the capability UX changes. The machine-readable [RPC_DATABASE_GATE_20261029.json](RPC_DATABASE_GATE_20261029.json) records per-file results and SHA-256 test-source hashes. These counts describe executions in each runner; overlapping test suites are not counted as distinct device journeys.

## Acceptance still required

1. On the next permitted native review build, open the post send sheet with direct, group and community destinations; verify partial/offline/retry behavior and confirm recipient identity before sending.
2. Exercise new message, create group, Cancel, keyboard dismissal, Chat Back, a deep link into Chat and rapid recipient changes on a real iPhone.
3. Check My Applications with a real applicant account and existing records. A real withdrawal should only be performed when that user intends to withdraw; the isolated test already verifies the write semantics.
4. Verify Studio device management with a real authorized owner/admin session and an intentionally disposable device entry.
5. Complete the separately reviewed admin operations deployment before claiming those staff workflows are ready.
6. Keep music and finance provider gates explicit until their contracts, access and acceptance checks are complete.

No real user message, job withdrawal, device approval/removal, review moderation or provisioning action was used as a test in this audit.
