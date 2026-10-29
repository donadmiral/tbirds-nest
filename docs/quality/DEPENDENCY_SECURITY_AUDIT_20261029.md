# Dependency security audit — 29 October 2026

## Status and release boundary

The local web and admin dependency trees now report **zero known vulnerabilities in `npm audit`**. The native repository's compatible transitive updates remove its critical advisory and several high advisories, but five underlying advisory-bearing packages remain. The installed navigation dependency is still reported by npm; the configured native link entry now rejects malformed encoding and oversized paths before that decoder can run. A maintained dependency replacement and physical-device link acceptance remain necessary.

**The dependency-only web/admin repair is merged in [PR #4](https://github.com/donadmiral/tbirds-nest/pull/4), with all three GitHub quality jobs passing. The exact merged patch is now READY on both production domains; deployment receipts are recorded below.** The broader quality source remains in draft PR #3. No iPhone build was created and nothing was submitted to TestFlight; the unchanged installed iPhone retains its existing dependency bundle.

The machine-readable companion, `DEPENDENCY_SECURITY_AUDIT_20261029.json`, preserves the full before/after npm advisory records, exact package locations, direct dependency versions, lockfile changes, and post-update lock hashes. Counts below are npm's vulnerable **package entries**, including affected parents; they are not counts of independently exploitable flaws. A zero audit result is a registry snapshot, not a complete security assessment.

| Dependency tree | Before | After | Result |
| --- | --- | --- | --- |
| Web | 6: 1 critical, 5 high | 0 | All advisories reported for this lockfile cleared locally. |
| Admin web | 8: 1 critical, 7 high | 0 | All advisories reported for this lockfile cleared locally. |
| Native/root | 32: 1 critical, 12 high, 8 moderate, 11 low | 24: 0 critical, 6 high, 7 moderate, 11 low | Compatible transitive fixes applied and unused Zod removed; remaining causes classified below. |

## Changes and compatibility

Only three direct dependencies changed in each Next application: `next`, `@next/env`, and `eslint-config-next`. They are now pinned together to **16.4.3**, from web 16.3.0 and admin 16.2.12. This stays on Next 16. The official [16.4.3 release](https://github.com/vercel/next.js/releases/tag/v16.4.3) and npm metadata were checked; its React peer range includes the apps' existing React 19 versions and its Node requirement is at least 20.9.0. Validation here used Node 24.22.1 and npm 11.9.0.

Web React/React DOM remain **19.2.8**; admin React/React DOM remain **19.2.4**. Root removes the unused direct Zod dependency after an exact source import search found no consumers. Every other root direct dependency has the same installed version as before. This includes Expo **54.0.37**, React Native **0.81.5**, React **19.1.0**, and React Navigation native **6.1.18**. No native module, Expo SDK, navigation major, or React version was upgraded.

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

Root has **19 compatible transitive version changes**, plus the removal of unused Zod. The transitive changes span seven families: brace-expansion (1.1.21 / 2.1.7 / 5.0.12), compression (1.8.2), fast-uri (3.1.9), node-forge (1.4.2), shell-quote (1.12.0), source-map-js (1.2.2), and undici (6.29.1). All satisfy their existing parent dependency ranges. There are no added root overrides; the sole root manifest change removes unused Zod.

The critical root [shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) affects shell quoting of specially formed tokens; the installed chain is **React Native → react-devtools-core → shell-quote**. This is developer tooling, rather than code demonstrating remote command execution in the iPhone app. Its existing 1.x range permits the patched version. The audit also clears the reported Undici TLS-validation/DoS, node-forge signature-verification, compression response-close leak, and URI/source-map/pattern parser advisories; complete source URLs are retained in the JSON evidence.

Updates used explicit package versions and targeted `npm update` with lifecycle scripts disabled. No `npm audit fix --force` was used. Native/transitive package versions outside existing parent constraints were not forced into the lockfile.

## What the framework advisories mean for this app

The framework findings are real release work even though each exploit has prerequisites. The admin uses App Router Server Actions in its security, support, review moderation, recovery, and other action modules. That is a concrete match to the attack surface described by the [Server Actions CPU-denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r). The local version is now beyond its patched 16.4.1 baseline; the dependency-only production rollout is confirmed below.

The critical [SVG image optimizer advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and [typed-array cache advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr) also specify 16.4.1 fixes. The checked source has no `next/image` imports, `dangerouslyAllowSVG`, `remotePatterns`, enabled Cache Components, or `use cache` functions. The web `next/og` endpoint renders fixed branding and does not accept a user-controlled image or payload. Those observations reduce matches to particular exploit prerequisites; they do not justify keeping a vulnerable framework. The bundled framework APIs, future changes, and deployment settings still need the patch. No exploit was attempted against a deployed site.

Sharp is installed in the server image-processing dependency tree. Its [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) and [librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) are addressed by 0.35.5. Most remaining web/admin entries came through lint, CSS compilation, or source-map tooling; a vulnerable package marked as a production dependency is not automatically an app endpoint accepting arbitrary user data. The exact package-chain and source findings are the basis of these classifications.

## Remaining native/root causes

| Underlying package and installed version | Reachability and significance | Compatible patch situation / next work |
| --- | --- | --- |
| **decode-uri-component 0.2.2 — high** | Runtime path: `@react-navigation/native@6.1.18` → core 6.4.17 → query-string 7.1.3 → decoder. `src/navigation/linking.ts` is attached to both NavigationContainers; the core's `getStateFromPath` parses query strings through this decoder. Before the correction, malformed externally supplied queries could reach the affected parser. Both native NavigationContainers now use the guarded parser described below; rejected encoding never reaches the dependency. | [Latest advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) fixes the incomplete earlier correction in **0.5.1**. Registry has no patched 0.2.x; query-string 7 requires `^0.2.2`. npm proposes a React Navigation major upgrade. Do not force a new decoder module into a CommonJS consumer without integration testing. The current input-boundary mitigation is tested against the real installed Navigation parser. Prepare a maintained decoder path or a tested Navigation upgrade, and complete physical cold/warm/auth-callback acceptance; do not claim the vulnerable package was removed. |
| **image-size 1.2.1 — high** | Metro 0.83.3 and the React Native CLI's Metro 0.83.6 use it to read bundled asset dimensions. This is an asset/build pipeline input surface; no app upload/runtime import was found. | [JXL/HEIF parser advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) require **2.0.3**. Metro requests `^1.0.2`; no patched 1.x is published. Needs a tested Metro/Expo compatibility plan. |
| **PostCSS 8.4.49 — high aggregate** | `@expo/metro-config@54.0.17` processes project CSS at build/development time. This is separate from the patched Next PostCSS trees. No native app flow processing untrusted user CSS was found. | Parent requests `~8.4.32`, which excludes 8.5.23. The latest [source-map file-read fix](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) is **8.5.23**. A reviewed Metro-compatible override or SDK/toolchain upgrade needs explicit validation. |
| **deepmerge 4.3.1 — low** | `@expo/config@12.0.14` consumes it for build configuration. npm propagates this finding through many Expo packages; that does not establish eleven independent iPhone vulnerabilities. | [Advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) describes poisoning the returned object's prototype. It lists **no patched version**, and npm latest remains 4.3.1. Track the upstream/config dependency replacement and keep build configuration trusted. |
| **uuid 3.4.0 and 7.0.3 — moderate** | Versions come from development tunnel `@expo/ngrok` and native project generator `xcode`. Their checked call sites use `uuid.v4()`; the advisory concerns buffer arguments in v3/v5/v6, so that vulnerable operation was not found in these consumers. | [Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) fixes supported newer lines beginning at **11.1.1**. No compatible 3.x/7.x patch is available. Upgrade or replace the parent tools through their compatibility process. |

These five packages account for the 24 residual package entries through inherited dependency findings. No conclusion of full native security clearance follows from removing the critical shell-quote warning. The tooling findings require a scoped maintenance plan.

### Native link mitigation and unused dependency removal

`src/navigation/linking.ts` now validates the original encoded path using the built-in decoder and refuses malformed percent sequences, invalid encoded UTF-8 and inputs over 16,384 UTF-16 code units before delegating to Navigation 6. It preserves the original encoded path, so delimiters, Unicode, literal percent signs and route boundaries keep their existing meaning. Both signed-in and signed-out containers use this configuration for initial and subsequent links. It does not log URL contents or alter auth tokens.

Eight targeted cases pass against the **actual installed Navigation parser**, covering post/profile/chat/story routes, PKCE/email/recovery callback compatibility, valid Unicode/repeated query values, limits, and the published advisory-shaped invalid input. The rejection tests verify that the vulnerable parser is never called; they do not execute a denial-of-service payload against production. Native TypeScript also passes. Hardware cold/warm links and real auth redirects remain acceptance work.

Zod 3.25.76 had no consumers in the checked application/source/tool/test imports and has been removed from the native manifest and lockfile. The refreshed root audit therefore falls from the interim 25 entries to 24. No Zod major upgrade, native platform upgrade or decoder override was introduced.

## Validation and receipts

| Check | Result |
| --- | --- |
| Fresh npm audit against all three updated lockfiles | Web exit 0 / 0 entries; admin exit 0 / 0 entries; root exit 1 / the residual entries above. |
| Native/root `tsc --noEmit --incremental false` | Pass; `/tmp/platinum-security-root-types.log`. |
| Admin full TypeScript check | Pass; `/tmp/platinum-security-admin-types.log`. |
| Web production build, Next 16.4.3 | Pass, including TypeScript and **80** static pages; `/tmp/platinum-security-web-build.log`. |
| Admin production build, Next 16.4.3 | Pass, including TypeScript and **12** static pages; `/tmp/platinum-security-admin-build.log`. |
| Sharp native binaries | Both web/admin 0.35.5 generated valid PNG buffers from a two-pixel test image. |
| Isolated web source/dependency check | Media lane confirmed full web TypeScript and the React-boundary regression pass with only web dependencies, Next16.4.3 and React19.2.8. Root Expo dependencies are not required by the shared hook. |
| Broad app regressions | The primary agent owns the single final full-suite run across this stabilized tree; its results are reported separately. |

Builds used explicit inert backend values and did not establish a valid provider session. They prove compilation and prerendering, not authenticated feature acceptance or deployment readiness. Next's build warnings identify follow-up maintenance: the web's edge Open Graph runtime is deprecated, and admin's workspace-root inference and default metadata base should be made explicit. They did not fail the build and are not the vulnerabilities described above.

The web/admin dependency-only patch is now verified in production. The broader quality source and native guard remain in draft PR #3; complete device/provider acceptance and toolchain maintenance before native release readiness. A zero registry audit is not a complete security guarantee, and no newly installed iPhone version is implied.

## Exact production-source hotfix validation

After the initial quality-source build, the release owner prepared an isolated worktree at production source commit **`9906c187521c59254277a00571bded3c8db49b98`** on `codex/web-security-20261029`. Only these four files were copied into it: web/admin `package.json` and `package-lock.json`. A byte comparison confirms they are identical to the audited patch; `git diff --name-only` contains exactly those four paths and `git diff --check` passes. No root dependencies or quality-feature source were added.

Both **standalone TypeScript checks and both production builds pass on that exact master-derived tree**, with Next16.4.3, 80 web static pages and 12 admin static pages. Receipts are `/tmp/platinum-security-master-web-build.log`, `/tmp/platinum-security-master-admin-build.log`, `/tmp/platinum-security-master-web-types.log`, and `/tmp/platinum-security-master-admin-types.log`. Builds again used inert backend values; production environment variables have not been changed.

This removes the remaining source-compatibility uncertainty for a four-file frontend security hotfix. No database migration, app-feature rollout, React change, or iPhone build is needed to deploy those framework fixes. The live Server Actions risk warrants that separately scoped hotfix; the release owner controls its publication and deployment. This receipt itself is still local validation and does not assert that production has been patched.

## Confirmed dependency-only production rollout

[PR #4](https://github.com/donadmiral/tbirds-nest/pull/4) merged as `a692fbc4d05ecc130bb1a7f0e22501836a6e1328` after all three [GitHub quality jobs](https://github.com/donadmiral/tbirds-nest/actions/runs/40945482351) passed. Both Vercel deployments reached READY at that exact source: web `dpl_Pgr8EUCSGmb1r41PsAGGgZmTFRy5` with `platinumcircles.app`/`www.platinumcircles.app`, and admin `dpl_FykSTqA7qdfEmdZqYiT2PvKNW8mQ` with `admin.platinumcircles.app`. Home/login/privacy/terms and the admin public entry redirects returned HTTP 200. This verifies public delivery and source provenance; no signed-in user or staff workflow was represented as passed. The separate support capability UI repair follows this deployment.

The subsequent three-file admin capability [PR #5](https://github.com/donadmiral/tbirds-nest/pull/5) preserves these patched dependencies. Admin is now served by READY deployment `dpl_EtZFdDQDsaZ7V6pifpjSLt3SttCL` at merge `ce4f2f2ebbd7f7669b630caf650fd97cd59297b0`; web remains on the READY dependency-only deployment above because the admin-only merge had no web source change.
