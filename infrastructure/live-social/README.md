# Social worker image build and review

This package uses the existing Live renderer CodeBuild project and ECR repository. It creates no cloud resources and requires no worker bearer, OAuth credential or vault key during the build. The application and provider publishing gates remain off.

## Source package

Run `python infrastructure/live-social/package-source.py` from the repository. It writes a deterministic ZIP and receipt into a newly created temporary directory. Only the 13 explicitly listed worker/build files are included; no environment file, dependency tree or credentials are discovered or copied. `social-source-manifest.json` records every file's exact bytes and SHA-256. The current Git HEAD is descriptive; the individual file hashes are authoritative for an uncommitted reviewed snapshot.

Before building, `verify-source.mjs` checks the operator-supplied manifest SHA-256, every file's hash/size, and rejects extra files, traversal and symbolic links. The check runs before base resolution, registry login or a Docker build.

## Shared CodeBuild invocation

The existing build role can read only the versioned object `source/renderer-source.zip` in the existing bootstrap source bucket. The owner uploads this social ZIP at that exact key and records the returned S3 VersionId. A new object version does not change a previously pinned renderer or transcription build.

The owner then uses the existing CodeBuild project's `StartBuild` with:

- `sourceVersion`: the exact S3 VersionId containing this package.
- `buildspecOverride`: `infrastructure/live-social/buildspec.yml`. The project's default remains the renderer buildspec and will not automatically discover this file.
- `environmentVariablesOverride`: `EXPECTED_MANIFEST_SHA256` set to the reviewed package receipt's manifest hash, with type `PLAINTEXT` because this is a source checksum. The existing `RENDERER_REPOSITORY_URI` and `AWS_DEFAULT_REGION=us-east-2` configuration is reused.

No IAM, Secrets Manager, KMS, ECS or application settings are changed by these build scripts. The shared builder remains limited to one concurrent build and its existing time/resource limits. The image tag is `social-source-<first32-of-manifest-sha256>`, distinct from renderer and transcription tags, and the shared ECR repository keeps tags immutable.

## Actual container gates

`resolve-base.mjs` pulls exactly the official Node `24.22.2-alpine3.24` tag for Linux AMD64, checks the image architecture and `NODE_VERSION`, records its repository digest, and passes only that digest to Docker. The Dockerfile has no mutable default base. Current Alpine security updates are applied and their final package versions are captured; the image digest is the exact deployable artifact.

The final image removes npm, npx, Yarn, Corepack, headers and manual pages; clears setuid/setgid bits; contains no FFmpeg or application dependency tree; and runs as UID1000. It needs only Node's built-in APIs. The existing Fargate service template gives the running application no AWS task role.

All three Docker checks run with `--network none`, a read-only root, dropped capabilities, no privilege escalation, CPU/memory/process limits and the image's nonroot user. Tests needing scratch get a bounded non-executable tmpfs owned by UID1000:

1. `runtime-policy.mjs` produces `social-image-inventory.json` with the exact base digest, Node/OpenSSL/Undici/V8/libuv versions and installed Alpine packages. It rejects unexpected package managers, encoders, compilers or dependencies.
2. The actual Node container runs every worker test. Tests use synthetic responses and never contact a provider.
3. `acceptance.mjs` exercises real private scratch-file I/O and the worker's durable checkpoint/publish/receipt flow with explicit synthetic responses. It verifies mode0700 directories, mode0600 files, one simulated post attempt and cleanup. The receipt explicitly states that no hosted provider was accepted and no external post was created.

Only a successful build with both valid inventory and acceptance receipts may push. `image-receipt.mjs` verifies the resulting ECR digest and reports it with the source manifest hash. It does not deploy a task or enable any gate.

## Image scan and activation

ECR scan-on-push is already enabled on the shared repository. The limited CodeBuild role does not have `DescribeImageScanFindings`; the owner reads the scan result for the exact returned digest after the build. `scan-receipt.mjs` can convert the owner's ECR metadata into a bounded receipt:

```sh
node infrastructure/live-social/scan-receipt.mjs <owner-saved-scan.json> <sha256:digest> <repository-name>
```

The parser binds the exact repository and digest. Pending/failed/missing results and HIGH/CRITICAL findings cannot pass its high/critical gate. A passing scan is not a claim that the image has no vulnerabilities; the runtime component inventory still requires review because packaged scanner coverage can differ for Node's bundled libraries. Never fabricate scan metadata or mark a local parser fixture as an actual image scan.

Only after the owner reviews the actual container receipts, scan and component inventory should the service use that exact ECR digest. Its default desired count is zero. OAuth registrations, provider approvals, creator consent, media-delivery acceptance and the destination's explicit database publishing gate remain separate activation requirements.

## Local verification

`node --test workers/live-social/test/*.test.mjs infrastructure/live-social/test/*.test.mjs` runs the local worker/build-policy tests. A machine without Docker cannot produce an actual container inventory, acceptance or ECR scan receipt. This workspace's local source tests are reported separately from the owner's CodeBuild results.
