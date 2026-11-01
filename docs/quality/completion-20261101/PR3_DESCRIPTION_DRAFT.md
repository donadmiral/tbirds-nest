## Why this change is needed

The existing app could lose in-progress input during lifecycle changes, treat an unconfirmed mutation as successful, and leave reader or settings recovery unclear. Several operations screens also lacked reliable counts, bounded pagination or clear failure handling. Native media support needed proof from the real encoders and installed application, while older test receipts covered different source revisions or stopped before reaching the affected controls.

This change repairs those paths across native, member web, operations and the backend, and retains source-bound evidence so a component test, synthetic device run, hosted QA request and signed release are not confused with one another.

## What changes

- Preserve support drafts, request identity and session recovery; fence settings reads and saves; require actual successful Save acknowledgment and saved-title readback.
- Restore appearance controls, offer Cancel and keyboard handling, retain offer drafts until a valid offer ID is returned, and provide reader timeout/Retry behavior. Correct the story and poll fixtures used by the audit.
- Repair the diagnosed member-web routes/forms and profile-cover reachability. Give operations screens exact counts, bounded queue pagination, validated endpoints and explicit mutation acknowledgments.
- Retain native theme/version/media readability fixes and the repaired Media3 export path. Native memory-movie capability remains disabled in production until the remaining installed iPhone gate and exact source-promotion check pass.
- Add forward-only backend repairs and exact deployment packages for private media, business authentication, support, owned-audio operations and notification delivery. Keep private ACL/RLS and genuine missing-Storage detection intact.
- Update the reachable modern glob/minimatch dependency paths without breaking legacy callable consumers. Preserve application bundle bytes and document the remaining moderate advisory findings.
- Repair iOS setup around a uniquely owned Simulator and bounded command output/cleanup. The original journey now has a separately reviewed, one-use first-launch adaptation that removes only a redundant whole-app reinstall after proven fresh creation and first installation. It retains keychain clearing, permissions and every original sign-in, content, reader and timing assertion. Failure sampling is confined to the two exact owned app/driver processes.

## Source and evidence identity

The product candidate is `ecf5e5a960106d7cb04c211ee99e9e89c09642cc`, tree `38a64a6d47eafe0f976708edcc338b34204811f4`, on `codex/completion-20261101`. Later consumer/evidence-only changes must retain their own commit identity when this description is published. This draft does not imply that PR #3's older head has already advanced to the completion branch.

Retained installed-app receipts below use the exact apps built from `f5be97445ef7223baeb60dd10e8cded05630b6c1`, tree `f54e192c3ef721d0207d840382f176185c8c4f5a`, in producer run `41259529351`. They are not relabeled as final-lock, promoted-capability or signed production builds.

| Evidence | Verified result |
| --- | --- |
| Current source and types | Run `41266020096`: 2,357 native, 700 member-web and 287 operations checks; 328/331 payment/database and 886/889 registered RPC cases; all three TypeScript checks and two actual Edge TLS cases. All six conditional cases pass in their applicable counterparts. |
| Current browser suite | Run `41266020250`: all 13 groups pass, including actual encoded media and strict frame-gap rejection. Artifact `13067217383` is downloaded and digest-verified. |
| Hosted QA member/operations | Exact-`ecf5e5a` previews are READY and authenticated read/reader/private-video checks pass. Earlier hosted acceptance includes 24 settled operations routes, 21 member read states, appearance restoration, and a valid temporary title saved, fully reloaded, restored and reloaded again. |
| Hosted browser exports | Two actual downloaded files fully decode: an 8.2049-second/246-frame photo cut and a 12.0148-second/360-frame synthetic video book. Historical transient frame-gap failures remain recorded; the later passes do not establish a fabricated cause or rendering fix. |
| Android installed audit | All 85 declared cases pass on the retained `f5be974` APK, with no missing/duplicate IDs. Three scoped populated-Messages observations are 122.353, 69.103 and 85.427 ms against the documented 1,000 ms target. |
| Android installed movie | Same-session cancel/cleanup/retry, 12 layer captures, actual export and full independent decode pass. Output: 11.7 seconds/351 frames; SHA-256 `69073a04abd6782a533a6ed0694572cb1c2b8a5dee05636c1450ff9101d75b84`. |
| Current standalone encoders | Exact-`ecf5e5a` Android instrumentation passes 40 cases; iOS passes 11 memory cases/7 movies and eight story cases/six movies. These receipts do not substitute for installed-app or physical-device acceptance. |
| QA private-media readiness | Supported migration `20261101021335` returned success. Postflight verifies 13 real Storage references, zero missing/unbound objects, five private buckets, ten restrictive policies and preserved owner/ACL. |
| Dependency compatibility | Five independent behavioral checks pass. All four normal production Metro bundle/map files are byte-identical across the lock changes. Residual audit counts are 24 native, 15 web and 15 operations moderate findings; zero high/critical. |

