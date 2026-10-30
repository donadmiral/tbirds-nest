# iOS native compilation gate — 29 October 2026

The new memory/story Swift implementation needs a real Apple compiler and Expo headers. A TypeScript check or browser renderer cannot establish that it compiles. `.github/workflows/ios-native-compile.yml` adds that missing gate without releasing an iPhone build.

## What the gate does

The job uses a fresh GitHub macOS 15 runner with **Xcode 16.4**, Node **22**, and CocoaPods **1.16.2**. It installs the committed npm lockfile with package lifecycle scripts disabled, generates the QA native project using the installed Expo 54 template and existing config plugins, installs CocoaPods, and compiles the app's Debug **iOS Simulator** scheme. The actual Expo module and its AVFoundation/Core Image code compile with real native dependencies. Successful completion also requires object files for `BoomerangModule.swift`, `StoryVideoView.swift`, and `StoryVideoComposition.swift`; an accidentally omitted local module cannot produce a passing receipt.

The script refuses to run outside a disposable macOS CI checkout or overwrite an existing `ios` directory. It uses an inert provider key, does not launch the app, and does not contact a backend through an authenticated app session. The QA URL is present only to satisfy the app's existing configuration-origin validation.

## Release boundary

GitHub permissions are **`contents: read`** only. Checkout does not persist credentials. The official checkout, Node setup, and diagnostic-artifact actions are pinned to the verified commit hashes behind their v4 release tags. No repository or Apple secrets are requested.

The `xcodebuild` action is `build` with the simulator SDK, generic simulator destination, and signing disabled. There is no archive, IPA export, EAS command, certificate/profile retrieval, installation, distribution upload, App Store Connect, or TestFlight step. Only compiler logs and a source-hash receipt are retained for seven days; no `.app`, archive, or IPA is uploaded.

The gate runs for pull requests and master changes affecting native modules/configuration/dependencies, and can be dispatched manually. A successful run must be associated with the exact release source SHA. This file describes the implemented gate; it does **not** assert a successful hosted Xcode run before its result exists.

## Evidence and limits

The native Boomerang writer previously had unbounded readiness polling and a finalization semaphore with no timeout. It now uses a 20-second monotonic deadline, checks reader/writer terminal states, and supports synchronously reserved cancellation jobs. Closing, backgrounding, unmounting, and the existing 25-second JavaScript fallback deadline abort the corresponding job. The JavaScript bridge feature-detects all three new methods; an older installed module keeps its existing API, and a late successful output is discarded only after its encoder promise has settled.

Writer operations and cancellation are serialized. Every encode writes to its own staging file and moves it to the requested fresh cache path only after successful finalization. Cancellation waits for at most a 500-millisecond cleanup grace period before rejecting. Because Apple's `cancelWriting()` can itself block, cleanup runs on a separate queue; it removes the staging file only after cancellation returns, and the registry continues rejecting new native jobs while that writer is stopping. No timeout callback can overwrite or delete a newer output. Synchronous operating-system media calls can still require device testing; the JavaScript cancellation path remains immediately rejectable while native cleanup finishes.

Five real bridge compatibility/cancellation regressions and the 15-test capture lifecycle/frame-engine suite pass. TypeScript and whitespace checks pass. They do not replace the native compiler gate or iPhone capture, interruption, and export testing.

Shell syntax and workflow YAML/permissions checks pass. An isolated Linux prebuild also passes with the exact QA environment: it generates the `PlatinumQA` scheme, existing call-plugin integration, and the current Expo 54 Podfile without manifest changes. The actual Expo autolinking resolver includes the local `Boomerang` pod and `BoomerangModule`, confirming that the gate's module check targets the generated project.

The Linux workspace cannot execute Xcode or CocoaPods' macOS compilation. The release owner will publish the gate and inspect the actual hosted compiler result, correcting any errors it exposes before calling native compilation verified.

Even a successful simulator compile does not establish rendering correctness, Photos export, HEIC/HDR input handling, camera capture, call/audio interruptions, two-device delivery, or device/provider acceptance. Those remain real-environment checks. TestFlight stays on hold.

## Official references checked

- [Expo SDK 54 release notes](https://expo.dev/changelog/sdk-54): Node minimum 20.19.4 and the bundled prebuild template.
- [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/): Xcode 16.4/CocoaPods 1.16.2 are the documented SDK 54 toolchain option.
- [GitHub macOS 15 runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md): Xcode 16.4 is available at the pinned path. The image's current default CocoaPods is newer, so the workflow explicitly installs 1.16.2.
- [Expo local app development](https://docs.expo.dev/guides/local-app-development/) and [Expo CLI](https://docs.expo.dev/more/expo-cli/): native project generation and generic simulator compilation.
- [GitHub workflow permission syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): specifying only `contents: read` leaves unlisted token permissions disabled.
- [Apple AVAssetWriter cancellation](https://developer.apple.com/documentation/avfoundation/avassetwriter/cancelwriting()): cancellation can block until pending writing is stopped, so an active staging file is not prematurely unlinked.
