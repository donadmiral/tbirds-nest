# Browser export and native gate repair

This review starts from `efe9dc8a234dcffb58e15a93c739dce076e7e103` on `codex/app-quality-20261029`. Source hashes and machine-readable observations are in `CI_GATE_REPAIR_20261029.json`. The changes described here require a new hosted CI run before its result can be called verified.

## Browser export

The failed hosted browser job was run `40982006487`, job `123824042566`. All 17 admin interactions passed with zero browser errors. The actual encoded video check then failed because its one-second trim/speed recipe reported a duration of 0.7388 seconds.

The exporter reset its elapsed-time clock when the asynchronously delivered MediaRecorder `start` event arrived. With Chromium 153 and software rendering, that event arrived hundreds of milliseconds after recording and source playback had begun. The WebM finalizer consequently received a duration shorter than the already-recorded media timeline.

The export clock now starts with the recording operation and is never reset by that notification. The exporter requests the selected first canvas frame before playback, verifies that the source actually reached the selected trim position, and stops before drawing beyond the trim end. If a source cannot seek, it rejects the export instead of quietly saving an untrimmed beginning.

The last `dataavailable` callback can occur after `stop()`. An oversized final chunk now rejects the operation even after stopping has begun. Previously the already-set stopping flag could suppress that error and return the earlier chunks as a truncated file.

The synthetic HTTP fixture also lacked byte-range responses. Chromium 153 fired `seeked` at time zero when that fixture could not satisfy the request. The fixture now implements bounded 206 responses. Its source has a white introduction before the trim point, so decoded output must prove that the introduction was removed.

The original duration, resolution, pixel grading, artwork timing and sound-mix assertions remain. Additional checks inspect encoded packet timestamps, the first decoded trimmed frame, a deliberately delayed recorder-start event and an oversized final chunk. The fixture verifies actual files with ffprobe and ffmpeg, rather than accepting the exporter's claimed duration.

## Browser verification

Five cases pass in Chrome for Testing 153.0.8010.12, the exact CI browser, and 156.0.8078.80:

- Graded video with original audio.
- Muted export without an audio track.
- Export while the recorder-start notification is delayed by 350 milliseconds.
- Rejection of an oversized final chunk without returning a partial export.
- Cancellation without an export result.

Chrome 153 produced durations of 1.0683, 1.0985 and 1.062099 seconds for the three successful one-second recipes. VP9 packets do not contain a final held-frame duration, so the timestamp guard checks that metadata cannot cut off recorded timestamps. The existing bounded duration assertion covers the ending hold.

Substituting the original exporter into the strengthened fixture reproduces a failure at 0.7045 seconds. Web TypeScript, four WebM-header cases and ten video recipe/bridge/controller cases pass. This is synthetic browser verification, not physical iPhone, Safari, authenticated private-media or provider acceptance.

## Native build and receipt

Hosted native run `40982006582`, job `123824043086`, compiled and linked the x86_64 iOS Simulator app. Its retained `xcodebuild.log` ends with `BUILD SUCCEEDED`. The overall workflow still failed and did not produce `receipt.json`. The complete job-log tool could not return its large console log, so the exact postflight stderr was not available in this review.

The postflight script contained a definite argument-order defect: it put the executable after `lipo -verify_arch x86_64`. Apple's lipo manual states that every input file must precede `-verify_arch`, because all following arguments are architecture names. The corrected command supplies the executable first. Postflight output is now retained in `native-compile-logs/postflight.log` so a failure after compilation remains inspectable in the artifact.

The gate still requires compiled objects for `BoomerangModule.swift`, `StoryVideoView.swift` and `StoryVideoComposition.swift`. It still requires the nonempty `PlatinumQA.app/PlatinumQA` executable and verifies its x86_64 architecture. No object, linking or architecture gate was removed. Shell and embedded-Python syntax pass. A new hosted run must establish that all postflight checks now finish successfully.

## Minimum iOS version review

The simulator linker warned that Skia objects were built for iOS Simulator 16.0 while the app deployment minimum is 15.1. The exact installed Skia 2.2.12 binary load commands were inspected across all nine XCFramework archives:

- Device arm64 objects declare iOS 13.0.
- Device arm64e objects declare iOS 14.0.
- Simulator x86_64, arm64 and arm64e objects declare iOS Simulator 16.0.

Skia's installed podspec declares iOS 14.0. React Native's installed CocoaPods helper declares 15.1, consistent with Expo SDK 54's documented support. These simulator-only warnings do not establish that the app requires iOS 16 on a physical device. The app minimum remains 15.1. No dependency upgrade, simulator-only target override or device-support reduction was made to suppress them.

## Primary references

- [W3C MediaStream Recording, start algorithm](https://www.w3.org/TR/mediastream-recording/): recording and event dispatch are asynchronous.
- [W3C Media Capture from DOM Elements](https://www.w3.org/TR/mediacapture-fromelement/): canvas frame capture and requestFrame semantics.
- [Apple cctools lipo manual](https://github.com/apple-oss-distributions/cctools/blob/main/man/lipo.1): input-file ordering for verify_arch.
- [Expo SDK support table](https://docs.expo.dev/versions/v55.0.0/): the SDK 54 row specifies iOS 15.1.
- [Skia v2 installation guidance](https://wcandillon.github.io/react-native-skia/v2/docs/getting-started/installation/), plus the pinned local podspec and binary metadata in the receipt.

No TestFlight submission, signed archive, production promotion or physical-device acceptance is represented by this work.