The declared native pack contains 59 entry checks and 26 selected control, error, signed-out and capture cases. It is not exhaustive coverage of every screen action or role.

## Current remaining gates

The original iPhone journey in run `41266020146` successfully installed the exact retained application, then failed at the original 600-second whole-Maestro watchdog during a Jobs accessibility read. Its inner install command timer was 107.445 seconds; the complete recorded install stage was 135.730 seconds, so no inclusive 120-second wall-time pass is claimed. Initialization plus the original first-launch/clear-state segment used 436.073 seconds. The pinned Maestro source confirms that iOS clearState performs a whole-app reinstall, which is the basis for the guarded first-launch correction. The separate Jobs main-thread delay has no proven product or host cause. No Messages visit or reader entry occurred in that failed run.

The next original journey must still prove both reader captions, the unchanged 15,000 ms reader-ready deadline and the 1,000 ms focused populated-Messages observation. The iPhone 85-case aggregate and installed same-session capture/export/decode remain pending. Current final-lock app producers are tracked separately; their eventual outputs need their own artifact hashes and runtime receipts. Production movie capability is still `0` on both platforms pending those gates and an explicit source comparison/promotion.

Hosted backend work must resolve the outstanding business stage-4, atomic-support and notification apply outcomes before any duplicate request. The current readbacks do not establish remote cancellation, rejection or installation. After confirmed business stages 4–8 and exact postflights, the ordered owned-audio contracts and dependent Edge bundles can be deployed and tested. Two prerequisite Edge functions match exactly; the other prepared packages are not yet accepted hosted deployments.

Actual second-account offers, business role/revocation, support mutations, owned-audio finalization/cleanup and disposable-account erasure require the intended live backend and controlled confirmed-email QA identities. Email confirmation is enabled and no alternative QA sign-in provider is available. Existing read-route, local database and synthetic service results do not satisfy those account journeys. External financial-provider and real notification/call delivery also need their configured service/account receipts; no real payment, payout or ordinary-user notification is claimed here.

Production integration, target-specific backend rollout, production site promotion and a signed final app remain separate release steps. Current EAS CLI access requires supported human device-login confirmation; the existing browser session and valid signing configuration do not create a CLI session. No final signed build, TestFlight delivery or physical installation has been completed. This is an authentication boundary, not the superseded instruction to stop for review.

Licensed catalogue commercial activation remains deferred by the user. Owned uploads and their cleanup/erasure remain in scope. No capacity certification or unsupported nested/animated/dual-camera export is added to this completion request.

## Review material

The current action/evidence matrix is `docs/quality/completion-20261101/WORKING_COMPLETION_LEDGER.md`. Exact source and artifact receipts, original failure records, hosted QA receipts, dependency analysis, independent reviews and ordered backend prerequisites are retained in that directory. No failing or unexecuted case is counted as a pass, and no release-complete claim is made while the gates above remain open.
