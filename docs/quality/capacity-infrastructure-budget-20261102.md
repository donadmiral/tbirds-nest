# Capacity resources, quotas and operating budget — 2 November 2026

## Decision record

The conservative execution policy is **no paid plan upgrade or resource reservation purchased**, with bounded use of existing subscriptions and allowances. The exact marginal bill and remaining shared quotas are unavailable. This is not a user-approved $0 operating budget or proof of zero charges. No vendor contact or financial commitment has been made by this record.

At **5 million DAU**, the repository's light/base workloads would cost approximately **$1.85M–$4.14M / $10.32M–$21.78M per 30 days**, respectively, under the current private media gateway and the public PAYGO prices below, including a 20% uncertainty allowance. These are sensitivity calculations, not an invoice, an approved budget, a provider quote or a supported-capacity claim. A production-scale monthly ceiling remains **unapproved/NULL**. Enterprise prices and architecture choices can change the result substantially.

The complete rates, units, assumptions, quantities and line items are in [provider-costs-20261102.json](../../tools/performance/provider-costs-20261102.json). Workloads are calculated directly with [capacity-model.cjs](../../tools/performance/capacity-model.cjs) and the unchanged [capacity-scenarios.json](../../tools/performance/capacity-scenarios.json). Historical idle polling is excluded; current reconnect/recovery traffic remains unmeasured.

## Workload and resource requisition

DAU is shared across web and native. The cost model additionally allows 25,000 admin requests/day; it does not count five million separate users on each client.

| Quantity | Light | Base |
| --- | ---: | ---: |
| Active minutes/person/day | 15 | 30 |
| Video minutes/person/day; bitrate | 5; 1 Mbps | 20; 1.5 Mbps |
| Application requests/30 days | 18 billion | 30 billion |
| Media HTTP requests/30 days | 15 billion | 30 billion |
| Viewer delivery/30 days | 5.805 PB | 34.110 PB |
| Peak application requests/second | 20,833 | 57,870 |
| Peak viewer delivery | 53.75 Gbps | 526.39 Gbps |
| Peak realtime connections | 125,000 | 442,709 |
| Retained source + derivative objects after 365 days | 912.5 TB | 3.65 PB |
| Video jobs/30 days, assumed video upload share | 1.875M; 25% | 7.5M; 50% |

The provider requisition must cover **at least 30% peak reserve**: 27,084/75,232 application requests/s, 69.875/684.306 Gbps viewer delivery and 162,500/575,521 realtime connections. These are requested planning quantities, not granted quotas. Auth/authorization, storage, media and realtime operations need separate ceilings; application RPS is not database connections or SQL QPS.

The 512 MiB processing class is **2 vCPU / 4 GB RAM per job**, with scratch and job timeout verified on the actual host. It is a maximum input class, not the assumed average upload: the existing scenarios use 5 MB/10 MB average uploads. Assuming 30–120 seconds/video for light and 60–240 seconds/video for base, the encoder needs **85–339 / 1,129–4,514 simultaneous jobs including reserve**. This assumption must be replaced with measured encoding time, peak RSS, scratch high-water mark and output size. One successfully provisioned Sandbox does not reserve that fleet.

## Delivery accounting: every viewer byte remains in the bill

The current [gateway](../../workers/media-renditions/gateway.mjs) streams storage bytes and sends `private, no-store` plus CDN `no-store`. Its [encrypted Runtime Cache](../../workers/media-renditions/cache.mjs) contains authorization and object metadata; it is not a media-byte cache.

Therefore the modeled full private path includes all three transfers:

