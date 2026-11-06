# Session-bound chat HLS

This lane serves ordinary conversation videos and new legacy limited-view grants. It does not add chat buckets to the generic content-ticket HLS gateway.

Clients call POST with their current Authorization header and `{action:"open",messageId,requestId}`. Limited-view clients must first open their existing original view grant and reuse its request ID. Opening HLS never consumes a view. A missing or unsupported rendition returns `ready:false` so the original viewer remains available.

Every playlist and segment requires the current JWT plus the exact message, request, immutable source version and output lease. Child URLs contain no JWT or signed Storage capability. Segments are bounded to 16 MiB, verified against their registered SHA256, and checked again after fetching. No authorization cache is used. Close creates a terminal HLS tombstone even if open has not completed. Closing HLS does not close the original limited-view grant.

Existing limited-view grants created before this migration have no new source binding and continue through original delivery. Future grants are pinned at the original counter transaction. If the separate private_media v2 system is installed later, limited-view HLS fails closed until its matching source/erasure adapter is installed.

## Ordered rollout

1. Apply `20261105155600_private_chat_adaptive_delivery.sql`. The new setting defaults disabled.
2. Deploy the encoder bundle containing chat job validation. Existing scoped source-transfer and registered-output contracts remain in force.
3. Deploy this Edge Function with handler authentication. Do not substitute service-role bearer authority for user authentication.
4. Deploy compatible clients. Verify ordinary and limited viewers, session expiration, close/open races and background behavior.
5. Enable `private_hls.settings.enabled` only after those components are ready. The existing rendition worker/admission/delivery budgets still apply.
6. Use service-only `backfill_chat_hls_v1` with its cursor, at most 50 objects per call. Record queued, ready, rejected and failed counts separately.

Source replacement, message deletion and owner deletion cancel encoder leases and deactivate publications. Existing rendition cleanup removes registered output assets and refuses completion while any prefix object remains. When the account_erasure system exists, its completion transition is additionally blocked until chat derivatives and pending leases are gone. Production did not have account_erasure or private_media at this inspection. This lane does not claim to install either original-erasure programme.

## Verification

`node --test tests/private-hls.test.cjs supabase/tests/private-hls-db.test.cjs`

The database suite runs on isolated PostgreSQL 17 in CI and PGlite locally, with the actual v1/v2/broker/backfill/readiness/published-clip migration chain. It does not replace source selection or queue functions. It loads captured production manifest/access/claim functions. Organization role/scopes are empty in this fixture, while business_members and conversation memberships are tested explicitly. A 20,000-message EXPLAIN check verifies use of the live-video locator index. This is not a full production capacity or end-device HLS certification.
