# Reviewed compatibility sources

These two small, private packages replace the remaining vulnerable dependency implementations while preserving the Expo 54 / React Navigation 6 consumer contracts. They are deliberately named as local adaptations, with their own prerelease versions. They are not upstream releases and are not published to npm.

| Local package | Upstream source | Change and actual consumer |
| --- | --- | --- |
| `@platinumcircles/decode-uri-component-cjs@0.5.1-pc.1` | `decode-uri-component@0.5.1`, commit `58ed85f5adc7cfaee5e49e4d52b067f172d0bcb6` | One ESM default-export declaration becomes a callable CommonJS export. The complete 0.5.1 algorithm is unchanged. `query-string@7.1.3`, consumed by Navigation 6, requires that callable interface. |
| `@platinumcircles/deepmerge-safe-cjs@4.3.1-pc.1` | `deepmerge@4.3.1`, commit `5b87756a5671635679001cbac72aa42f23472c81` | Both source and target loops discard `__proto__` before reading it; the three merge writes define own data properties so inherited setters cannot run. `@expo/config@12.0.14` keeps its current merge/array/plugin-option behavior. |

## Why these adaptations exist

The decoder's current [advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) requires **0.5.1**. The earlier 0.5.0 correction left a quadratic full-string replacement loop and is insufficient. Upstream 0.5.1 is ESM, while the existing query-string consumer calls the result of `require()` directly; a blind version override would break that interface on the app bundler. The one-line CJS adaptation keeps the maintained algorithm and its complete original test suite. The newer decoder preserves literal `+`; query-string already converts form-style `+` to spaces before calling it, and the real consumer regressions verify that distinction.

The deepmerge [advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) lists no patched release; npm latest and the inspected upstream main branch remain 4.3.1. The local patch addresses the reproduced returned-object prototype poisoning without upgrading Expo. It is a local security backport, **not an upstream-approved fixed version**. Ordinary `constructor` and `prototype` data fields retain the upstream semantics; `__proto__` is unconditionally discarded, and every destination write is an own data-property definition. The original upstream CJS bundle already includes `is-mergeable-object@1.1.0`; its exact source and original MIT declarations are retained too.

## Provenance and installation

Each directory retains the unmodified relevant upstream sources, original license, immutable repository commit, npm archive URL/integrity, archive SHA-256, per-file SHA-256, a minimal unified patch, and the exact runtime SHA-256 in `PROVENANCE.json`. Upstream `package.json` snapshots use the filename `package.metadata.json` so they remain evidence rather than additional installable manifests. Original source paths are recorded. The original deepmerge implementation is imported only by a negative-control regression that proves the advisory before checking the replacement; production consumers resolve `index.cjs`.

The root manifest declares local file dependencies under the names expected by the consumers. Scoped `$decode-uri-component` and `$deepmerge` overrides refer back to those root specifications. This form was tested with a clean `npm ci`; direct consumer-relative file overrides were rejected after they produced broken links. The lockfile uses repository-relative links and does not depend on a developer's absolute workspace path. There are no package lifecycle scripts or runtime network fetches.

## Verification and maintenance

Run `node tests/quality/native-vendor-compat.cjs`, `node tests/quality/native-dependency-compat.cjs`, and `node tests/quality/deep-link-security.cjs`. The new suite checks hashes and exact decoder export adaptation; replays the unmodified upstream 0.5.1 suite; exercises actual query-string form/Unicode/array/fragment behavior and both advisory-shaped inputs in bounded subprocesses; proves the old deepmerge poisoning and verifies null, primitive, null-prototype, own-key and target-only paths; checks normal merge controls; and runs Expo's real `modifyConfigAsync` with native/plugin configuration changes. Navigation's existing original-path validation remains in place.

The release also requires a clean lockfile install, `npm ls --all`, TypeScript, and an iOS JavaScript export. A simulator compile is a separate CI gate; real hardware and provider behavior remain acceptance work.

**npm advisory coverage does not analyze these private local adaptations.** A drop to zero registry findings is not evidence that a local fork has been independently audited. Preserve these two components in the manual-review inventory, retain the security regressions, and recheck upstream fixes and consumer compatibility when updating Expo or Navigation. Replace these adaptations with compatible maintained packages when that can be done without removing the regression guarantees.
