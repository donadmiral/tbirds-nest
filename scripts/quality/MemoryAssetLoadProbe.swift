import UIKit
import AVFoundation
import CoreMedia
import CoreVideo
import CryptoKit
import Darwin

// Standalone diagnosis of the exact local file and the three-key await used by
// expo-video 3.0.16. This does not execute Expo, React Native or a product export.
private enum ProbeError: Error {
  case invalid(String)
}

private final class MemoryAssetProbe: @unchecked Sendable {
  static let expectedBytes = 54_300
  static let expectedHash = "e7a68e03487b0527b67426cf8a9a706a047a70535d571c17ead636b1806013f2"
  private let lock = NSLock()
  private let started = ProcessInfo.processInfo.systemUptime
  private var generation = 0
  private var finished = false
  private var stage = "initializing"
  private var events: [[String: Any]] = []
  private var evidence: [String: Any] = [:]
  private let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

  private func now() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

  private func add(_ fields: [String: Any]) {
    lock.lock()
    if !finished { evidence.merge(fields) { _, new in new } }
    lock.unlock()
  }

  @discardableResult private func begin(_ name: String, seconds: Double) -> Double {
    let at = now()
    lock.lock()
    generation += 1
    let ticket = generation
    stage = name
    events.append(["phase": name, "atUptimeMs": at,
                   "atUnixMs": Date().timeIntervalSince1970 * 1000,
                   "deadlineSeconds": seconds, "mainThread": Thread.isMainThread])
    lock.unlock()
    // A task group would wait for a cancelled AVFoundation child. This timer
    // instead writes a terminal receipt and exits from an independent queue.
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + seconds) { [self] in
      finish(false, reason: "phase_deadline", expectedGeneration: ticket,
             additional: ["timedOutPhase": name, "phaseElapsedMs": now() - at,
                          "deadlineSeconds": seconds])
    }
    return at
  }

  private func errorDetails(_ error: Error, depth: Int = 0) -> [String: Any] {
    let value = error as NSError
    let allowed = ["AVFoundationErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain", "NSURLErrorDomain"]
    var result: [String: Any] = ["domain": allowed.contains(value.domain) ? value.domain : "other",
                                 "code": value.code]
    if depth < 2, let underlying = value.userInfo[NSUnderlyingErrorKey] as? NSError {
      result["underlying"] = errorDetails(underlying, depth: depth + 1)
    }
    // Deliberately omit descriptions, userInfo, paths and URLs.
    return result
  }

  private func finish(_ passed: Bool, reason: String, expectedGeneration: Int? = nil,
                      additional: [String: Any] = [:]) {
    lock.lock()
    guard !finished, expectedGeneration == nil || expectedGeneration == generation else {
      lock.unlock()
      return
    }
    finished = true
    var receipt: [String: Any] = [
      "schemaVersion": 1, "passed": passed, "reason": reason, "phase": stage,
      "elapsedMs": (ProcessInfo.processInfo.systemUptime - started) * 1000,
      "events": events, "evidence": evidence,
      "scope": "standalone_exact_fixture_avfoundation_probe",
      "loadContract": "AVAsset.load(.duration, .preferredTransform, .isPlayable)",
      "loadDeadlineSeconds": 20, "requestedDecodedFrames": 6,
      "productionJsExecuted": false, "expoPlayerExecuted": false,
      "productAcceptance": false, "networkUsed": false,
      "photosWritten": false, "movieExported": false,
    ]
    receipt.merge(additional) { _, new in new }
    lock.unlock()
    do {
      try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
      let bytes = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
      guard bytes.count <= 32 * 1024 else { exit(2) }
      try bytes.write(to: documents.appendingPathComponent("memory-asset-probe.json"), options: .atomic)
    } catch {
      fputs("MEMORY_ASSET_PROBE_RECEIPT_FAILED\n", stderr)
      exit(2)
    }
    print(passed ? "MEMORY_ASSET_PROBE_PASSED" : "MEMORY_ASSET_PROBE_FAILED")
    fflush(stdout)
    // This is a disposable standalone process. No cancellation wait can extend
    // the observed 20-second load deadline or keep a stalled child alive.
    exit(passed ? 0 : 1)
  }

  private func hash(_ url: URL) throws -> (String, Int) {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var digest = SHA256(), count = 0
    while let chunk = try handle.read(upToCount: 64 * 1024), !chunk.isEmpty {
      count += chunk.count
      guard count <= Self.expectedBytes else { throw ProbeError.invalid("fixture_size") }
      digest.update(data: chunk)
    }
    return (digest.finalize().map { String(format: "%02x", $0) }.joined(), count)
  }

  private func copyFixture() throws -> URL {
    guard let source = Bundle.main.url(forResource: "fixture", withExtension: "mp4"), source.isFileURL else {
      throw ProbeError.invalid("missing_local_fixture")
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: source.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          (attributes[.size] as? NSNumber)?.intValue == Self.expectedBytes else {
      throw ProbeError.invalid("fixture_size")
    }
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
    let target = cache.appendingPathComponent("memory-asset-probe-source.mp4")
    guard target.isFileURL, !FileManager.default.fileExists(atPath: target.path),
          FileManager.default.createFile(atPath: target.path, contents: nil) else {
      throw ProbeError.invalid("copy_target")
    }
    let input = try FileHandle(forReadingFrom: source)
    let output = try FileHandle(forWritingTo: target)
    var closed = false
    defer { if !closed { try? input.close(); try? output.close() } }
    var copied = 0, writes = 0
    while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty {
      copied += chunk.count
      guard copied <= Self.expectedBytes else { throw ProbeError.invalid("copy_limit") }
      try output.write(contentsOf: chunk)
      writes += 1
    }
    try output.close()
    try input.close()
    closed = true
    let original = try hash(source), copy = try hash(target)
    add(["sourceBytes": original.1, "copiedBytes": copy.1,
         "sourceSha256": original.0, "copiedSha256": copy.0,
         "fileHandlesClosedBeforeLoad": true, "sourceIsFileURL": true, "copyIsFileURL": true,
         "copyWriteCount": writes, "copyChunkLimit": 64 * 1024])
    guard copied == Self.expectedBytes, original.1 == Self.expectedBytes, copy.1 == Self.expectedBytes,
          original.0 == Self.expectedHash, copy.0 == Self.expectedHash else {
      throw ProbeError.invalid("fixture_hash")
    }
    return target
  }

  private func decode(_ asset: AVAsset, track: AVAssetTrack) async throws -> [String: Any] {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let reader = try AVAssetReader(asset: asset)
          defer { reader.cancelReading() }
          let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
          ])
          output.alwaysCopiesSampleData = false
          guard reader.canAdd(output) else { throw ProbeError.invalid("reader_output") }
          reader.add(output)
          guard reader.startReading() else {
            throw reader.error ?? ProbeError.invalid("reader_start")
          }
          var frames: [[String: Any]] = [], previous = -Double.infinity
          for _ in 0..<6 {
            guard let sample = output.copyNextSampleBuffer(), CMSampleBufferIsValid(sample),
                  CMSampleBufferGetNumSamples(sample) > 0,
                  let pixels = CMSampleBufferGetImageBuffer(sample) else {
              throw reader.error ?? ProbeError.invalid("decoded_sample_missing")
            }
            let time = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            let width = CVPixelBufferGetWidth(pixels), height = CVPixelBufferGetHeight(pixels)
            guard time.isFinite, time >= 0, time > previous,
                  width > 0, width <= 8192, height > 0, height <= 8192,
                  CVPixelBufferGetPixelFormatType(pixels) == kCVPixelFormatType_32BGRA else {
              throw ProbeError.invalid("decoded_sample_invalid")
            }
            previous = time
            frames.append(["presentationSeconds": time, "width": width, "height": height,
                           "pixelFormat": "32BGRA"])
          }
          let status: String
          switch reader.status {
          case .reading: status = "reading"
          case .completed: status = "completed"
          default: throw reader.error ?? ProbeError.invalid("reader_status")
          }
          continuation.resume(returning: ["decodedFrames": frames, "decodedFrameCount": frames.count,
                                           "readerStatusBeforeStop": status, "stoppedAfterRequestedFrames": true])
        } catch { continuation.resume(throwing: error) }
      }
    }
  }

  @MainActor func run() async {
    // A second independent deadline covers setup/track/decode failures. The
    // phase timer below remains the stricter 20-second asset-load deadline.
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 45) { [self] in
      finish(false, reason: "process_deadline")
    }
    do {
      guard Bundle.main.bundleIdentifier == "com.platinum.qa.memoryassetprobe",
            UIDevice.current.systemVersion == "18.5", Thread.isMainThread else {
        throw ProbeError.invalid("runtime_identity")
      }
      begin("foreground", seconds: 5)
      while UIApplication.shared.applicationState != .active {
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      add(["systemVersion": UIDevice.current.systemVersion, "mainActorEntry": true,
           "applicationActive": true, "assetClass": "AVURLAsset", "avAssetOptions": "nil"])
      let copyStarted = begin("copy_and_hash", seconds: 5)
      let source = try copyFixture()
      add(["copyAndHashMs": now() - copyStarted])
      let asset = AVURLAsset(url: source)
      let loadStarted = begin("asset_keys", seconds: 20)
      let (duration, transform, playable) = try await asset.load(.duration, .preferredTransform, .isPlayable)
      let seconds = duration.seconds
      let matrix = [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty].map { Double($0) }
      guard seconds.isFinite, seconds > 0, matrix.allSatisfy({ $0.isFinite }) else {
        throw ProbeError.invalid("asset_metadata")
      }
      add(["assetLoadMs": now() - loadStarted, "durationSeconds": seconds,
           "playable": playable, "preferredTransform": matrix, "mainActorAfterLoad": Thread.isMainThread])
      guard playable, abs(seconds - 3) < 0.06 else { throw ProbeError.invalid("unexpected_fixture_metadata") }
      let tracksStarted = begin("video_tracks", seconds: 5)
      let tracks = try await asset.loadTracks(withMediaType: .video)
      guard let track = tracks.first, tracks.count <= 8 else { throw ProbeError.invalid("video_track_missing") }
      add(["videoTracksMs": now() - tracksStarted, "videoTrackCount": tracks.count])
      let decodeStarted = begin("decode_frames", seconds: 10)
      let decoded = try await decode(asset, track: track)
      add(decoded)
      add(["decodeMs": now() - decodeStarted])
      finish(true, reason: "six_frames_decoded")
    } catch ProbeError.invalid(let reason) {
      finish(false, reason: reason)
    } catch {
      finish(false, reason: "native_error", additional: ["error": errorDetails(error)])
    }
  }
}

@MainActor private final class MemoryAssetProbeDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private let probe = MemoryAssetProbe()
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = UIViewController()
    window?.makeKeyAndVisible()
    Task { await probe.run() }
    return true
  }
}

@main private struct MemoryAssetProbeMain {
  @MainActor static func main() {
    UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(MemoryAssetProbeDelegate.self))
  }
}
