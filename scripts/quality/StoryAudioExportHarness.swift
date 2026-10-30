import UIKit
import AVFoundation
import CoreMedia
import CoreVideo

private enum FixtureError: Error, LocalizedError {
  case failed(String)
  var errorDescription: String? { if case .failed(let value) = self { return value }; return nil }
}
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw FixtureError.failed(message) }
}

@MainActor
private enum StoryAudioFixture {
  static let width = 360, height = 640
  static let files = FileManager.default
  static var cache: URL { files.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
  static var documents: URL { files.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  static var results: [[String: Any]] = []

  static func wave(_ url: URL, seconds: Int, sample: (Double) -> Double) throws {
    let rate = 48000, count = seconds * rate
    var data = Data()
    func word<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    data.append(contentsOf: "RIFF".utf8); word(UInt32(36 + count * 2)); data.append(contentsOf: "WAVEfmt ".utf8)
    word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(rate)); word(UInt32(rate * 2)); word(UInt16(2)); word(UInt16(16))
    data.append(contentsOf: "data".utf8); word(UInt32(count * 2))
    for index in 0..<count { word(Int16(max(-0.95, min(0.95, sample(Double(index)/Double(rate)))) * 32767)) }
    try data.write(to: url)
  }

  static func video(_ url: URL, seconds: Int) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = false
    let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
    try require(writer.canAdd(input), "Fixture video input unavailable")
    writer.add(input); try require(writer.startWriting(), "Fixture video did not start"); writer.startSession(atSourceTime: .zero)
    var pixel: CVPixelBuffer?
    try require(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pixel) == kCVReturnSuccess, "Fixture pixel allocation failed")
    guard let pixel else { throw FixtureError.failed("Fixture pixel missing") }
    CVPixelBufferLockBaseAddress(pixel, [])
    guard let address = CVPixelBufferGetBaseAddress(pixel) else { throw FixtureError.failed("Fixture pixel address missing") }
    let stride = CVPixelBufferGetBytesPerRow(pixel), pixels = address.assumingMemoryBound(to: UInt8.self)
    for y in 0..<height { for x in 0..<width { let offset = y * stride + x * 4; pixels[offset] = 180; pixels[offset+1] = 90; pixels[offset+2] = 20; pixels[offset+3] = 255 } }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    for index in 0..<(seconds * 30) {
      while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 10_000_000) }
      try require(adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(index), timescale: 30)), "Fixture video frame failed")
    }
    input.markAsFinished(); writer.endSession(atSourceTime: CMTime(seconds: Double(seconds), preferredTimescale: 600))
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in writer.finishWriting { continuation.resume() } }
    try require(writer.status == .completed, "Fixture video did not finish")
  }

  static func withOriginalAudio(video: URL, audio: URL, destination: URL) async throws {
    let asset = AVURLAsset(url: video), sound = AVURLAsset(url: audio), composition = AVMutableComposition()
    let range = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
    guard let v = try await asset.loadTracks(withMediaType: .video).first, let a = try await sound.loadTracks(withMediaType: .audio).first,
      let vt = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let at = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw FixtureError.failed("Fixture source tracks missing") }
    try vt.insertTimeRange(range, of: v, at: .zero); try at.insertTimeRange(range, of: a, at: .zero)
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw FixtureError.failed("Fixture export unavailable") }
    export.outputURL = destination; export.outputFileType = .mp4
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
    try require(export.status == .completed, "Fixture source mux failed")
  }

  static func samples(_ url: URL, at: Double) async throws -> [Float] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw FixtureError.failed("Encoded audio track missing") }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: at, preferredTimescale: 48000), duration: CMTime(seconds: 0.3, preferredTimescale: 48000))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false])
    try require(reader.canAdd(output), "PCM reader output unavailable"); reader.add(output)
    try require(reader.startReading(), "PCM reader did not start")
    var values: [Float] = []
    while let sample = output.copyNextSampleBuffer() {
      guard let buffer = CMSampleBufferGetDataBuffer(sample) else { throw FixtureError.failed("PCM buffer missing") }
      let size = CMBlockBufferGetDataLength(buffer)
      var bytes = Data(count: size)
      let status = bytes.withUnsafeMutableBytes { raw in CMBlockBufferCopyDataBytes(buffer, atOffset: 0, dataLength: size, destination: raw.baseAddress!) }
      try require(status == kCMBlockBufferNoErr && size % 4 == 0, "PCM buffer invalid")
      bytes.withUnsafeBytes { raw in values.append(contentsOf: raw.bindMemory(to: Float.self)) }
    }
    try require(reader.status == .completed, "PCM decoder failed")
    return values
  }
  static func measurement(_ url: URL, at: Double) async throws -> [String: Double] {
    let values = try await samples(url, at: at)
    let rms = values.isEmpty ? 0 : sqrt(values.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(values.count))
    var below = false, cycles = 0
    for sample in values { if sample < -0.02 { below = true }; if below && sample > 0.02 { cycles += 1; below = false } }
    let hz = values.isEmpty ? 0 : Double(cycles) * 48000 / Double(values.count)
    return ["rms": rms, "hz": hz, "samples": Double(values.count)]
  }
  // Zero crossings cannot distinguish the original from a second audible tone.
  // Measure each frequency independently in the PCM decoded from the final MP4.
  static func mixedMeasurement(_ url: URL, at: Double, speed: Double) async throws -> [String: Double] {
    let values = try await samples(url, at: at)
    try require(values.count >= 12000 && values.count <= 19200, "Mixed audio window is missing or truncated")
    func amplitude(_ hz: Double) -> Double {
      var real = 0.0, imaginary = 0.0
      for (index, sample) in values.enumerated() {
        let phase = 2 * Double.pi * hz * Double(index) / 48000
        real += Double(sample) * cos(phase); imaginary += Double(sample) * sin(phase)
      }
      return 2 * sqrt(real * real + imaginary * imaginary) / Double(values.count)
    }
    return ["at": at, "samples": Double(values.count), "original440Hz": amplitude(440), "music660Hz": amplitude(660),
      "shiftedOriginalHz": 440 * speed, "shiftedOriginalAmplitude": amplitude(440 * speed),
      "shiftedMusicHz": 660 * speed, "shiftedMusicAmplitude": amplitude(660 * speed),
      "beforeExcerpt1540Hz": amplitude(1540), "afterExcerpt1760Hz": amplitude(1760)]
  }
  static func trackCoverage(_ url: URL, mediaType: AVMediaType, expectedDuration: Double) async throws -> [String: Double] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: mediaType).first else { throw FixtureError.failed("Mixed export track is missing") }
    let reader = try AVAssetReader(asset: asset), output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    try require(reader.canAdd(output), "Mixed export track reader is unavailable"); reader.add(output)
    try require(reader.startReading(), "Mixed export track reader did not start")
    var count = 0, first = Double.infinity, end = 0.0
    while let sample = output.copyNextSampleBuffer() {
      let start = CMSampleBufferGetPresentationTimeStamp(sample).seconds, duration = CMSampleBufferGetDuration(sample).seconds
      try require(start.isFinite && duration.isFinite && duration > 0, "Mixed export has invalid sample timing")
      first = min(first, start); end = max(end, start + duration); count += 1
    }
    try require(reader.status == .completed && count > 0, "Mixed export track could not be read completely")
    try require(abs(first) < 0.12 && abs(end - expectedDuration) < 0.12, "Mixed export has a missing start, truncated track or trailing audio/video")
    return ["sampleBuffers": Double(count), "firstPresentation": first, "end": end]
  }
  static func frame(_ url: URL, at: Double) throws {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url)); generator.appliesPreferredTrackTransform = true
    let image = try generator.copyCGImage(at: CMTime(seconds: at, preferredTimescale: 600), actualTime: nil)
    try require(image.width == width && image.height == height, "Encoded final video frame missing or wrong size")
  }
  static func recipe(end: Double, speed: Double = 1, start: Double = 0, volume: Double = 0) -> [String: Any] {
    ["width": Double(width), "height": Double(height), "trimStart": start, "trimEnd": end, "speed": speed, "volume": volume,
     "fit": "contain", "scale": 1.0, "x": 0.0, "y": 0.0, "matrix": StoryVideoPixels.identity]
  }
  static func request(_ name: String, input: URL, recipe: [String: Any], music: URL, loop: Bool, volume: Double = 0.5, kind: String = "video") -> [String: Any] {
    ["id": "audio-fixture-" + name, "inputUri": input.absoluteString, "inputKind": kind,
     "outputUri": cache.appendingPathComponent("pc-story-export-" + name + ".mp4").absoluteString,
     "recipe": recipe, "layers": [], "audio": ["uri": music.absoluteString, "start": 1.0, "duration": 1.0, "volume": volume, "loop": loop]]
  }
  static func output(_ request: [String: Any]) -> URL { URL(string: request["outputUri"] as! String)! }
  static func retain(_ url: URL) throws {
    let target = documents.appendingPathComponent("media", isDirectory: true)
    try files.createDirectory(at: target, withIntermediateDirectories: true)
    try files.copyItem(at: url, to: target.appendingPathComponent(url.lastPathComponent))
  }
  static func run() async throws {
    let silent = cache.appendingPathComponent("fixture-video.mp4"), original = cache.appendingPathComponent("fixture-original.wav"), source = cache.appendingPathComponent("fixture-source.mp4"), music = cache.appendingPathComponent("fixture-music.wav")
    try wave(original, seconds: 6) { 0.4 * sin($0 * 440 * .pi * 2) }
    try wave(music, seconds: 3) { $0 >= 1 && $0 < 2 ? 0.4 * sin($0 * 880 * .pi * 2) : 0 }
    try await video(silent, seconds: 6); try await withOriginalAudio(video: silent, audio: original, destination: source)

    let loop = request("loop", input: source, recipe: recipe(end: 5, speed: 2, start: 1), music: music, loop: true)
    let loopResult = try await StoryVideoComposition.make(loop), loopFile = output(loop)
    let early = try await measurement(loopFile, at: 0.3), late = try await measurement(loopFile, at: 1.3)
    try require(loopResult["soundtrackMixed"] as? Bool == true, "Soundtrack result was not verified")
    try require(early["rms"]! > 0.06 && late["rms"]! > 0.06, "Selected music excerpt failed to repeat")
    try require(abs(early["hz"]! - 880) < 40 && abs(late["hz"]! - 880) < 40, "Video speed incorrectly changed music pitch")
    try frame(loopFile, at: 1.8); try retain(loopFile)
    results.append(["name": "video trim and speed keep looping excerpt and music pitch", "early": early, "late": late, "duration": loopResult["duration"]!])

    let voice = request("voice", input: source, recipe: recipe(end: 6), music: music, loop: false)
    let voiceResult = try await StoryVideoComposition.make(voice), voiceFile = output(voice)
    let voiceEarly = try await measurement(voiceFile, at: 0.3), voiceLate = try await measurement(voiceFile, at: 1.8)
    try require(voiceEarly["rms"]! > 0.06 && voiceLate["rms"]! < 0.003, "Voiceover did not stop at its excerpt boundary")
    try frame(voiceFile, at: 5.0); try retain(voiceFile)
    results.append(["name": "voiceover stops while the remaining video stays present", "early": voiceEarly, "afterBoundary": voiceLate, "duration": voiceResult["duration"]!])

    let mixed = request("original", input: source, recipe: recipe(end: 3, volume: 0.25), music: music, loop: true, volume: 0)
    _ = try await StoryVideoComposition.make(mixed)
    let originalResult = try await measurement(output(mixed), at: 0.3)
    try require(originalResult["rms"]! > 0.045 && originalResult["rms"]! < 0.1 && abs(originalResult["hz"]! - 440) < 40, "Original and added audio volume controls were not preserved")
    try retain(output(mixed)); results.append(["name": "original mix level and muted soundtrack are preserved", "audio": originalResult])

    // Distinct tones before/inside/after the excerpt expose wrong selection,
    // shifted original pitch, shifted added music and a missing final repeat.
    let speedMusic = cache.appendingPathComponent("fixture-speed-music.wav")
    try wave(speedMusic, seconds: 3) { time in
      let hz = time < 1 ? 1540.0 : time < 2 ? 660.0 : 1760.0
      return 0.4 * sin(time * hz * .pi * 2)
    }
    let speedCases: [(id: String, name: String, speed: Double, start: Double, end: Double)] = [
      ("mixed-speed-2x", "2x original pitch and independent looping music stay in sync", 2, 0.5, 5),
      ("mixed-speed-0.5x", "0.5x original pitch and independent looping music stay in sync", 0.5, 1.25, 3)
    ]
    for test in speedCases {
      let expectedDuration = (test.end - test.start) / test.speed
      let selected = request(test.id, input: source, recipe: recipe(end: test.end, speed: test.speed, start: test.start, volume: 0.25), music: speedMusic, loop: true)
      let result = try await StoryVideoComposition.make(selected), file = output(selected)
      guard let reportedDuration = result["duration"] as? Double else { throw FixtureError.failed("Mixed export duration is absent") }
      try require(result["soundtrackMixed"] as? Bool == true && abs(reportedDuration - expectedDuration) < 0.12, "Mixed export returned an incorrect duration or no soundtrack")
      var windows: [[String: Double]] = []
      for time in [0.3, 1.3, expectedDuration - 0.35] {
        let measured = try await mixedMeasurement(file, at: time, speed: test.speed)
        try require(measured["original440Hz"]! > 0.05 && measured["original440Hz"]! < 0.15, "Original pitch or quarter-gain level changed at \(test.speed)x / \(time)s: \(measured)")
        try require(measured["music660Hz"]! > 0.13 && measured["music660Hz"]! < 0.27, "Independent music pitch, half-gain level or final loop failed at \(test.speed)x / \(time)s: \(measured)")
        try require(measured["shiftedOriginalAmplitude"]! < 0.02 && measured["shiftedMusicAmplitude"]! < 0.02, "A mixed track changed pitch with video speed: \(measured)")
        try require(measured["beforeExcerpt1540Hz"]! < 0.02 && measured["afterExcerpt1760Hz"]! < 0.02, "Audio outside the selected music excerpt leaked into the mix: \(measured)")
        windows.append(measured)
      }
      let videoCoverage = try await trackCoverage(file, mediaType: .video, expectedDuration: expectedDuration)
      let audioCoverage = try await trackCoverage(file, mediaType: .audio, expectedDuration: expectedDuration)
      try frame(file, at: expectedDuration - 0.15); try retain(file)
      results.append(["name": test.name, "speed": test.speed, "duration": reportedDuration, "expectedDuration": expectedDuration,
        "windows": windows, "video": videoCoverage, "audio": audioCoverage])
    }

    let image = cache.appendingPathComponent("fixture-image.png")
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: CGFloat(width), height: CGFloat(height)))
    let png = renderer.pngData { context in UIColor(red: 0.1, green: 0.35, blue: 0.75, alpha: 1).setFill(); context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))) }
    try png.write(to: image)
    let still = request("still", input: image, recipe: recipe(end: 2), music: music, loop: true, kind: "image")
    _ = try await StoryVideoComposition.make(still)
    let stillAudio = try await measurement(output(still), at: 1.3)
    try require(stillAudio["rms"]! > 0.06, "Photo/text movie lost its music")
    try frame(output(still), at: 1.8); try retain(output(still)); results.append(["name": "photo or text artwork becomes a movie with actual audio", "audio": stillAudio])

    var invalid = request("invalid", input: source, recipe: recipe(end: 3), music: music, loop: true)
    invalid["audio"] = ["uri": music.absoluteString, "start": 2.5, "duration": 1.0, "volume": 0.5, "loop": true]
    do { _ = try await StoryVideoComposition.make(invalid); throw FixtureError.failed("Invalid excerpt was accepted") }
    catch let error as FixtureError { throw error }
    catch { try require(!files.fileExists(atPath: output(invalid).path), "Failed export retained a partial movie") }
    results.append(["name": "invalid audio range is rejected and partial output removed"])

    let before = Set(try files.contentsOfDirectory(atPath: cache.path))
    let cancellation = request("cancel", input: image, recipe: recipe(end: 30), music: music, loop: true, kind: "image")
    let work = Task { try await StoryVideoComposition.make(cancellation) }
    try await Task.sleep(nanoseconds: 20_000_000)
    StoryVideoComposition.cancel(cancellation["id"] as! String)
    do { _ = try await work.value; throw FixtureError.failed("Cancelled export unexpectedly completed") }
    catch let error as FixtureError { throw error }
    catch { try require(!files.fileExists(atPath: output(cancellation).path), "Cancelled export retained its output") }
    let after = Set(try files.contentsOfDirectory(atPath: cache.path))
    try require(after.subtracting(before).filter { $0.hasPrefix("pc-story-export-") }.isEmpty, "Cancelled still export retained its temporary movie")
    results.append(["name": "cancellation stops the native writer and removes temporary movies"])
  }
  static func finish(error: Error?) {
    let receipt: [String: Any] = ["passed": error == nil, "cases": results, "error": error?.localizedDescription as Any? ?? NSNull(), "physicalDevice": false, "photosWritten": false, "networkUsed": false]
    do {
      try files.createDirectory(at: documents, withIntermediateDirectories: true)
      try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: documents.appendingPathComponent("story-audio-receipt.json"), options: .atomic)
    } catch { print("Could not save native audio fixture receipt: \(error)"); exit(2) }
    print(error == nil ? "STORY_AUDIO_EXPORT_PASSED \(results.count)" : "STORY_AUDIO_EXPORT_FAILED \(error!.localizedDescription)")
    exit(error == nil ? 0 : 1)
  }
}

@MainActor
private final class StoryAudioHarnessDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds); window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
    Task { do { try await StoryAudioFixture.run(); StoryAudioFixture.finish(error: nil) } catch { StoryAudioFixture.finish(error: error) } }
    return true
  }
}

@main
private struct StoryAudioHarnessMain {
  @MainActor static func main() { UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(StoryAudioHarnessDelegate.self)) }
}
