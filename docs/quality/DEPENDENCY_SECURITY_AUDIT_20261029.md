# Dependency security audit — 29 October 2026

## Status and release boundary

The current web, admin, and native/root lockfiles all report **zero known registry vulnerabilities in `npm audit`**. The native source now replaces the final vulnerable decoder and deepmerge implementations with two narrowly scoped, licensed local source adaptations. **Those two private components are outside npm advisory coverage and remain explicitly recorded for manual source review and maintenance.** Their actual consumer/security regressions, upstream source hashes, minimal patches, clean installs, and Hermes export are verified below. This finishes the inspected dependency replacements; it does not establish that every app feature is bug-free or that real-device acceptance is complete.

**The dependency-only web/admin repair is merged in [PR #4](https://github.com/donadmiral/tbirds-nest/pull/4), with all three GitHub quality jobs passing. The exact merged patch is now READY on both production domains; deployment receipts are recorded below.** The broader quality source remains in draft PR #3. No iPhone build was created and nothing was submitted to TestFlight; the unchanged installed iPhone retains its existing dependency bundle.

The machine-readable companion, `DEPENDENCY_SECURITY_AUDIT_20261029.json`, preserves the full before/after npm advisory records, exact package locations, direct dependency versions, lockfile changes, and post-update lock hashes. Counts below are npm's vulnerable **package entries**, including affected parents; they are not counts of independently exploitable flaws. A zero audit result is a registry snapshot, not a complete security assessment.

| Dependency tree | Before | After | Result |
| --- | --- | --- | --- |
| Web | 6: 1 critical, 5 high | 0 | All advisories reported for this lockfile cleared locally. |
| Admin web | 8: 1 critical, 7 high | 0 | All advisories reported for this lockfile cleared locally. |
| Native/root | 32: 1 critical, 12 high, 8 moderate, 11 low | **0 registry entries; 2 manual-review source adaptations** | The recorded sequence is 32 → 24 → 18 → 0. Compatible maintenance clears the earlier packages; the final source replacements address decoder/deepmerge and are documented separately from registry coverage. |

## Changes and compatibility

Only three direct dependencies changed in each Next application: `next`, `@next/env`, and `eslint-config-next`. They are now pinned together to **16.4.3**, from web 16.3.0 and admin 16.2.12. This stays on Next 16. The official [16.4.3 release](https://github.com/vercel/next.js/releases/tag/v16.4.3) and npm metadata were checked; its React peer range includes the apps' existing React 19 versions and its Node requirement is at least 20.9.0. Validation here used Node 24.22.1 and npm 11.9.0.

Web React/React DOM remain **19.2.8**; admin React/React DOM remain **19.2.4**. The first root repair removed unused direct Zod after an exact source import search found no consumers. The completion pass additionally aligns the CallKeep config plugin to **12.0.0**, the published Expo 54 peer line, and updates Daily React Native **0.84.1 → 0.86.0** so its declared peers accept the installed AsyncStorage **2.2.0**. Daily keeps WebRTC **124.0.6-daily.1**. Expo **54.0.37**, React Native **0.81.5**, React **19.1.0**, and React Navigation native **6.1.18** remain unchanged. No Expo SDK, navigation major, React, or native WebRTC engine upgrade was introduced.

| Patched family | Web | Admin | Purpose |
| --- | --- | --- | --- |
| Next, environment loader, lint config | 16.3.0 → 16.4.3 | 16.2.12 → 16.4.3 | Framework security patches and coordinated compiler/tooling versions. |
| Sharp | 0.35.3 → 0.35.5 | 0.34.5 → 0.35.5 | Patched image libraries; the updated Next dependency range selects this version. Native platform packages and libvips track the Sharp update. |
| Brace expansion | 1.1.18 → 1.1.21; 5.0.9 → 5.0.12 | 1.1.16 → 1.1.21; 5.0.8 → 5.0.12 | Build/lint pattern-expansion resource exhaustion. |
| JS-YAML | 4.3.1 → 4.3.2 | 4.3.0 → 4.3.2 | Tooling YAML parsing CPU-exhaustion fixes. |
| Source-map-js | 1.2.1 → 1.2.2 | 1.2.1 → 1.2.2 | Indexed source-map parser resource exhaustion. |
| Zod in lint tooling | 4.4.3 → 4.6.7 | 4.4.3 → 4.6.7 | Collection validation resource exhaustion. |
| Admin Next PostCSS / Nano ID | Already outside the reported vulnerable range | PostCSS 8.4.31 → 8.5.23; Nano ID 3.3.16 → 3.3.20 | Source-map file-read issue and zero-sized custom-generator loop. |

Next's SWC packages and helpers update with the framework. `fastq` also moves from 1.20.1 to 1.20.3 within its existing range. Admin's larger lockfile diff includes deduplication/relocation of optional Sharp and SWC packages and restored registry integrity metadata; it does not represent a broad change to unrelated direct dependencies.

The first root repair had **19 compatible transitive version changes**, plus the removal of unused Zod. The transitive changes span seven families: brace-expansion (1.1.21 / 2.1.7 / 5.0.12), compression (1.8.2), fast-uri (3.1.9), node-forge (1.4.2), shell-quote (1.12.0), source-map-js (1.2.2), and undici (6.29.1). All satisfy their existing parent dependency ranges. That first repair had no added root overrides. The separately validated completion-pass overrides are described below.

The critical root [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) affects shell quoting of specially formed tokens; the installed chain is **React Native → react-devtools-core → shell-quote**. This is developer tooling, rather than code demonstrating remote command execution in the iPhone app. Its existing 1.x range permits the patched version. The audit also clears the reported Undici TLS-validation/DoS, node-forge signature-verification, compression response-close leak, and URI/source-map/pattern parser advisories; complete source URLs are retained in the JSON evidence.

Updates used explicit package versions and targeted `npm update` with lifecycle scripts disabled. No `npm audit fix --force` was used. The completion pass uses explicit, scoped overrides after checking real consumer APIs. Its final two replacements preserve the existing CommonJS interfaces through locally reviewed source adaptations; no major framework upgrade or audit suppression is used.

## What the framework advisories mean for this app

The framework findings are real release work even though each exploit has prerequisites. The admin uses App Router Server Actions in its security, support, review moderation, recovery, and other action modules. That is a concrete match to the attack surface described by the [Server Actions CPU-denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r). The local version is now beyond its patched 16.4.1 baseline; the dependency-only production rollout is confirmed below.

The critical [SVG image optimizer advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and [typed-array cache advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr) also specify 16.4.1 fixes. The checked source has no `next/image` imports, `dangerouslyAllowSVG`, `remotePatterns`, enabled Cache Components, or `use cache` functions. The web `next/og` endpoint renders fixed branding and does not accept a user-controlled image or payload. Those observations reduce matches to particular exploit prerequisites; they do not justify keeping a vulnerable framework. The bundled framework APIs, future changes, and deployment settings still need the patch. No exploit was attempted against a deployed site.

Sharp is installed in the server image-processing dependency tree. Its [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) and [librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) are addressed by 0.35.5. Most remaining web/admin entries came through lint, CSS compilation, or source-map tooling; a vulnerable package marked as a production dependency is not automatically an app endpoint accepting arbitrary user data. The exact package-chain and source findings are the basis of these classifications.

## Completion-pass native maintenance

| Change | Why it is compatible and what was tested |
| --- | --- |
| Metro family **0.83.3 / 0.83.6 → 0.83.8** | Stays within the Expo 54 / React Native 0.81 Metro maintenance family. All 14 Metro packages are aligned. This maintained release replaces `image-size` with its own bounded image reader; the vulnerable package is absent from the lockfile. Both actual Expo and React Native CLI asset pipelines were tested for PNG/SVG dimensions, scale variants, audio metadata, and bounded rejection of malformed ICNS/HEIF/JXL inputs. A direct image-size 2 override was rejected because the older consumer used an incompatible API. |
| Expo Metro PostCSS **8.4.49 → 8.5.23** | Scoped to `@expo/metro-config@54.0.17`. The actual Expo loader still runs plugins, nested CSS, and generated source maps; absolute and parent-relative untrusted source-map references no longer read a private fixture. |
| Xcode/ngrok UUID **7.0.3 / 3.4.0 → 11.1.1** | Scoped to the two reviewed parents. Their real v4 consumers still produce valid unique identifiers. Actual Xcode generator preserves its 24-character uppercase IDs; ngrok generates a tunnel name without starting a tunnel. The patched v5 implementation rejects an undersized output buffer. |
| CallKeep plugin **14.0.1 → 12.0.0** | The prior 14.x package declares Expo 56; 12.0.0 is the installed SDK's compatible line. Expo's actual modifier preview preserves the app's explicit audio/VoIP background modes, Android calling/microphone permissions, and connection service. |
| Daily React Native **0.84.1 → 0.86.0** | Resolves the pre-existing AsyncStorage 1.x-only peer mismatch while retaining the installed WebRTC peer. Its real iOS bundle-cache module was tested for first fetch, persistent storage, cache expiry/ETag revalidation, and corrupt-cache recovery. The associated Daily JS range moves 0.89.1 → 0.91.0. Native calls and iOS provider behavior still need device acceptance. |

The final `npm ls --all --json` exits 0 with no dependency errors. A separate full clean `npm ci --ignore-scripts` installs **1,063 packages**, and its real consumers resolve the same reviewed files and runtime hashes. The local-reference layout also passes a clean **npm 10.9.4** fixture install, covering the Node 22 CI toolchain family as well as this workspace's npm 11.9.0. The manifest, lockfile, and installed versions agree. Tests exercise the actual consumers: **10** earlier compatibility/security cases, **7** new source-port cases, and **8** actual Navigation link cases pass. Native TypeScript passes. The final local iOS export successfully bundles **2,856 modules and 45 assets** into `index-acfdbb9b7c4505576f1de4efa024c12d.hbc` (12.4 MB). It is a Hermes JavaScript artifact, not an IPA, EAS build, or TestFlight submission. The separate unsigned iOS Simulator CI gate compiles real native sources with Xcode; device/provider behavior remains distinct acceptance work.

## Resolved final native causes and manual-review inventory

| Previous implementation | Current resolved source | Review, compatibility, and remaining responsibility |
| --- | --- | --- |
| **decode-uri-component 0.2.2 — high** through Navigation core → query-string 7.1.3 | **`@platinumcircles/decode-uri-component-cjs@0.5.1-pc.1`** | Exact upstream **0.5.1** algorithm, with one ESM default-export declaration adapted to callable CommonJS. The latest [advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) requires 0.5.1 because 0.5.0 left a second quadratic loop. The existing consumer calls `require()` directly, so the export adaptation preserves its interface. The 0.2.2 implementation is absent from the resolved/installed dependency graph. |
| **deepmerge 4.3.1 — low** through Expo config 12.0.14 | **`@platinumcircles/deepmerge-safe-cjs@4.3.1-pc.1`** | The [advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) still lists no upstream patched release. A local patch rejects `__proto__` before reading either input loop and defines own data properties for all destination writes. This is a reviewed local backport, not an upstream-approved fixed version. Its maintenance remains in the source-review inventory. |

Each adaptation retains the original license, immutable upstream commit, public npm tarball URL and verified SHA-512 integrity, archive/file SHA-256 values, original source, and minimal unified patch. `vendor/README.md` explains the installation, exact changes, tests, and retirement plan; each component's `PROVENANCE.json` records its full evidence. Original package manifests are retained as `package.metadata.json`, avoiding accidental additional installable packages. Deepmerge's already-bundled helper source and original MIT declarations are retained too. The original vulnerable deepmerge code is used only as a test negative control; normal consumers resolve the patched `index.cjs`.

The decoder port replays **all 139 unchanged upstream test cases and 164 assertions**, covering valid/malformed UTF-8, one-pass decoding, type errors, BOMs, and the newer performance regression. Real query-string regressions preserve form `+` handling, literal encoded plus signs, Unicode, repeated/array values, fragments, and tolerant malformed input. Both advisory-shaped denial-of-service payloads finish in bounded subprocesses through that actual consumer. Navigation's existing eight cases additionally verify the app's configured routes, authentication callbacks, and original-path guard.

The deepmerge regressions first reproduce the reported inherited-flag defect on the retained upstream source, then verify its absence for null, undefined, primitive, null-prototype, own-`__proto__`, and target-only inputs. Forbidden-key getters are never read. Ordinary data, dates, regular expressions, symbols, arrays, custom merge behavior, cloning controls, and inherited-setter handling are checked. Expo's real `modifyConfigAsync` then merges native background modes, Android permissions, and plugin options while rejecting the poisoned nested configuration, with no fixture file write.

The root manifest explicitly declares the local dependencies, and scoped `$` overrides direct only the reviewed query-string/Expo-config consumers to those sources. This avoids npm's consumer-relative local-path trap and keeps the lockfile portable. Both the source ports and the complete native install are verified without lifecycle scripts. No advisory was allowlisted or hidden; the report preserves the **18-entry** pre-port audit and the final **zero-entry** registry snapshot separately.

**Private local packages are not independently assessed by npm's advisory service.** Zero registry entries do not certify these adaptations or the whole app. Continue their manual maintenance and security regressions, review compatible upstream fixes, and remove the local adaptations when the consumers can use maintained versions without losing their verified behavior. No conclusion of complete app security or device readiness follows from the audit count.

### Native link mitigation and unused dependency removal

`src/navigation/linking.ts` now validates the original encoded path using the built-in decoder and refuses malformed percent sequences, invalid encoded UTF-8 and inputs over 16,384 UTF-16 code units before delegating to Navigation 6. It preserves the original encoded path, so delimiters, Unicode, literal percent signs and route boundaries keep their existing meaning. Both signed-in and signed-out containers use this configuration for initial and subsequent links. It does not log URL contents or alter auth tokens.

Eight targeted cases pass against the **actual installed Navigation parser**, covering post/profile/chat/story routes, PKCE/email/recovery callback compatibility, valid Unicode/repeated query values, limits, and the published advisory-shaped invalid input. The rejection tests verify that malformed input never reaches the tolerant dependency parser; they do not execute a denial-of-service payload against production. Native TypeScript also passes. Hardware cold/warm links and real auth redirects remain acceptance work.

Zod 3.25.76 had no consumers in the checked application/source/tool/test imports and was removed from the native manifest and lockfile. That first repair reduced the interim root audit from 25 to 24. Compatible tooling maintenance then reduced 24 to 18; the final reviewed source replacements reduce the registry result to zero while retaining two manual-review components. No Zod major upgrade, native platform upgrade, or Navigation major upgrade was introduced.

## Validation and receipts

| Check | Result |
| --- | --- |
| Refreshed npm audit against all three updated lockfiles | Web, admin, and root all exit 0 / 0 registry entries; root retains the two explicit source-review components above. |
| Native source replacements and clean installation | 7 new consumer/security cases, 139 upstream decoder cases, 10 prior dependency cases, and 8 Navigation cases pass. Full isolated `npm ci` and `npm ls` pass; npm 10.9.4 local-reference fixture also passes. |
| Final native TypeScript / Hermes export | Both pass; 2,856 modules and 45 assets. No iPhone distribution artifact was created. |
| Boomerang cancellation regressions | 5 bridge cases and 15 capture/frame-engine cases pass, including close, background, unmount, native timeout fallback, and compatibility with older installed modules. Actual native compile and device acceptance remain separate. |
| Native/root `tsc --noEmit --incremental false` | Pass; `/tmp/platinum-security-root-types.log`. |
| Admin full TypeScript check | Pass; `/tmp/platinum-security-admin-types.log`. |
| Web production build, Next 16.4.3 | Pass, including TypeScript and **80** static pages; `/tmp/platinum-security-web-build.log`. |
| Admin production build, Next 16.4.3 | Pass, including TypeScript and **12** static pages; `/tmp/platinum-security-admin-build.log`. |
| Sharp native binaries | Both web/admin 0.35.5 generated valid PNG buffers from a two-pixel test image. |
| Isolated web source/dependency check | Media lane confirmed full web TypeScript and the React-boundary regression pass with only web dependencies, Next16.4.3 and React19.2.8. Root Expo dependencies are not required by the shared hook. |
| Broad app regressions | The primary agent owns the single final full-suite run across this stabilized tree; its results are reported separately. |

Builds used explicit inert backend values and did not establish a valid provider session. They prove compilation and prerendering, not authenticated feature acceptance or deployment readiness. Next's build warnings identify follow-up maintenance: the web's edge Open Graph runtime is deprecated, and admin's workspace-root inference and default metadata base should be made explicit. They did not fail the build and are not the vulnerabilities described above.

The web/admin dependency-only patch is now verified in production. The broader quality source and native guard remain in draft PR #3; complete the separate native compilation and device/provider acceptance gates before native release readiness. A zero registry audit is not a complete security guarantee, and no newly installed iPhone version is implied.

## Exact production-source hotfix validation

After the initial quality-source build, the release owner prepared an isolated worktree at production source commit **`9906c187521c59254277a00571bded3c8db49b98`** on `codex/web-security-20261029`. Only these four files were copied into it: web/admin `package.json` and `package-lock.json`. A byte comparison confirms they are identical to the audited patch; `git diff --name-only` contains exactly those four paths and `git diff --check` passes. No root dependencies or quality-feature source were added.

Both **standalone TypeScript checks and both production builds pass on that exact master-derived tree**, with Next16.4.3, 80 web static pages and 12 admin static pages. Receipts are `/tmp/platinum-security-master-web-build.log`, `/tmp/platinum-security-master-admin-build.log`, `/tmp/platinum-security-master-web-types.log`, and `/tmp/platinum-security-master-admin-types.log`. Builds again used inert backend values; production environment variables have not been changed.

This removes the remaining source-compatibility uncertainty for a four-file frontend security hotfix. No database migration, app-feature rollout, React change, or iPhone build is needed to deploy those framework fixes. The live Server Actions risk warrants that separately scoped hotfix; the release owner controls its publication and deployment. This receipt itself is still local validation and does not assert that production has been patched.

## Confirmed dependency-only production rollout

[PR #4](https://github.com/donadmiral/tbirds-nest/pull/4) merged as `a692fbc4d05ecc130bb1a7f0e22501836a6e1328` after all three [GitHub quality jobs](https://github.com/donadmiral/tbirds-nest/actions/runs/40945482351) passed. Both Vercel deployments reached READY at that exact source: web `dpl_Pgr8EUCSGmb1r41PsAGGgZmTFRy5` with `platinumcircles.app`/`www.platinumcircles.app`, and admin `dpl_FykSTqA7qdfEmdZqYiT2PvKNW8mQ` with `admin.platinumcircles.app`. Home/login/privacy/terms and the admin public entry redirects returned HTTP 200. This verifies public delivery and source provenance; no signed-in user or staff workflow was represented as passed. The separate support capability UI repair follows this deployment.

The subsequent three-file admin capability [PR #5](https://github.com/donadmiral/tbirds-nest/pull/5) preserves these patched dependencies. Admin is now served by READY deployment `dpl_EtZFdDQDsaZ7V6pifpjSLt3SttCL` at merge `ce4f2f2ebbd7f7669b630caf650fd97cd59297b0`; web remains on the READY dependency-only deployment above because the admin-only merge had no web source change.
