# Offline originals and adaptive delivery continuation

This continuation adds original-resolution offline media to the existing public startup cache, carries authorized rendition readiness into first playback, and expands measured capacity testing. The preceding deployed release remains recorded in `../always-ready-20261105/release.md`.

## Acceptance evidence

The implementation and acceptance checks are in progress. Passing builds, browser tests, hosted rollout, device tests, and capacity measurements are recorded separately. No source-only change establishes physical-device acceptance or five-million-user capacity.

## Capacity boundary

The first published test change is `79cfa502d3e05e127970a48f9f390eab97d09dab`. It fixes a false-acceptance gap: a receipt must demonstrate the scenario's actual offered and completed load, not only carry a DAU label. The expanded isolated profile generates 250,000 ordinary posts, 128 actors, and 32 connections, with 100 reads/second steady traffic and a 120-second refresh soak. Its result is pending.

The current production configuration is not a five-million-DAU configuration. Fresh read-only measurements are in `../../../tools/performance/measurements/capacity-constraints-20261105.json`. The prepared-feed schedule admits one snapshot per ten seconds. Database connections, provider quotas, media throughput and a 24-hour mixed-load run remain explicit acceptance requirements.

## Physical-device boundary

No physical phone is confirmed connected to this session. A read-only cloud device inventory attempt timed out without returning a device or permission result. Native compilation, platform crypto tests and simulator tests must not be described as physical-phone verification.
