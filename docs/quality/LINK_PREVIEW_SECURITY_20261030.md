# Link preview security and compatibility completion

## Status and scope

The source candidate fixes the inspected redirect/DNS exposure and public cache-write contract, preserves installed-client post completion, and handles preview cancellation and stale composer results. All local gates below pass. An independent source reviewer reproduced three additional issues during development; all were fixed and the reviewer’s corrected reproductions passed.

The root release operator applied the candidate to QA and found a genuine provider-runtime failure: a known public PNG returned HTTP 502, while the unauthorized/private-origin checks passed. That failure was reproduced on the provider-compatible Deno 2.1.4 generation and repaired as described below. The root operator owns the final hosted deployment receipt; an authenticated preview/publication walkthrough remains separate acceptance work. No database or Edge deployment was made by this review lane. No iPhone archive, distribution build, or TestFlight submission was performed.

### Frozen deployment artifacts

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/20261030000331_link_preview_verified_cache.sql` | `999e44ee9602e15069443caed2590b5a3b2fb82c6044e8c2195abd2521c82daa` |
| `supabase/functions/link-preview/index.ts` | `bccd626c01ea2b0cd3aaff3433490336785668c2b5ad9e7761f9dd0e8f9c5c53` |
| `supabase/functions/link-preview/handler.ts` | `b0b4979cfbf2cfa414ace29bab9a084a5f08e29eaa60a2571522ba8e8e98f149` |
| `supabase/functions/link-preview/networkPolicy.ts` | `fa325525dbcab85eeacd5920d606ea313dbaecbd739620c302f8d0c7725c5f94` |
| `supabase/functions/link-preview/transport.ts` | `8ba42c01bdeb1c47626ff981992a57bff3a131a4730d9e9d7c017a1abbe1b82a` |
| `supabase/functions/link-preview/denoTransport.ts` | `b56554f8e32cf9e1de19ebf9bd732c4ec54fb76ca5777df4ee6d5d4d5d92b99a` |

The SQL is independently applicable to the currently deployed production baseline. It does not require deployment of the pending admin, private-media, erasure, or broader database-hardening candidates. Separate gates also exercise the full combined chain and the inspected, already upgraded QA catalog.

## Verified original findings

The original Edge function checked only several forms of the initial hostname and then used automatic redirect following. It did not validate each new destination or bind a connection to an inspected DNS answer. Its response-size limit was applied after `res.text()` had already consumed the response.

The actual `public.upsert_link_preview(text,text,text,text,text)` function had MD5 `686178f5e0db6e4bf417d153a2bc585f`, was a security definer, and was executable by PUBLIC, anon and authenticated roles. Its body could update or insert arbitrary global metadata without an identity or origin check. The local current-production fixture demonstrates an anonymous caller replacing an existing title, then rolls that demonstration back before applying the candidate. No hosted exploit attempt was made.

The native link-sheet service fetched external pages on the device and sent locally derived metadata to that shared RPC. Native and web post publishers also treated an RPC cache write as a required post-publication step. Revoking the old RPC outright would therefore have introduced an installed-client completion failure.

Read-only live preflights matched both projects. The inspected production cache contained six derived preview rows; QA contained zero. There were no individual column ACLs. Actual production `service_role` has BYPASSRLS, while app roles do not; the local direct-cache test models that real role instead of granting a convenient extra RLS policy.

## Network and response protections

The new transport accepts HTTP(S) on their standard ports, excludes embedded credentials and invalid/local hostnames, resolves the hostname once, and requires every returned address to pass a conservative public-address policy. IPv4 private, loopback, shared-address, link-local, documentation, benchmark and multicast/reserved ranges are excluded. IPv6 is limited to global unicast with special protocol, documentation and tunnel ranges excluded. The policy intentionally prefers a plain link over unusual address-space exceptions.

The socket connects to the validated literal address. HTTPS retains the original hostname for SNI and certificate identity checks, and the HTTP Host header remains the original authority. No caller Authorization, cookies, API key or other incoming headers are forwarded. Each redirect is resolved and checked again; loops, excess redirects and HTTPS downgrades fail closed. This avoids the check-then-re-resolve gap in an ordinary hostname-based fetch.

### Hosted-runtime failure and correction

The first implementation passed real HTTPS tests in local Deno 2.9.6. QA then ran `supabase-edge-runtime-1.77.9`, compatible with Deno 2.1.4, and returned HTTP 502 for the known public raster. Temporary QA-only diagnostics isolated the failure to TLS; they excluded error messages, URLs, tokens, credentials and request/response bodies.

The official Deno 2.1.4 `node:https` implementation delegates to a fetch client and does not honor the separately supplied TLS servername. A local reproduction with its CA explicitly trusted produced `NotValidForName` for the pinned loopback IP even though the requested TLS name matched the certificate. The server received zero HTTP requests. This was a runtime-compatibility defect, not a failed authorization check or an invalid PNG fixture.

The hosted entrypoint now injects `createDenoPinnedRequest`: native `Deno.connect` opens the validated literal IP, then `Deno.startTls` performs the TLS handshake using the original hostname and HTTP/1.1 ALPN. Normal CA and hostname verification remain enabled. The HTTP reader accepts bounded Content-Length, chunked, or connection-close bodies; it rejects ambiguous/duplicate framing, malformed/truncated chunks, unsupported encodings, malformed/oversized headers and critical fields in trailers. It sends no caller credentials. Every redirect still returns to the existing URL/DNS policy before another socket is opened. There is no insecure retry.

Two real HTTPS tests now run on Deno **2.1.4**. They verify successful pinned-IP/original-host delivery, wrong-hostname and untrusted-CA rejection before HTTP, and cancellation of an unfinished response. Additional reader cases cover partial reads/writes, IPv6 host representation, informational responses, all three body-framing forms, limits and late-connection cleanup. The fixture is entirely local; the documented domain names are used only for certificate permissions and TLS verification, and TCP connects only to loopback. The root operator then repeated the real QA checks against version 19: all six passed, including HTTP 200 with the expected 147,877-byte PNG and SHA-256 `8a15d59d2cd91deff61bdda862bd6982c7646d03797bc4a815f25e10244f0664`. The private-origin fixture still failed closed. Temporary diagnostics were removed from the final five-file bundle; its clean redeploy/readback and fixture cleanup are recorded by the root operator. This service-created fixture does not establish a logged-in preview or publication walkthrough.

Configured bounds:

| Resource | Bound |
| --- | --- |
| Request JSON | 8 KiB, with a two-second body-read deadline |
| URL input | 4,096 characters; standard HTTP(S) ports |
| DNS result set | At most 32 addresses, all acceptable |
| Redirects | Four followed redirects, five requests at most |
| Complete outbound operation | Eight-second deadline, including DNS and body reads |
| Response headers | 16 KiB shared across informational/final heads; at most 100 headers per head |
| HTML | At most 300,000 bytes, stopping the stream at the limit |
| Raster image | At most 2,000,000 bytes; excess bodies rejected |
| Content encoding | Identity only; compressed responses are refused |
| Chunked framing / trailers | At most 64 KiB framing and 16 KiB trailers |
| Concurrent work per handler | At most 12 pending page URLs / 12 active image requests |

HTML and raster paths have separate MIME allowlists. Raster output must also have a supported JPEG, PNG, GIF, WebP or AVIF signature. SVG/HTML is never served as a thumbnail. JSON responses are no-store and use generic errors. The handler handles browser CORS preflight explicitly.

Primary references: [Node HTTPS request options](https://nodejs.org/api/https.html), [Node TLS identity checks](https://nodejs.org/api/tls.html), [Deno TCP and TLS APIs](https://docs.deno.com/api/deno/network/), [Deno 2.1.4 HTTPS implementation](https://github.com/denoland/deno/blob/v2.1.4/ext/node/polyfills/https.ts), [Supabase hosted Deno 2.1 rollout](https://supabase.com/changelog/37941-all-regions-now-run-deno-2-1-compatible-release), [IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry/), and [IANA IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry/).

## Shared cache, thumbnails and installed clients

The legacy RPC retains its parameter names, defaults, void return and authenticated execution permission. Its implementation is now an invoker-mode no-op. An installed client can finish a real text post and its legacy preview acknowledgment, while its submitted title/image/domain cannot alter the global cache. Anonymous execution is removed.

`store_verified_link_preview` is the new service-only atomic writer. It derives verification time on the server, creates a thumbnail token only on first insertion, preserves that token on URL conflicts and returns the authoritative saved row. Independent Edge isolates therefore return the same persisted token even when they initially both read a miss. This uses PostgreSQL’s atomic conflict handling, rather than relying on an in-memory deduplication map. See [PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html).

Direct cache writes are revoked from app roles and from `service_role`; the latter writes through the explicit definer API. That also prevents an old in-flight Edge version from refilling unverified metadata after cutover. Authenticated clients and the Edge service retain SELECT. All new budget tables are private, RLS-enabled and inaccessible directly to app roles or the service role; the narrowly granted service functions own their changes.

The migration preserves every post and each cached URL key. It clears the old, unverified derived title/description/image/domain values. Those six observed production previews will regain metadata when the authenticated preview endpoint next fetches them. The post text and links remain available throughout. This is cache invalidation, not account or post deletion.

Thumbnail URLs refer to service-created database tokens. GET cannot supply an arbitrary origin. Origins are looked up in verified records and fetched through the same public-address, IP-pinned transport. Duplicate or unknown query parameters are rejected. Token case is normalized. These are public website-preview images; this cache and route are not a private/view-once app-media delivery mechanism.

Every actual thumbnail-origin fetch claims durable limits of **20 per token per minute and 120 globally per minute**. New isolates and additional tokens do not bypass those limits. Verified page misses separately allow **eight fetches per authenticated user per minute**. Repeated warm thumbnail reads reuse raster bytes for five minutes; the in-memory cache is bounded to 24 entries and 12 MB. Same-token requests share one fetch. Successful public thumbnails also receive browser/CDN cache headers. Cached reads do not consume an origin-fetch allowance.

The current native service sends only a URL to the authenticated Edge endpoint. The current native and web publishers no longer make preview-cache writes a required post step. URL changes, cancellation, closing or reopening the native sheet, component cleanup and owner changes fence late results. Both publishers check that the preview still matches the URL extracted from the text at publication time. The native feed composer preserves a deliberate dismissal across late same-URL refreshes and caption edits; a changed URL, emptied draft, or changed owner resets that choice. It also rechecks the current Auth owner before accepting an asynchronous result.

The continuation review reproduced two additional native composer failures against the recovered source: a pending same-URL refresh restored a dismissed preview, and publication could retain an old preview URL after the text changed. Both regressions failed before the narrow client patch and pass afterward. Six targeted cases execute the actual preview effect, dismiss control and publisher, covering dismissal, fresh drafts, owner changes, superseded requests, current-URL publication and cache-independent completion. These source-level cases do not replace the installed-device walkthrough.

Existing installed native binaries retain their old on-device implementation until rebuilt. The server compatibility no-op protects their post completion; it does not replace native code already installed on an iPhone.

## Verification

| Gate | Result |
| --- | --- |
| Node network/handler/native-preview behavior, including Deno wire reader | 21 passed |
| Native preview dismissal, ownership and publication integration | 6 passed |
| Real Deno 2.1.4 HTTPS certificate/pinning/cancellation | 2 passed, including wrong hostname and untrusted CA |
| Actual current-production database baseline | 12 passed |
| Full production admin/privacy/hardening chain | 12 passed |
| Exact QA catalog + forward adapters + hardening | 12 passed |
| Deno Edge and TLS-test type check | Passed |
| Native TypeScript | Passed |
| Web TypeScript | Passed |
| Independent corrected source review | Original findings cleared; native Deno reader independently reviewed by root with no concrete gap found |

The independent reviewer reproduced and then rechecked the cross-isolate token race, unlimited thumbnail-origin requests, duplicate query-key cache variation, and dismissed-link stale-preview sequence. Corrected reproductions returned one stable token to both first writers, reused bytes for 30 subsequent warm reads, rejected a cold-isolate fetch after budget exhaustion without contacting the origin, and rejected duplicate query parameters.

Database cases cover the original anonymous-write proof, cache invalidation and preservation, old-client completion, forbidden direct table writes including TRUNCATE, forged service claims, private budget access, atomic stable-token writes, per-user/per-token/global limits, unknown and banned users, unverified tokens, expiry reset and replay rejection. The QA chain additionally preserves all fixture account/session/profile/staff/Storage and bucket rows. The original provider-hook configuration remains excluded from fixtures and no provider notifications are triggered by the tests.

Evidence: `LINK_PREVIEW_PREFLIGHT_20261030.json`, `CURRENT_PRODUCTION_LINK_PREVIEW_DB_GATE_20261030.json`, `LINK_PREVIEW_DB_GATE_20261030.json`, `QA_LINK_PREVIEW_DB_GATE_20261030.json`, and `LINK_PREVIEW_GATE_20261030.json`. All Node/database cases are registered in the main RPC gate runner. Deno transport checks have the standalone command below.

## Rollout and provider acceptance

1. Deploy the five frozen Edge files as `link-preview` with `verify_jwt=false`. POST performs real Auth-user verification itself, rejects anonymous identities and only then considers the URL. GET serves only a service-created image token. This setting is recorded in `supabase/config.toml`.
2. Run `supabase/ops/check-link-preview-preflight.sql` immediately before applying the frozen migration. Every boolean must be true. The migration repeats exact checks transactionally. During the brief Edge-before-SQL interval, missing service contracts fail closed and preview availability falls back; publication remains independent.
3. Apply the migration, then run `supabase/ops/check-link-preview-postflight.sql`. Compare function hashes, ACLs, columns, policies and private budget structures to the matching gate. Unverified metadata count must be zero. Observational row counts can differ from the local synthetic fixtures.
4. Verify hosted OPTIONS, missing/invalid-auth POST, a legitimate authenticated preview, image retrieval, and publication from the web/current client. A temporary service-created QA preview for a known public raster can separately verify provider DNS/TLS/image delivery without pretending to test a logged-in user. Remove that temporary derived cache row afterward through the trusted operator.
5. Confirm the installed-client post acknowledgment still succeeds and the current client’s cancellation/dismissal sequences behave correctly. Real iPhone behavior requires the new installed build; TestFlight remains outside this work.

Some websites do not expose usable server-rendered metadata, block automated retrieval, use unsupported content/ports or exceed safe limits. Those cases retain a working plain URL/domain card. Provider authentication, outbound networking and device UI remain acceptance checks in their real environments; passing source and local gates does not establish those results.

## Reproduce

```sh
node tests/link-preview.test.cjs
node tests/quality/link-preview-publication.cjs
PLATINUM_CURRENT_PRODUCTION_LINK_PREVIEW=1 node supabase/tests/rpc-authorization/test-link-preview-chain.mjs
node supabase/tests/rpc-authorization/test-link-preview-chain.mjs
PLATINUM_QA_LINK_PREVIEW=1 node supabase/tests/rpc-authorization/test-link-preview-chain.mjs
deno check --node-modules-dir=none --no-lock supabase/functions/link-preview/index.ts supabase/tests/link-preview.deno.ts
```

Generate a temporary fixture with OpenSSL, using `CN=preview.example.com`, `subjectAltName=DNS:preview.example.com`, `basicConstraints=critical,CA:FALSE` and `extendedKeyUsage=serverAuth`. The explicit non-CA server certificate is required by the older runtime’s certificate checks. Set `PLATINUM_LINK_TLS_FIXTURE` to its directory containing `key.pem` and `cert.pem`, then run:

```sh
deno test --node-modules-dir=none --no-lock --allow-net=127.0.0.1,preview.example.com,wrong.example.com --allow-read="$PLATINUM_LINK_TLS_FIXTURE" --allow-env=PLATINUM_LINK_TLS_FIXTURE,NODE_DEBUG,NODE_EXTRA_CA_CERTS,NODE_TLS_REJECT_UNAUTHORIZED supabase/tests/link-preview.deno.ts
```

The final runtime was installed only in a temporary tool cache at version **2.1.4** from the official Deno GitHub release. The downloaded Linux ZIP matched the official SHA-256 `54a81939cccb2af114c4d0a68a554cf4a04b1f08728e70f663f83781de19d785`; no app dependency or native package was added. The initial 2.9.6-only check was insufficient to establish compatibility with Supabase’s older hosted runtime. The Edge Supabase client is pinned to 2.112.3. Deno’s warning about the separate app’s file-based npm overrides did not prevent the isolated Edge checks and does not change those native vendor sources.