1. **Supabase → gateway:** all bytes, with a low case of 95% Smart CDN hits at $0.03/GB and 5% misses at $0.09/GB; the high case has no cache hits. Cached and uncached traffic have separate charges. [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
2. **Vercel Function → edge:** all gateway response bytes at the `iad1` $0.06/GB Fast Origin Transfer reference. [Regional rates](https://vercel.com/docs/pricing/regional-pricing/iad1)
3. **Vercel edge → viewer:** all bytes at the published $0.15–$0.35/GB regional PAYGO range, plus request charges. [Regional range](https://vercel.com/docs/pricing/regional-pricing)

A 95% origin cache-hit assumption cannot reduce the total bill to 5% of delivered bytes. Even before CPU, Auth and storage, these three legs cost **$1.411M–$2.903M light / $8.289M–$17.055M base** per 30 days.

Flat Rate CDN is not a basis for a multi-petabyte fixed-price promise. The published tiers reach 150M requests and 50 TB/month; these workloads exceed both. Its service terms allow sustained over-capacity teams to move tiers or PAYGO. No account-specific Flat Rate tier or enterprise quote has been confirmed here. [Published tiers](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams) · [Conditions](https://vercel.com/legal/service-terms)

## Monthly operating estimate

All values are USD, rounded to dollars, for 30 days/720 hours. Gross usage is charged without subtracting shared free allowances or credits whose remaining balances are unknown. The low/high columns combine favorable/unfavorable assumptions; they are not statistical confidence intervals or guaranteed upper limits.

| Cost category | Light low | Light high | Base low | Base high |
| --- | ---: | ---: | ---: | ---: |
| Supabase media delivery | $191,565 | $522,450 | $1,125,630 | $3,069,900 |
| Vercel viewer delivery | $870,750 | $2,031,750 | $5,116,500 | $11,938,500 |
| Vercel gateway origin transfer | $348,300 | $348,300 | $2,046,600 | $2,046,600 |
| Media requests, function CPU/memory, cache, authorization | $62,811 | $277,799 | $125,622 | $555,598 |
| Auth | $16,250 | $65,000 | $16,250 | $65,000 |
| Realtime messages, connections and egress | $10,038 | $84,946 | $15,516 | $94,639 |
| Application API, web and admin | $8,382 | $58,038 | $12,581 | $88,705 |
| Object storage at one-year retention | $19,178 | $19,178 | $76,711 | $76,711 |
| Database compute/disk allowance | $4,307 | $14,781 | $5,499 | $21,932 |
| Encoding, source download, derivative upload, worker broker | $7,764 | $24,301 | $61,355 | $191,405 |
| Subscription price references | $45 | $45 | $45 | $45 |
| **Subtotal** | **$1,539,389** | **$3,446,589** | **$8,602,308** | **$18,149,034** |
| **With 20% uncertainty allowance** | **$1,847,267** | **$4,135,907** | **$10,322,769** | **$21,778,841** |

Significant assumptions:

- **Auth:** 5M–20M distinct MAU at $0.00325 each; 20M is the scenario's registered-account assumption, not measured MAU. Refreshes count toward unique monthly activity, not a fresh MAU each time. [Auth pricing](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users)
- **Realtime:** chat fanout of 2–6 billed events/message, likes/posts notifications, plus 20–200 other delivered events/DAU/day for typing, presence and recovery. This produces 3.453B–31.230B light / 4.356B–33.660B base billed events/month, priced at $2.50/M plus $10/1,000 peak connections. Payload allowance is 500–2,000 bytes/event. [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing) · [Fanout/egress accounting](https://supabase.com/kb/troubleshooting/realtime-egress-faq)
- **API/gateway:** 2–10% of app requests traverse Vercel functions; 5–25% invoke Supabase Edge. Every modeled media request traverses the private gateway. Authorization cold fraction is 5–100%, with two backend checks when cold. Gateway CPU is 1–10 ms/request; amortized memory is 0.05–0.5 GB-seconds/request. Cache budget is two read units and 0.1–2 write units/request. These are meter inputs to measure, not observed runtimes. [Fluid rates](https://vercel.com/docs/functions/usage-and-pricing) · [Vercel rates](https://vercel.com/pricing) · [Supabase Edge rates](https://supabase.com/docs/guides/platform/billing-on-supabase)
- **Storage/database:** object storage uses $0.00002919/GB-hour. Starting empty, month-one average storage would cost approximately $788/$3,153 instead of the steady-retention line. Database rows assume 2 KB/post, 1 KB/message, 2 KB/account, 2–4× index/bloat overhead and 30% free space. Raw views are not counted as unique rows. One to three 16XL-equivalent compute prices at $5.12/hour are only an allowance. The base primary disk estimate of 14.7–29.4 TB exceeds the documented 16XL recommended 10 TB; it requires retention/partition decisions or a custom quote. Buying a larger instance alone does not establish capacity. [Object storage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) · [Disk](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size) · [Compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute) · [Sizing](https://supabase.com/docs/guides/platform/compute-and-disk)
- **Encoding:** fully active 2-core jobs at $0.128/core-hour and 4 GB at $0.0212/GB-hour, using published `iad1` scale-price references. Sandbox output uses the published $0.15/GB default-region Enterprise rate; the actual validation host is `pdx1`, and no billed fleet has been ordered. Supabase source-download egress is also included. [Sandbox rates and network billing](https://vercel.com/docs/sandbox/pricing)

For procurement comparison only, eliminating the private Vercel media hop yields a modeled **$0.31M–$0.95M light / $1.58M–$4.33M base** envelope using direct Supabase delivery prices and retaining the other assumptions. That is not the current implementation: any change must preserve authorization/revocation behavior and obtain provider capacity confirmation. No delivery switch is authorized by this price comparison.

The estimate excludes taxes, enterprise minimum commitments, SMS/email, moderation, third-party services, staffing, PITR/backups, extra IOPS, log retention/drains and unmeasured retransmission/bot/reconnect traffic. The 20% allowance does not prove those fit.

## Owned-account facts and missing confirmations

| Resource | Confirmed | Still unknown |
| --- | --- | --- |
| Supabase | Pearl Group / Pro; production `prlkikhckbifseosbukl`, `us-west-2`, PG17.6; at 17:43:32 UTC, 60 maximum connections, 224 MiB shared buffers, 2184 KiB work memory, 81,202,323 database bytes | Compute SKU, pooler limits, configured Auth/Realtime ceilings, spend-cap state, reservations and approved budget |
| Vercel team | Intobank / `team_yu7fUehO2z7E6QHF6Nvxp3tC`; deployment access; rolling-release billing reports unsupported plan, consistent with Hobby | Definitive account plan field, remaining quotas, configured budget, actual cost totals and reserved throughput |
| New Sandbox | Provisioned 17:50:33 UTC: `sbx_OsKWVLn3THR3cLl5fE12kYlmGCYJ`, `pdx1`, 2 vCPU, 4,492,595,200 visible RAM bytes, 68,652,367,872 scratch bytes | Fleet reservation, sustained encoder throughput and account-wide remaining allowance |

The [Supabase baseline receipt](capacity-db-measurements-20261102/provider-baseline.json) separates owned-account responses from public defaults. The 60-connection observation does not identify a purchased SKU. The Sandbox uses immutable Node image SHA-256 `6927dfce823159a574dc3b87fa327cde48533c7498b92492c31179a5477c9fd6`.

**Concrete account gate:** Vercel's cost endpoint returns `404 costs_not_found`, including for a complete October window; its compact team connector omits plan/budget fields, no authenticated CLI context is available, and Billing UI stops at ordinary sign-in. The next provider action is authenticated Billing/Usage readback for this exact team, followed by an exact ceiling decision. Supabase's configured Auth/Realtime limits, pool settings and spend cap similarly need an owner settings readback before the requisition can be confirmed. No capacity is reserved for five million DAU. Published defaults must not populate account-confirmed reservation fields in `capacity_ops.provider_limits`.

Request written provider confirmation for the quantities above, region mix, private-object cache behavior, Auth bursts, realtime fanout, database IOPS/pooling/failover, encoder concurrency/scratch, support, gross cost ceiling, overage/pause policy and reservation expiry. The machine record contains the requisition; it is **prepared, not submitted**.

## Bounded measurement budget choices

| Stage | Purchase policy / proposal | Concrete scope | Status |
| --- | ---: | --- | --- |
| Existing subscriptions | **No plan upgrade or reservation** | Dispatcher: one VM, 2 vCPU/4 GB, 780 seconds/run, two runs/day, eight/month; full run charged to the local dispatch budget before creation | Local execution bound; exact marginal bill and shared remaining quotas unknown; bootstrap/tests bounded separately |
| Isolated paid measurement | **$50 maximum proposed** | If needed: one Pro member-month $20; 24h Supabase Large $3.64; 20 core-hours + 40 GB-hours encoder $3.41; API/transfer allowance $12; reserve $10.95 | **Not approved or purchased**; verify actual account subscription and incremental cost first |

Eight full dispatcher runs consume at most 3.467 active core-hours and 6.933 GB-hours at the configured size, before separately bounded bootstrap/tests. Published Hobby Sandbox includes 5 active CPU-hours, 420 GB-hours and 20 GB outbound/month. Hobby charges no extra Sandbox usage and pauses new creation when its quota is exhausted; unused quota is shared and not confirmed here. Current SDK 3+ documentation specifies 64 GB local NVMe; the table above records the actual host measurement. [Sandbox pricing and quotas](https://vercel.com/docs/sandbox/pricing)

The optional $50 stage is bounded to 100,000 app requests, 20,000 media requests, ten added MAU and 10 GB combined source/viewer payload. It is a diagnostic workload, not a 5M-DAU certification. Stop on latency/errors, resource exhaustion or the stage's metered allowance; do not escalate a failed stage. Confirm actual meters before and after. Supabase compute charges are not covered by its spend cap. [Compute billing](https://supabase.com/docs/guides/platform/manage-your-usage/compute)

Vercel's On-Demand Budget applies to metered team usage. Setting an amount alone does not stop it; enabling pause affects all production projects, including web/admin, and enforcement may lag by minutes. Retained storage can continue billing while paused. Inspect the existing budget before setting an exact approved amount; no pause policy was changed here. [Spend controls](https://vercel.com/docs/spend-management)

## Release hold

iOS 1.1.0 build 19 had already uploaded before the user's TestFlight hold. On 2 November at **17:47:46 UTC**, exact App Store Connect build `60927284-426c-48f2-bce5-3edbe24285cf` was expired. Readback showed `expired=true`, internal/external state `EXPIRED`; all 14 earlier build expiration states and all group settings were unchanged. No further iOS build, upload or submission was started.
