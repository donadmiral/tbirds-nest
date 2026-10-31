# Integrated local completion gates — 30 October 2026

For the current music infrastructure, interaction repairs, source identities and unresolved hosted/device gates, start with [MUSIC_ACCEPTANCE_CONTINUATION_20261030.md](MUSIC_ACCEPTANCE_CONTINUATION_20261030.md). This document retains the earlier integrated receipt and must not be used as the current branch's test count or release decision.

For the subsequent reference-driven web/admin/Studio implementation, whole-book movie export and business-session repair, start with [DESIGN_COMPLETION_20261030.md](DESIGN_COMPLETION_20261030.md). The checkpoint evidence below remains historical.

The integrated local checks pass for the working tree based on `efe9dc8a234dcffb58e15a93c739dce076e7e103`. This is a source-verification receipt, not a claim that every device, provider, hosted deployment, or end-to-end journey is complete. Hosted CI must still pass for the published integrated commit. The companion JSON retains the baseline, replacement results, exact skipped cases, source hashes, lockfile hashes, and audit output.

## Application regressions and TypeScript

| Area | Test files | Reported tests passed | Failed / skipped | Additional successful assertion suite |
| --- | ---: | ---: | --- | --- |
| Phone | 123 | 1,083 | 0 / 0 | Authentication: 31 named checks |
| Web | 51 | 556 | 0 / 0 | Studio: 24 assertions |
| Admin | 19 | 146 | 0 / 0 | Payment reporting: 13 assertions |
| Total | 193 | 1,785 | 0 / 0 | Three assertion suites also completed |

The original runner covered 188 files and reported 1,742 tests. Its two admin failures were both in `admin-web/tests/missing-capabilities.cjs`; after the corresponding admin changes, an independent rerun passed all 13 cases. The receipt replaces that earlier suite result and does not count the rerun twice.

Five newly registered test files add 43 passing cases: native memory-film lifecycle (8), web memory-film lifecycle (6), native link-preview publication (6), the staff invitation's read-only default (1), and business-application loading, identity changes, submission, provider callback and form behavior (22). The final 22-case business suite was independently rerun with exit code zero during this receipt append. The final file inventory matches the current phone, web, and admin CI globs. The three standalone assertion suites are reported separately because their output does not register those assertions as Node test cases.

Root, web, and admin TypeScript checks all completed with exit code zero. Those exits were observed by the parent integrated runner; this review independently inspected the retained empty error logs. The admin agent also reran its typecheck after the staff-invitation default change.

## Database and Edge-runtime gates

| Gate | Registered | Passed | Failed | Conditional skips |
| --- | ---: | ---: | ---: | ---: |
| RPC baseline plus focused staff-isolation suites | 414 | 413 | 0 | 1 |
| Supabase Node test glob | 278 | 275 | 0 | 3 |
| Actual Deno 2.1.4 HTTPS transport | 2 | 2 | 0 | 0 |

The RPC figure combines the retained full runner result (382 registered, 381 passed, one conditional skip) with two independently executed 16-case staff-isolation suites. Both new suites are registered in the runner; the expanded full runner has not been rerun locally. These gates overlap, so their counts are not added into a claimed unique total. The database tests use local PGlite fixtures; they do not establish live Supabase Auth or external-provider behavior.

The RPC skip is **“sound publication is owner-bound, attested and idempotent.”** Its runner selects `PLATINUM_VISUAL_RELEASE=1`, which intentionally excludes the separate-soundtrack fixture. The default Supabase Node gate executes and passes that case.

The default Node gate skips three cases that require the visual-only fixture migrations:

- “book signing uses the reader permission for explicit custom access and inactive accounts”
- “visual-only manifests do not bind or sign separate audio, and install no soundtrack authorization”
- “visual-only publisher works without audio infrastructure, rejects added sound, and preserves recorded video controls”

The RPC runner passes those same three cases with `PLATINUM_VISUAL_RELEASE=1`. These complementary fixture branches do not prove licensed-music availability.

### Correct runtime discovery

Running the previously configured Node glob exposed a real workflow failure: it selected the recovered `link-preview-deno.test.ts`, which imports Deno APIs and a TypeScript parameter property unsupported by Node's strip-only execution. That run reported 275 passes, one failure, and three conditional skips.

The unchanged two-case TLS suite is now `supabase/tests/link-preview.deno.ts` and has a dedicated `edge-tls` job in `typecheck.yml`. The setup action is pinned to `denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`; the runtime is pinned to Deno 2.1.4 to match the inspected Edge environment. The Node glob remains intact.

