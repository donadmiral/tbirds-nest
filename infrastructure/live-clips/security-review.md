# Renderer image security review — 2026-11-03

## Decision and exact scope

The initial Bookworm image `sha256:9a171ec1421d60a878bdc8f8a32ee41c6d62af61405cf40a14ad7aae805297a4` passed its functional encoder checks but is **held from service activation**. Its actual ECR scan reported two critical and 42 high findings. The operator receipt is `supabase/ops/live-release-20261103/evidence/live-renderer-initial-image-scan.json`. This document describes the replacement build; it does not claim that the replacement has already built, passed a scan or run on Fargate.

Changing only to Debian trixie would retain known RIST and HLS issues. Debian currently records Bookworm FFmpeg 5.1.9 and trixie FFmpeg 7.1.5 as affected, while its 9.0.2 package contains the fixes. The replacement uses the official Node 24.22.2 image on supported Alpine 3.24 and a deliberately limited, source-built FFmpeg 9.0.2.

## Fixes and removed code

| Finding or surface | Replacement treatment | Primary evidence |
| --- | --- | --- |
| Critical CVE-2026-75143, RIST overflow | FFmpeg 9.0.2 contains the release-branch fix; RIST and all network protocols are also absent from this build. Only `file` and `pipe` exist. | [Debian record and upstream fixing commits](https://security-tracker.debian.org/tracker/CVE-2026-75143) |
| HLS CVE-2026-107695 and CVE-2026-107697 | Use the fixed upstream release. Keep Node's bounded, scoped downloader and generated local media playlist; reject remote child resources, encryption and rolling-window timing. | [HLS loop fix](https://security-tracker.debian.org/tracker/CVE-2026-107695), [HLS policy fix](https://security-tracker.debian.org/tracker/CVE-2026-107697) |
| Critical TIFF CVE-2026-52490 and other TIFF findings | No TIFF package, TIFF decoder, image viewer or tiffcrop is installed. JPEG cover support uses FFmpeg's selected MJPEG encoder/decoder. This is removal of the component, not a claim that vulnerable TIFF was patched. | [Debian TIFF record](https://security-tracker.debian.org/tracker/CVE-2026-52490) |
| SVG, JPEG-XL, cJSON, Speex and X11 dependencies from the broad distro FFmpeg | Those packages and corresponding inputs are absent. Runtime package and compile-component gates reject their accidental return. | Original image scan and the actual replacement inventory must be compared. |
| Recent Huffyuv/CDXL/Sun Raster/PCX/Go2Meeting and IMF issues still listed for 9.0.2 | All of these decoders/demuxers are disabled, as are DVD/DVB subtitle parsers, RTP/RTSP, DASH, IAMF, WTV, AVI and unnecessary filters. Explicit `--disable-everything` plus allowlists is checked against compiled configuration. | [Current FFmpeg tracker](https://security-tracker.debian.org/tracker/source-package/ffmpeg) |
| Bookworm glibc and util-linux findings | The runtime uses musl, and installs neither glibc nor util-linux. All setuid/setgid bits are removed. Nonroot UID 1000, read-only root and dropped Linux capabilities remain enforced. | [glibc issue conditions](https://security-tracker.debian.org/tracker/CVE-2026-84243), actual package inventory |

The permitted media path is H.264/AAC in HLS MPEG-TS or fragmented MP4, selected WebVTT captions, H.264/AAC MP4 output and MJPEG covers. The image also includes local synthetic source filters and HLS muxing for offline acceptance. It has no URL-capable FFmpeg network protocol, capture device, hardware decoder or general media-conversion API. Customer input still reaches complex H.264/AAC, container, scaling and caption code; a small build is not proof of absence of vulnerabilities.

### Verified native dependency inventory

The fourth actual CodeBuild attempt successfully verified the official signature and expected source hash, compiled FFmpeg, then stopped at `encoder_unapproved_demuxer`. Its component report exposed required dependencies that the first inventory policy omitted. The policy now records only those observed dependencies, checked against the [official n9.0.2 configure source](https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/configure):

| Selected component | Automatically selected dependency |
| --- | --- |
| HLS demuxer | AC3 and EAC3 demuxers, using the already selected AC3 parser |
| MOV muxer | VP9 superframe bitstream filter |
| MPEG-TS muxer for synthetic HLS acceptance | HEVC and VVC MP4-to-Annex-B bitstream filters |
| FFmpeg command-line tool | Crop, horizontal/vertical flip, rotate and transpose filters |

The observed decoder set remains AAC, AAC-LATM, H.264, MJPEG, PCM-S16LE, raw video, WebVTT and wrapped AVFrame. The encoder set remains AAC, libx264, MJPEG, PCM-S16LE, raw video and wrapped AVFrame. HEVC, VVC, VP9, AC3 and EAC3 **decoders remain disabled**, and the regression gate rejects them. Parser inventory is AAC, AAC-LATM, AC3, H.264 and MJPEG; no hardware accelerators were enabled. Only `file` and `pipe` protocols exist. The renderer still supplies the input format whitelist `hls,mpegts,mov` and explicitly selects libx264/AAC output, so these automatic helpers are not new supported customer formats. They remain native code in the inventory and must not be described as absent. A new build must pass the exact compiled-inventory gate and real encode/decode checks.

## Known reachable residual: CVE-2025-52290

Debian marks the fixed-version status **undetermined**, including FFmpeg 9.0.2. The reporter describes a crafted MPEG-TS input that mixes AAC/H.264 codec contexts and crashes `avpriv_h264_has_num_reorder_frames` during probing. The disclosure identifies a tested development revision, not a verified fixing release; it does not demonstrate code execution. H.264/AAC MPEG-TS is required here, so this path cannot honestly be called removed or fixed. See [Debian's status](https://security-tracker.debian.org/tracker/CVE-2025-52290) and the [reporter's disclosure](https://www.openwall.com/lists/oss-security/2026/10/20/6).

The explicit residual is an input-triggered encoder crash and failed/retried job. Each encoder runs in a child process with a stripped environment; a four-minute overall job deadline sends TERM, then KILL after one second. The focused cancellation test starts a synthetic process that ignores TERM, verifies it is gone after KILL and confirms a later command works. Existing worker tests verify durable queue results, scratch removal and release of warm-worker admission after cancellation. They do not test the exploit or establish a fixed FFmpeg version.

The task has a four-GiB memory ceiling and two CPUs; the downloader/output budgets and lease fencing remain. Its parent process must hold the broker credential, so environment stripping alone is not a security boundary against arbitrary native-code execution under the same container UID. No such execution is established by this CVE, but a future reachable memory-corruption finding requires a new review. Database retry limits, bounded fleet admission and monitoring reduce operational exposure; they do not eliminate denial of service. Production approval must explicitly retain or reject this residual.

## Reproducibility, authenticity and scanner coverage

The [official Node image index](https://github.com/docker-library/official-images/blob/master/library/node) lists `24.22.2-alpine3.24`, sourced from commit `e994dfe115899a82684caa7533380aa7d439aae1`. `resolve-base.mjs` checks that version and Linux/AMD64, records Docker's repository digest, then passes the digest to both stages. It never builds from a floating digest after resolution. Alpine's [release table](https://www.alpinelinux.org/releases/) lists 3.24 support through June 2028.

FFmpeg's [official release page](https://ffmpeg.org/download.html) lists 9.0.2 and release-signing fingerprint `FCF986EA15E6E293A5644F10B4322F04D67658D8`. The builder downloads only the official HTTPS release, detached signature and public key. It checks that fingerprint and a valid matching signature, verifies the expected SHA-256, and only then extracts. The source `VERSION` must match. Any failed verification stops the build; there is no unsigned fallback. The expected source digest is independently checked against the signed upstream bytes by the actual build, not claimed as a completed local download.

The runtime inventory includes source URL/hash, release key, FFmpeg version, component counts, binary hashes, exact base identity and complete Alpine package versions. A generic FFmpeg package URL and CPE retain explicit source-component identity even though no distro `ffmpeg` package exists. Direct external library/font package versions are pinned to the builder's resolved stable-branch packages; transitive packages and all resulting bytes are recorded and frozen by the final image digest. Refreshing a dependency or rebuilding requires renewed image, source-advisory and acceptance review.

The builder has no broker/customer credentials. Compiler packages, GPG keyring, source tarball and added build-time curl stay in the discarded builder stage. Headers, npm and Yarn are removed from the runtime. Alpine's base utilities/package tool and the documented application sources/tests remain; this is not a shell-free image. Release gates are the actual signature/checksum result, component/package inspection, functional encode/decode tests, vulnerability/reachability review, exact-image Fargate timing and the separate real broker/Storage flow. Passing an OS scan by removing a package-manager entry is never a sufficient gate.

### Public metadata permissions

The source resolver writes public base-image metadata as root with mode `0600` in the build workspace. The runtime Docker copy now explicitly sets **`0444`** for that file. No secret or private media permissions change. Other runtime metadata comes from the authenticated compiler stage or the root build-time inventory; the runtime gate checks each actual copied file rather than relying on the build user's access.

Both the post-build inventory and offline encoder acceptance require actual **UID 1000**. They verify root ownership, public readability and absence of group/world write permission for the base receipt, configure headers, build configuration, source checksum and inventory. The base receipt must be exactly `0444`, and each file is actually read. Encoder binaries are read and executed by the existing inventory gate; fonts and caption libraries are exercised by the actual caption/watermark render. The root-only inventory-generation step is separate from these nonroot gates. The local regression reproduces the metadata invariant and rejects the previous `0600` mode; actual nonroot reads and encoding are acceptance outcomes of the rebuilt image, not a claimed local UID-switch result.

## Operational readiness

Bootstrap resources and paired broker authentication were verified by the operator. The service template remains ready for a reviewed immutable digest with desired count zero, no ingress or AWS task role. A separate budgeted launcher starts finite tasks. Activation is held for the replacement build/security review, actual Fargate acceptance and retained-source broker/Storage verification. The four-minute deadline has not yet been demonstrated for ten-minute dual-format high-motion clips. Daily broadcast/storage acceptance and the five-million-user capacity target remain separate gates.
