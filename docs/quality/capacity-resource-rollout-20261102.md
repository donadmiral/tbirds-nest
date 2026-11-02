# Capacity resource rollout — 2 November 2026

## Released result

The production media controller now supports the **512 MiB processing profile** using independently provisioned Vercel Sandbox resources. The former 128 MiB controller configuration is superseded. A real 511.53 MiB video passed encoding and publication, and the normal hosted dispatcher passed launch, derivative cleanup, automatic shutdown and database reservation release.

Production deployment **`dpl_Pahpf6YiZrCGpz6MieDCkcGkg4wz`**, built from **`a0da90cff3cbc9c92569dd7cadbd1750b4384116`**, is READY at [platinum-media-renditions.vercel.app](https://platinum-media-renditions.vercel.app). Its primary production alias is assigned. All eight production HTTP/authentication checks passed at **18:44:34 UTC**; the protected metrics response reports the actual 512 MiB worker limits. [Production checks](media-production-512-probe-20261102.json)

The profile is installed in **standby**. Production admission, encoding, maintenance, adaptive delivery, scheduler dispatch and Sandbox creation remain disabled, consistent with the controlled-rollout stage. The current client upload limits and original media-delivery behavior were not activated into a new profile. Web and admin remain on their previously verified production releases. This record does not claim five-million-DAU capacity.

## Provisioned worker resources

| Resource | Configuration / observation |
| --- | --- |
| Encoder VM | 2 vCPU, 4 GB configured memory, `pdx1` |
| Actual host resources | 4,492,595,200 visible RAM bytes; 68,652,367,872 scratch bytes |
| Per-job limits | 536,870,912 input bytes; 2,147,483,648 scratch-budget bytes; 720-second consumer deadline |
| Outer execution bounds | 735-second command timeout; 780-second provider hard timeout |
| Runtime | Node 24.22.1; FFmpeg/ffprobe 8.0.1-3ubuntu2; SDK 3.9.1 |
| Durable clean runtime | Nonexpiring snapshot `snap_7kjpOZrtq4dtSn2wnQiH1Wpy6At3`, 484,395,458 bytes |
| Isolation | Nonpersistent VM, zero exposed ports, outbound network restricted to the selected Supabase project |
| Credentials | Worker-scoped credential only inside the VM; dispatcher credential and request OIDC remain in the controller |
| Dispatch allowance | At most one simultaneous reservation, two runs/day and eight/month; each run reserves its full 780 wall-seconds and 1,560 CPU-seconds before provider creation |

The provider snapshot was created from the verified clean image without credentials or fixture media. Its lack of an expiration was confirmed through provider readback. The temporary runtime-pinning route and module have been removed from the released source. The independently scaled worker runs outside the controller's reported 512 MiB temporary filesystem.

The local dispatch allowance is an execution bound, not a provider fleet reservation or an approved dollar budget. Quota usage is shared with other account activity. The immutable snapshot also requires deliberate security maintenance; pinning it does not eliminate patching.

## Measured media acceptance

| Measurement | Result |
| --- | ---: |
| Real input | 536,375,042 bytes / 511.53 MiB |
| Content | 776 moving frames, 640 × 360 RGB, 25.866667 seconds; zero padding |
| Publication | READY; 18 immutable assets; 5,125,405 output bytes |
| Consumer wall time | 38.418 seconds |
| Consumer cgroup CPU time | 9.876 seconds |
| Peak sampled scratch growth | 541,913,088 bytes |
| Peak sampled host memory | 433,000,448 bytes |
| Node peak RSS | 118,890,496 bytes |
| Full provider VM lifetime / CPU | 145.570 seconds / 20.264 seconds, including preparation and probes |
| Final provider state | Stopped |

The measurement proves this input-size case at its stated duration and resolution. Sampling ran every 250 ms; the reported sampled peaks do not guarantee instantaneous maxima. It does not establish a worst-case deadline for every supported video, sustained jobs/second, geographic delivery throughput or an encoder fleet size. [Full-size acceptance receipt](media-sandbox-512-acceptance-20261102.json)

The ordinary hosted controller also encoded a 44,015-byte fixture into six assets in 10.461 seconds. Its first reaper check exposed a provider behavior: a detached command's ordinary GET could retain `exitCode: null` after the process had ended. A live `wait=true` read returned exit code zero immediately. The released controller therefore performs a **bounded 1.5-second live completion poll**. Poll timeout preserves the running VM and its reservation; confirmed completion stops the exact captured session before finishing the database reservation.

The corrected hosted deployment then launched a cleanup worker from the durable snapshot, removed all 24 derivatives from both fixtures, and automatically stopped/reconciled the session. The provider recorded a 30.015-second lifetime, 2.055 seconds active CPU and final state stopped. The controller returned `{state:"idle",stopped:1}` and both database runs finished with exit code zero. All seven task-created named VMs were confirmed stopped. [Lifecycle and cleanup receipt](media-resource-rollout-receipt-20261102.json)

## Backend and production verification

Four additional migrations were applied to QA and production: bounded Sandbox reservation/dispatch, inline feed visibility, deferred frontier scoring, and Sandbox budget observability. The scoped media broker was deployed as version 2 to both projects. The production worker, gateway and dispatcher have separate registered credential hashes and bounded request rates. The credentials expire on 31 January 2027 and must be rotated before expiry.

The production scheduler's origin and protected Vault credential are configured while dispatch remains disabled. The gateway origin is configured while delivery remains disabled. Final checks returned:

- HTTP 200 for production health and authenticated metrics, reporting `runtime: sandbox` and the 512 MiB profile.
- HTTP 401 for unauthenticated metrics and drain requests.
- HTTP 200 and idle/zero stopped workers for an authenticated drain with creation disabled.
- HTTP 403 when worker or gateway credentials requested dispatcher status; HTTP 200 for the dispatcher credential.

The first metrics probe found that the existing production worker/gateway credentials had not yet been registered in the database. Registering their existing hashes resolved that failure; the repeated full probe passed. No token or service credential appears in committed evidence.

Capacity monitoring remains enabled with 14-day retention and one sample/minute. At the final 18:45:40 readback, the latest scheduled sample was 18:45:00, no active alert remained, and production had zero active Sandbox reservations. The new monitoring distinguishes controller resources from encoder measurements and reports reservation-budget usage without inventing a provider reservation.

Verification included all six current worker test files, 23 focused dispatcher/HTTP cases with the installed SDK, and real PostgreSQL checks for Sandbox reservations, feed semantics and capacity monitoring. The regression explicitly covers a still-running command whose completion poll times out and a completed command whose ordinary GET remains stale.

## Database calibration

The bounded QA program recorded 1,065 timed API requests across diagnosis and calibration with zero errors. Its final mixed run completed **600 requests in 60.028 seconds**, approximately **9.995 requests/second**, with zero errors. Feed p95 was **373.54 ms** and p99 **495.98 ms**; other measured reader/counter endpoints had p95 values between 131.03 and 161.72 ms.

The actual feed query improved from 410.143 to 244.787 ms and frontier selection from 260.057 to 91.603 ms in the reviewed comparison. Canonical visibility and output-order checks passed. The separate small Realtime check received all ten expected messages without duplicates. Empty-recipient notification shard draining is not a high-fanout delivery benchmark.

These are small, defined QA measurements, not production-load measurements or a supported capacity ceiling. Larger confirmation tests remain separate. The generated database fixtures and temporary feature activation were cleaned up. [Database measurements and limits](capacity-database-measurements-20261102.md)

## Cleanup and release hold

Both new synthetic posts, both original objects and all 24 derivatives are gone. QA has zero pending/processing jobs, expired leases, cleanup backlog or active Sandbox reservations. The original shared story/account remains intact. The QA upload bucket is private and restored to its original 100 MiB limit; admission and worker creation are off, concurrency is restored to two, and the pre-existing maintenance setting remains on.

Authenticated clients are intentionally unable to directly delete private original objects. The two fixtures were removed through a reviewed temporary QA-only service helper with an expiring capability and two literal permitted paths. It was immediately replaced by a constant-410 handler with JWT verification enabled. The latest preview share link was revoked; the two older links were reported absent by the provider and fresh access attempts redirected to Vercel sign-in. Production deployment protection was not disabled.

**No new TestFlight build, upload or submission was started after the hold.** iOS 1.1.0 build 19 had uploaded earlier. Its exact App Store Connect build `60927284-426c-48f2-bce5-3edbe24285cf` was expired at **17:47:46 UTC**; internal and external states both read EXPIRED. All 14 earlier builds and group settings were preserved. [TestFlight hold receipt](ios19-testflight-hold-20261102.json)

## Unfinished account and capacity commitments

Actual account readback confirms **Vercel Intobank: Hobby** and **Supabase Pearl Group: Pro**. Production PostgreSQL allows 60 connections, including three superuser-reserved slots. Nano is owner-reported; the current connectors do not expose an authoritative purchased compute SKU or custom Auth/Realtime/pooler ceilings. [Account receipt](account-capacity-closure-20261102.json)

No production-scale reservation, exact monthly operating ceiling, enterprise quote or sustained fleet-throughput result exists. Billing/usage readback and provider capacity procurement are not available through the current authenticated connector surfaces; Billing UI requires ordinary account sign-in. No provider message or financial commitment was sent, and no reservation or budget was fabricated in the monitoring database.

The committed operating model and exact quota requisition are complete, but **unapproved and unpurchased**. Under the current private media gateway, the light five-million-DAU scenario models roughly **$1.85M–$4.14M per 30 days**, and the base scenario **$10.32M–$21.78M**, including a 20% allowance. These are public PAYGO sensitivity estimates, not a quote or expected bill for current traffic. Media bytes dominate, and the model accounts separately for origin, gateway and viewer transfer. It does not authorize expenditure or establish capacity.

The remaining concrete work is provider-confirmed quotas/reservations and a defined operating ceiling for a selected traffic profile, followed by sustained throughput confirmation. The 512 MiB resource and hosted lifecycle gap is closed; the five-million-DAU claim remains unsupported. [Full budget, assumptions, provider requisition and account gaps](capacity-infrastructure-budget-20261102.md)
