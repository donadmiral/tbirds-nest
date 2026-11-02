# Production capacity prerequisites

The production visual baseline and the QA baseline have different contracts. The QA capacity bundle must not be replayed against production as if the missing creative, music, account-erasure, and business-session packages were inert dependencies. Some of those older packages immediately replace existing APIs or storage policies. Production therefore uses the independently verified capacity branches below and explicit compatibility migrations for its reader and delivery contracts.

## Installed independent branches

The following groups were installed and read back on production on 2 November 2026. Their original source bodies come from commit `931e3f837228f6c2cd34f399adc3542cda260f90`; the installation receipts retain each source hash and the migration identity returned by Supabase.

| Group | Source migrations | Verified state |
| --- | --- | --- |
| Monitoring | `20261102090637` | Private tables and service-only capture/status functions installed; sampling disabled. |
| Admin reporting | `20261102062128`, `20261102090641` | Dashboard and analytics summaries return successfully; maintained projection disabled; canonical fallback retained. |
| Feed and counters | `20261102062139`, `20261102070343`, `20261102090625`, `20261102090626`, `20261102092828`, `20261102094217` | Required callbacks, exact feed fallback, canonical catalog visibility, service/member ACLs and private tables verified. No missing catalog rows or counter backlog. Broadcast, indexed ranking and distributed writes disabled. |
| Notifications | `20261102075040`, `20261102090627`, `20261102100704`, `20261102100740` | Service proof, durable fanout/dispatch, bounded worker authorization and indexed unread badge installed. Service ACLs and private tables verified; fanout, dispatch and worker gates disabled. |
| Media processing | `20261102071532`, `20261102090521`, `20261102100428`, `20261102101149` | Durable processing, rendition publication, scoped broker and dispatcher installed. All 31 public media RPCs are service-only; 14 private tables have RLS. All processing/delivery gates disabled; no keys or jobs created. |

The existing five media buckets retain their prior visibility. Only the newly created `derived-media` and `adaptive-media` buckets are private. The broad private-bucket activation script was not part of this installation.

## Compatibility requirements

The production-compatible reader package `20261102162736_production_compatible_paged_readers.sql` was installed after its 17 focused behavioral and operational-query checks passed. Its live postflight verified all public/private contracts and unchanged fingerprints for existing functions, policies, columns and buckets. It replaces the five canonical QA reader installation units on this production baseline; both reader readiness flags remain off. See [the reader operations guide](../../supabase/ops/production-compatible-readers-20261102/README.md) for the exact source substitutions, guards and later full-package reconciliation.

Production book readers currently omit soundtrack data. A compatibility reader must preserve that output until a real rights contract exists; it must not invent audio permissions. Existing book APIs, account deletion, global session hooks and upload policies must retain their definitions. New capability responses must refuse unsupported business sessions so clients keep their established reader path.

The additive ticket package `20261102163428_production_content_media_tickets.sql` supplies live-session-bound ticket issuance, private ticket storage and the service-only resolver needed by adaptive playback. Its ten isolated PostgreSQL 17 checks cover authority revocation, object replacement, expiry, claim restoration, provenance, bounded cleanup and preservation of existing behavior. Issuance defaults off. The package follows the compatible readers and preserves canonical content authorization, object identity/version/owner, expiry and live-session checks without privatizing original buckets or replacing legacy upload behavior. See [the ticket operations guide](../../supabase/ops/production-content-media-tickets-20261102/README.md) for preflight, postflight and activation prerequisites.

## Subsequent acceptance and activation

Schema installation, authenticated hosted acceptance, activation and frontend promotion are separate release states. Keep the initial gates off until the exact application paths pass. Media credential registration, scheduler configuration, a completed hosted encode/publication/playback journey and adequate worker resources are still required before adaptive delivery is enabled. Capacity measurement, provider reservations and an operating budget remain separate from these installation receipts.

Use forward migrations for later full creative/music/business-session adoption. Do not replay a historical package over an already installed compatibility contract, remove canonical guards, or treat a default-off installation as active capacity evidence.
