# Live interaction and capacity release, 6 November 2026

## Investor statement
Platinum Circles has implemented a staged operating standard for 1,000 simultaneous broadcasts, including one event with 100,000 viewers and an audience on every other stream. Its current production admission limit is 10. An isolated database test and connected small-group acceptance are separate from a full provider load test. The large audience target is not a certified production result.

## What changed
The production web and internal mobile application source is 6c5ca49f36aef0dfd9323251d320562e7dec9974. Live chat supports Heart, Applause and Fire, per-message reporting, pin and unpin, followers-only chat, and slow mode off/5/10/15/30 seconds. Follow and unfollow use an authenticated desired-state command tied to the actual room host. Tapping again or reconciling an ambiguous response cannot invert the confirmed state. Private accounts produce a pending request. Account switches, self and blocks are checked.

A host or producer accepting or declining a request creates an idempotent private activity event. It respects notification choices; an already-supported live-stream link opens the right room. No guest camera turns on through a notification. The host now binds a returning guest to their current provider connection, while verifying their stage role. Manual layouts are retained. Lost acknowledgments reuse the original request ID.

During a chat transport outage, clients spread fallback reads over different intervals and finish a read before scheduling another. Reconnecting or leaving invalidates the pending loop. That reduces coordinated spikes. It is not a measurement of production maximum throughput. Monetization was not included.

## Capacity and evidence
The promotion rules are installed in both hosted databases, with identical guard function fingerprints, no signed tier yet, and a configured limit of ten. Operator instructions, thresholds and rollback are in [the runbook](../../../supabase/ops/live-capacity-v2/README.md). Each tier requires contemporaneous host, event and other-room measurements. The final tier requires at least 24 hours. Tests reject missing playback metrics, separate audience peaks, duplicate room snapshots, a gap over 60 seconds, an incorrect release revision, missing quota documents, stale receipts and attempts to skip tiers.

The request for 720 Gbps was accepted into the AWS quota process. It is not proof of allocation. The requested value comes from 199,900 viewer-room attendances at 1.8 Mbps and double reserve. Daily concurrent live output and Supabase Realtime connection / delivery quotas for this scenario remain unconfirmed. No high-volume paid provider simulation was started. For orientation, the first one-hour tier models 25 creators and 4,900 viewers: about 3.97 TB of delivered media. At Daily's published $0.03 per encoded minute the encoder portion is $45. The final 24-hour tier at 1,000 creators alone models $43,200 in encoding and approximately 3.89 PB of video at the assumed bitrate, before applicable discounts, plans or other costs. These are estimates, not a quote or bill. See [Daily](https://www.daily.co/pricing/video-sdk/) and [AWS](https://aws.amazon.com/cloudfront/pricing/).

[Provider readiness](provider-readiness.json). Production capacity is only raised after provider quotas, user experience, a budgeted real workload and operator review pass.


## Provider evidence needed
- Daily: written confirmation for 1,000 simultaneous independent HLS outputs plus reserve, expected regional distribution, simultaneous room creation rate, burst handling and separate stage-participant allowance. Hosts/guests publish in the small private room; the audience does not join that room.
- Supabase Realtime: approved connection, join and delivery throughput for concentrated rooms, payload-size constraints and downgrade/recovery behavior. Measure room-level delivered events including reactions. The customer database did not expose applied provider quotas. Do not substitute socket subscriptions or connected accounts for measured playback.
- CloudFront: approval (not just request submission), regional egress and request capacity for the applicable pricing plan and distribution. Independently collect samples from at least two audience regions, including the intended African launch market.
- Dedicated test owner: a capped spending authorization with provider stop thresholds, isolation from production, credentials for synthetic viewers, alert recipients and cleanup. Do not disclose identifiers or grant test accounts production access.

## Deployment
The public Platinum Circles website was independently read back at canonical platinumcircles.app, production deployment dpl_9g2UHZXBeFpm1HQRoQzygGMCZr7v, READY at source 6c5ca49. QA live-control v15 and production v13 both matched all eight reviewed files from server revision a4ddec096a1fa18abc2aaa351f38bcc9417d3963. The existing authentication behavior remained in place. [Edge receipt](live-control.json).


The isolated [edge check](isolated-edge.json) executed the tracked authorization handler with a synthetic key store. Across 1,000 rooms and 199,900 logical viewer-room attendances it accepted 399,800 valid playlist/segment requests, reduced them to 2,000 shared origin paths, and refused all 2,000 expired or cross-room requests. It did not call AWS or stream video. A separate rolled-back QA check exercised the installed admission trigger: it rejected an unqualified 25-broadcast increase and a direct jump to 1,000, leaving the limit at ten.


## Connected rehearsal
In the first live test, the service correctly refused the old camera when Daily's presence API lagged behind the rejoining guest. The follow-up checks the exact approved identity and current camera connection, retries reads within a bounded deadline and never retries the provider's layout mutation. [The second connected test](https://github.com/donadmiral/tbirds-nest/actions/runs/42277296138/job/128096809795) passed with three isolated test actors, real QA Supabase/Daily/CDN and synthetic camera input. An off-room guest received one private activity decision, repeated Follow retained the intended state, and a returning guest's replacement camera was decoded by the host with advancing playback time and positive video dimensions. A separate authorized viewer decoded HLS and audio; removal denied fresh stage admission. No synthetic users or active rooms remained. The matched server was promoted to production. This does not establish physical-device push delivery or large-scale production playback. The full [application quality](https://github.com/donadmiral/tbirds-nest/actions/runs/42274895308) and [browser](https://github.com/donadmiral/tbirds-nest/actions/runs/42274895332) workflows passed on source 6c5ca49.


## Isolated database measurement
[The repeatable SQL benchmark](isolated-database.json) constructed 999 active rooms, then exercised the authenticated production admission function for starts 1,000 and 1,001 under the test cap. The 1,000th was accepted and the next refused. It installed the release's count and heartbeat SQL, seeded 199,900 synthetic viewers, duplicate and expired tabs and a host preview, and verified exactly 100,000 in the featured room plus 100 in each other room. This is cardinality and authorization testing on one local PostgreSQL engine, not 199,900 concurrent network clients. The cleanup candidate reclaimed 101,025 abandoned leases in 21 bounded batches rather than 102. All 99,900 live leases elsewhere were retained. Timing, engine, method and limitations are in the receipt.