The new workflow step creates a temporary non-CA TLS certificate and grants only the required loopback/fixture network, file, and environment access. Its exact shell block was extracted from the parsed workflow and executed with a fresh fixture: both tests passed. They verify a pinned destination IP with the original Host/SNI, certificate-name rejection, untrusted-certificate rejection, and cancellation of an unfinished response. The permissions do not disable certificate verification. See `LINK_PREVIEW_SECURITY_20261030.md` for the transport design and manual reproduction command.

### Staff-isolation review appended before publication

The production-shaped and QA-shaped fixtures each pass all 16 cases against `20261030012831_staff_social_shells.sql`. They use the retained real Auth-created-profile trigger. The migration marks a fresh staff reservation before the separate Auth creation call, so even an unfinished or failed finish already has a hidden social profile and a durable write boundary. The metadata-validated finish grants the reviewed staff role without enabling social posting, following, presence writes, push-token writes, or owner-bound uploads.

Independent review verified that existing owners, completed legacy staff reservations, Auth records, sessions, Storage rows, and unrelated functions remain unchanged. Business identities retain their active delegated profile. Valid AAL1 and AAL2 staff sessions still perform protected support operations; expired and revoked sessions fail. Optional MFA policy is unchanged, and the existing erasure lock, identity check, and job fence remain effective.

Deployment requires **zero incomplete legacy staff reservations**, checked under the existing governance lock. This avoids silently accepting an older unfinished setup that lacks the new reservation marker. Completed legacy accounts are deliberately not converted.

A focused retention review found no production or operator path that prunes `admin_ops.provisions`; current mutations only insert reservations and mark completion. Its direct application/service table privileges remain revoked, and the retained account-erasure body does not delete that table. The existing marker foreign key can therefore retain `ON DELETE CASCADE` without a current reachable pruning path. **Any future receipt-retention or pruning job must preserve the staff marker while the associated Auth identity exists.** This restriction is recorded for future maintenance.

These 32 passing cases are a focused append to the earlier RPC baseline, not a new full-run result or proof of hosted Auth-provider behavior.

## Dependency audit evidence

| Lockfile | Critical | High | Moderate | Low | Info | Total registry findings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Root/native | 0 | 0 | 0 | 0 | 0 | 0 |
| Web | 0 | 0 | 0 | 0 | 0 | 0 |
| Admin | 0 | 0 | 0 | 0 | 0 | 0 |

These are fresh `npm audit` captures from 30 October, independently inspected against their retained JSON. All three vulnerability maps are empty. The companion receipt preserves the complete audit metadata and lockfile hashes.

**The audit service does not analyze the private local compatibility adaptations.** `@platinumcircles/decode-uri-component-cjs@0.5.1-pc.1` retains the upstream 0.5.1 decoder algorithm with a CommonJS export adaptation for its existing consumer. `@platinumcircles/deepmerge-safe-cjs@4.3.1-pc.1` is a local security backport with own-property writes and early `__proto__` rejection; it is not an upstream-approved fixed release. Zero registry findings are not an independent security audit of either local implementation. Their original licenses, immutable provenance, minimal patches, upstream controls, and actual-consumer regression tests remain part of the manual-review inventory in `vendor/README.md`.

## Browser and native boundaries

`CI_GATE_REPAIR_20261029.md` and its JSON contain the separate actual-video export evidence: five cases pass on the exact CI Chromium 153 and on Chromium 156, preserving the original duration, pixel, resolution, artwork, and sound assertions. The old exporter fails under the strengthened fixture. These are synthetic browser checks, not Safari or physical-iPhone acceptance.

The earlier hosted native job's `xcodebuild.log` records `BUILD SUCCEEDED`, but the full job failed after compilation and did not produce its receipt. The postflight `lipo` argument order is repaired, and its output is now retained. Required Swift object, executable, and architecture checks are preserved. The app's iOS minimum remains 15.1 after inspection showed that the Skia 16.0 warning concerns simulator binaries. A new hosted run must prove the complete native gate at the integrated commit.

No signed archive, TestFlight submission, production promotion, physical-device acceptance, real provider acceptance, or authenticated business-provisioning acceptance is represented by these local results.

## Reproduction

The companion JSON records the exact focused files and commands. The main CI commands remain:

```sh
node --test --test-concurrency=2 tests/*.cjs tests/quality/*.cjs
(cd web && node --test --test-concurrency=2 tests/*.cjs tests/quality/*.cjs)
(cd admin-web && node --test --test-concurrency=2 tests/*.cjs)
npm test --prefix supabase/tests/rpc-authorization
PGLITE_MODULE="$PWD/supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/index.cjs" \
TRINITI_PGLITE_MODULE="$PWD/supabase/tests/rpc-authorization/node_modules/@electric-sql/pglite/dist/index.js" \
node --experimental-strip-types --test --test-concurrency=2 supabase/tests/*.test.*
```

The separate Deno job is required in addition to these Node commands. Its tested fixture-generation and runtime command are in `.github/workflows/typecheck.yml`.
