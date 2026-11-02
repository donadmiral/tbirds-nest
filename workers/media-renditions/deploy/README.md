# Full-profile worker deployment option

`cloud-run-job.example.yaml` describes an alternative Google Cloud Run Job for the existing 512 MiB input / 768 MiB output / 600-second media profile. The Vercel Sandbox path is provisioned and has passed the [full-size input acceptance](../../../docs/quality/media-sandbox-512-acceptance-20261102.json). This Cloud Run template remains a prepared configuration, not a provisioned service. No Google Cloud account, paid resource, schedule, IAM binding or credential transfer is created by this file or CI.

The image uses the existing Dockerfile. `node run-job.mjs` executes the same bounded, leased worker as the HTTP `/drain` route and exits after one claim. It opens no listening socket and requires no cron bearer secret. It still requires its own worker-scoped broker credential. Worker, gateway and environment credentials remain separate.

## Concrete allocation

| Setting | Prepared value | Reason |
| --- | --- | --- |
| Region | `us-central1` | Explicit region for the quoted list-price example; choose a permitted region near the database before deployment |
| CPU / memory | 2 vCPU / 4 GiB | Initial encoding allocation; throughput and worst-case HDR processing still need measurement |
| Ephemeral disk | 2 GiB at `/scratch` | Holds the 512 MiB source, bounded outputs and faststart remux peak independently of HTTP controller scratch allocation |
| Worker deadline | 720 seconds | Allows more processing time than the current Vercel Hobby request limit |
| Host task timeout | 780 seconds | Leaves time for the five-second failure settlement and local cleanup before the host deadline |
| Database lease | Existing 900 seconds | Remains the single publication and expiry fence |
| Tasks / parallelism | 1 / 1 per execution | Explicit initial bound; the existing database semaphore also limits simultaneous workers across hosts |
| Host retries | 0 | PostgreSQL owns the durable five-attempt retry budget and provider backoff |
| Secret | Pinned Secret Manager version | Worker-only scoped broker key; no service-role key is exported |

Cloud Run's disk feature is currently in preview. Its documented default regional allowance becomes 100 GiB on first use, with 10 GiB per instance by default; individual volumes can be 1–100 GiB. Actual regional quotas, account restrictions and product availability must be checked on the selected owned project. The configuration uses two GiB per instance, so a 100-GiB regional disk allowance would bound this configuration to 50 simultaneous instances before any lower CPU, memory, database or budget constraint. This is a quota calculation, not a measured throughput claim.

The job runner emits only state, asset count and output bytes. Transient or infrastructure failure returns a nonzero process exit status; an already persisted media dead letter remains a database operational condition. Cancellation reaches the same worker and settlement path. Cloud Run Jobs have no public incoming endpoint. An authorized scheduler invokes the jobs API using an IAM service identity; a recurring schedule is not included or enabled automatically.

## Price calculation checked 2026-11-02

Google's published on-demand Tier 1 example rates are $0.000018 per vCPU-second and $0.000002 per GiB-second for instance-based billing used by Cloud Run Jobs. The published ephemeral disk price is $0.000109589 per GiB-hour. Job executions have a one-minute minimum billing duration.

For the prepared 2-vCPU / 4-GiB / 2-GiB-disk allocation, **ten active minutes cost approximately $0.02644 per execution**, before network transfer, image storage, builds, scheduler charges, taxes or any credits:

```text
2 × 600 × $0.000018 + 4 × 600 × $0.000002
  + 2 × (600 / 3600) × $0.000109589 = $0.0264365
```

One thousand executions at that measured duration would cost approximately $26.44 in those three resources. This estimate assumes ten minutes of actual job lifetime, not ten minutes of uploaded video. Encoding complexity can change the runtime substantially. A one-minute minimum makes blind high-frequency polling wasteful: the same allocation costs approximately $0.002644 for a minimum-length invocation even when no media is claimed. Choose event-driven admission or an explicit bounded dispatch rate from observed backlog and an approved monthly operating budget.

The original Vercel HTTP worker used conservative application limits of 128 MiB input and 450 MiB scratch, within the Hobby 300-second request deadline. These settings are separate from the provisioned Sandbox worker, which runs outside the HTTP request and has measured 2-vCPU / 4-GB resources with roughly 64 GiB scratch. A range input relay alone would not remove CPU, deadline, output/remux or monthly-entitlement constraints. Incremental output would additionally need a different registered-manifest protocol to preserve the current immutable publication proof. The completed input-size acceptance does not establish five-million-DAU capacity.

## Deployment prerequisites

1. Select the user's billing-enabled Google Cloud project and confirm a monthly budget and regional quotas. No Google Cloud account or billing authority is established by the Vercel deployment.
2. Build the reviewed Dockerfile and replace the template image with an immutable digest in the owned Artifact Registry. Supply the actual project, region and least-privilege job service account.
3. Register a new worker-only broker key hash in the destination Supabase environment. Put its raw generated value only in the destination Secret Manager; grant that job identity access to that secret alone and pin the version in the template.
4. Install the reviewed media schema and broker, then run one synthetic owned fixture. Verify original bytes, registered upload metadata, atomic publication, cancellation, retry, cleanup and playback. Measure wall time, peak memory, scratch, network transfer and per-encode cost before increasing parallelism.
5. Choose and configure a bounded jobs-API dispatch mechanism with its own IAM identity. Retain the existing database semaphore and backoff as the cross-host limits. Scale only against the approved budget and measured database/media headroom.

## Primary documentation

- [Cloud Run pricing, including instance-based Jobs and ephemeral disk](https://cloud.google.com/run/pricing)
- [Cloud Run billing model](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Cloud Run ephemeral disk for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/ephemeral-disk)
- [Cloud Run job secret configuration](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Vercel runtime filesystem](https://vercel.com/docs/functions/runtimes)
