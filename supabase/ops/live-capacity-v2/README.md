# Platinum Live capacity standard
Status: operating standard installed; staged live qualification required. A target, local SQL fixture or unapproved service quota is not certified production throughput.

## Workload
1,000 separately broadcasting creators, one fixed event with 100,000 active viewers and 100 viewers on each of 999 other streams throughout the same window (199,900 concurrent viewer-room attendances). The 100-per-other-room assumption defines this benchmark rather than limiting a room. The initial limit is 10. The admission tiers are 25, 100, 250, 500 and 1,000. The historical 500-broadcast model was not a measured peak.

At a planned average of 1.8 Mbps the final tier is 359.82 Gbps before overhead. Two times reserve rounds to 720 Gbps. The model covers viewer authorization, heartbeats every 20 seconds, chat delivery to a concentrated audience, and publishing sessions. Reactions, control messages and join bursts also consume provider resources; measure those during the combined run.

    node tools/performance/live-standard.cjs 1000

## Qualified rollout
1. Confirm Daily concurrent live outputs, CDN transfer, and Realtime limits for the actual account. Collect approved quota records. A pending request or published default is not proof. Before generating traffic, set a test budget, alerts and stop criteria in a dedicated environment.
2. At each tier run actual ingest, chat and delivery together. Exercise host starts, joins to the featured room, reconnects, returning cameras, revocation, regional playback, worker failures and rollback. Require playback start p95 <=3.5s, chat p95 <=2s, rebuffer time and failed starts each <=1%. Lower tiers require an hour; the final tier requires 24 hours. Retain regional data, error rates and actual spend.
3. Export synchronized samples at least every minute from active publisher sessions and deduplicated active viewers per room. Each NDJSON row has ISO at, sourceCommit, a stable pseudonymous eventRoom, and activeRooms pairs [32-64 hex room pseudonym, audience]. Exclude ended/draft sessions, duplicate tabs, stale leases and fixture-only traffic. Do not infer active players from CDN request counts or include bearer URLs or personal identifiers.
4. Calculate the minima and hash of the same observation window. Retain actual provider, load, and user experience reports matching the fields specified in live-standard.cjs. Each needs an immutable HTTPS reference and SHA-256, including an operator review. The operator checks the linked bytes and verifies provider records. App clients cannot attest or change the admission limit.

    node tools/performance/live-audience-window.cjs audience.ndjson TIER SOURCE

5. Generate reviewable SQL locally (no network). This recomputes the audience window, verifies the source, timestamps, hash, experience thresholds and provider evidence fields, and refuses missing proof. An operator executes the reviewed transaction in the appropriate environment. The database enforces tier order, starting cap, one-time use and a recent attestation. Nothing automatically raises limits.

    node supabase/ops/live-capacity-v2/promote.cjs report.json SOURCE https://retained.example/report TIER audience.ndjson

6. To roll back, lower live_streams.settings.max_active_broadcasts under ordinary operator controls. This does not disconnect existing sessions. A subsequent promotion requires a new measurement and receipt.

The gifts setting, signed playback grants, membership rules and media access checks are independent of this standard.
