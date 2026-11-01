import UIKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreImage

private enum ReactFixtureError: Error, LocalizedError {
  case failed(String)
  var errorDescription: String? { if case .failed(let value) = self { return value }; return nil }
}
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw ReactFixtureError.failed(message) }
}

@MainActor
private enum ReactFixture {
  static let files = FileManager.default
  static var cache: URL { files.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
  static var documents: URL { files.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  static var results: [[String: Any]] = []
  static func time(_ value: Double) -> CMTime { CMTime(seconds: value, preferredTimescale: 60000) }

  static func wave(_ url: URL, seconds: Int, hz: Double) throws {
    let rate = 48000, count = seconds * rate
    var data = Data()
    func word<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    data.append(contentsOf: "RIFF".utf8); word(UInt32(36 + count * 2)); data.append(contentsOf: "WAVEfmt ".utf8)
    word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(rate)); word(UInt32(rate * 2)); word(UInt16(2)); word(UInt16(16))
    data.append(contentsOf: "data".utf8); word(UInt32(count * 2))
    for index in 0..<count { word(Int16(0.4 * sin(Double(index) / Double(rate) * hz * 2 * .pi) * 32767)) }
    try data.write(to: url)
  }
  static func movie(_ url: URL, seconds: Int, camera: Bool) async throws {
    let width = 360, height = 640
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = false
    let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width,
      kCVPixelBufferHeightKey as String: height, kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
    try require(writer.canAdd(input), "Fixture encoder is unavailable"); writer.add(input)
    try require(writer.startWriting(), "Fixture encoder did not start"); writer.startSession(atSourceTime: .zero)
    let colors: [[UInt8]] = [[225, 35, 45], [30, 210, 55], [35, 55, 225], [225, 195, 30]]
    for index in 0..<(seconds * 30) {
      while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 3_000_000) }
      guard let pool = adaptor.pixelBufferPool else { throw ReactFixtureError.failed("Fixture pixel pool missing") }
      var pixel: CVPixelBuffer?
      try require(CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixel) == kCVReturnSuccess, "Fixture pixel allocation failed")
      guard let pixel else { throw ReactFixtureError.failed("Fixture frame missing") }
      let seconds = Double(index) / 30
      let color: [UInt8] = camera ? [UInt8(60 + 15 * seconds), 120, UInt8(210 - 10 * seconds)] : colors[min(3, Int(seconds))]
      CVPixelBufferLockBaseAddress(pixel, [])
      guard let address = CVPixelBufferGetBaseAddress(pixel) else { throw ReactFixtureError.failed("Fixture pixel bytes missing") }
      let stride = CVPixelBufferGetBytesPerRow(pixel), bytes = address.assumingMemoryBound(to: UInt8.self)
      for y in 0..<height { for x in 0..<width {
        let offset = y * stride + x * 4
        let movingMarker = camera && y > 60 && y < 110 && x > Int(120 + sin(seconds * 2) * 70) && x < Int(170 + sin(seconds * 2) * 70)
        bytes[offset] = movingMarker ? 245 : color[2]; bytes[offset + 1] = movingMarker ? 245 : color[1]; bytes[offset + 2] = movingMarker ? 245 : color[0]; bytes[offset + 3] = 255
      } }
      CVPixelBufferUnlockBaseAddress(pixel, [])
      try require(adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(index), timescale: 30)), "Fixture frame could not be encoded")
    }
    input.markAsFinished(); writer.endSession(atSourceTime: time(Double(seconds)))
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in writer.finishWriting { continuation.resume() } }
    try require(writer.status == .completed, "Fixture encoder failed")
  }
  static func addAudio(_ video: URL, _ audio: URL, to destination: URL) async throws {
    let asset = AVURLAsset(url: video), sound = AVURLAsset(url: audio), composition = AVMutableComposition()
    let range = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
    guard let picture = try await asset.loadTracks(withMediaType: .video).first, let voice = try await sound.loadTracks(withMediaType: .audio).first,
      let v = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let a = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw ReactFixtureError.failed("Fixture tracks missing") }
    try v.insertTimeRange(range, of: picture, at: .zero); try a.insertTimeRange(range, of: voice, at: .zero)
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw ReactFixtureError.failed("Fixture muxer unavailable") }
    export.outputURL = destination; export.outputFileType = .mp4
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
    try require(export.status == .completed, "Fixture mux failed")
  }
  static func picture(_ name: String, artwork: Bool = false) throws -> URL {
    let url = cache.appendingPathComponent(name + ".png"), format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = !artwork
    let data = UIGraphicsImageRenderer(size: CGSize(width: 720, height: 1280), format: format).pngData { context in
      if artwork { UIColor.green.setFill(); context.fill(CGRect(x: 40, y: 50, width: 80, height: 80)) }
      else { UIColor(red: 0.88, green: 0.14, blue: 0.18, alpha: 1).setFill(); context.fill(CGRect(x: 0, y: 0, width: 720, height: 1280)) }
    }
    try data.write(to: url); return url
  }
  static func segment(_ start: Double, _ end: Double, source: Double, playing: Bool, volume: Double = 0.6) -> [String: Any] {
    ["start": start, "end": end, "sourceStart": source, "playing": playing, "volume": playing ? volume : 0.0]
  }
  static func request(_ name: String, source: URL, camera: URL, segments: [[String: Any]], duration: Double, kind: String = "video", cameraStart: Double = 0) -> [String: Any] {
    ["id": "react-fixture-" + name, "sourceUri": source.absoluteString, "sourceKind": kind, "cameraUri": camera.absoluteString,
      "outputUri": cache.appendingPathComponent("pc-react-export-" + name + ".mp4").absoluteString, "width": 720, "height": 1280, "cameraStart": cameraStart, "duration": duration,
      "segments": segments, "sourceRect": ["x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0], "faceRect": ["x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0],
      "voiceVolume": 0.5, "sourceZoom": 1.0, "cutout": false]
  }
  static func output(_ request: [String: Any]) -> URL { URL(string: request["outputUri"] as! String)! }
  static func retain(_ url: URL) throws {
    let directory = documents.appendingPathComponent("media", isDirectory: true)
    try files.createDirectory(at: directory, withIntermediateDirectories: true)
    try files.copyItem(at: url, to: directory.appendingPathComponent(url.lastPathComponent))
  }
  static func pixel(_ url: URL, at: Double, x: Int, y: Int) throws -> [Int] {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url)); generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = time(1 / 60); generator.requestedTimeToleranceAfter = time(1 / 60)
    let image = try generator.copyCGImage(at: time(at), actualTime: nil)
    try require(image.width == 720 && image.height == 1280, "Decoded reaction has the wrong canvas")
    var bytes = [UInt8](repeating: 0, count: 4)
    bytes.withUnsafeMutableBytes { data in StoryVideoPixels.context.render(CIImage(cgImage: image), toBitmap: data.baseAddress!, rowBytes: 4,
      bounds: CGRect(x: CGFloat(x), y: CGFloat(1280 - y - 1), width: 1, height: 1), format: .RGBA8, colorSpace: StoryVideoPixels.colorSpace) }
    return Array(bytes.prefix(3)).map(Int.init)
  }
  static func distance(_ a: [Int], _ b: [Int]) -> Int { zip(a, b).reduce(0) { $0 + abs($1.0 - $1.1) } }
  static func audio(_ url: URL, at: Double) async throws -> [String: Double] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw ReactFixtureError.failed("Reaction audio missing") }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: time(at), duration: time(0.3))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false])
    try require(reader.canAdd(output), "Reaction PCM reader unavailable"); reader.add(output); try require(reader.startReading(), "Reaction PCM decoder did not start")
    var values: [Float] = []
    while let sample = output.copyNextSampleBuffer() {
      guard let block = CMSampleBufferGetDataBuffer(sample) else { throw ReactFixtureError.failed("Reaction PCM bytes missing") }
      let count = CMBlockBufferGetDataLength(block); var data = Data(count: count)
      let status = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count, destination: $0.baseAddress!) }
      try require(status == kCMBlockBufferNoErr && count % 4 == 0, "Reaction PCM bytes invalid")
      data.withUnsafeBytes { values.append(contentsOf: $0.bindMemory(to: Float.self)) }
    }
    try require(reader.status == .completed && values.count > 12000, "Reaction audio window is missing or truncated")
    func amplitude(_ hz: Double) -> Double {
      var real = 0.0, imaginary = 0.0
      for (index, value) in values.enumerated() { let phase = 2 * Double.pi * hz * Double(index) / 48000; real += Double(value) * cos(phase); imaginary += Double(value) * sin(phase) }
      return 2 * sqrt(real * real + imaginary * imaginary) / Double(values.count)
    }
    return ["at": at, "samples": Double(values.count), "source440Hz": amplitude(440), "microphone880Hz": amplitude(880)]
  }
  static func coverage(_ url: URL, type: AVMediaType, duration: Double) async throws -> [String: Double] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: type).first else { throw ReactFixtureError.failed("Reaction output track missing") }
    let settings: [String: Any] = type == .video ? [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      : [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false]
    let reader = try AVAssetReader(asset: asset), output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    try require(reader.canAdd(output), "Reaction track decoder unavailable"); reader.add(output); try require(reader.startReading(), "Reaction track decoder did not start")
    var first = Double.infinity, end = 0.0, count = 0, previous: Double?
    while let sample = output.copyNextSampleBuffer() {
      let start = CMSampleBufferGetPresentationTimeStamp(sample).seconds; try require(start.isFinite, "Reaction frame timestamp invalid")
      first = min(first, start); count += 1
      if type == .video {
        guard let pixels = CMSampleBufferGetImageBuffer(sample) else { throw ReactFixtureError.failed("Reaction output frame empty") }
        try require(CVPixelBufferGetWidth(pixels) == 720 && CVPixelBufferGetHeight(pixels) == 1280, "Reaction output frame has wrong size")
        if let previous { try require(abs(start - previous - 1 / 30) < 0.01, "Reaction camera freezes or skips output frames") }
        previous = start; end = max(end, start + 1 / 30)
      } else {
        guard let format = CMSampleBufferGetFormatDescription(sample), let stream = CMAudioFormatDescriptionGetStreamBasicDescription(format), let block = CMSampleBufferGetDataBuffer(sample) else { throw ReactFixtureError.failed("Reaction PCM format missing") }
        let frames = CMSampleBufferGetNumSamples(sample), rate = stream.pointee.mSampleRate
        try require(frames > 0 && rate > 0 && CMBlockBufferGetDataLength(block) >= frames * Int(stream.pointee.mBytesPerFrame), "Reaction microphone PCM truncated")
        end = max(end, start + Double(frames) / rate)
      }
    }
    try require(reader.status == .completed && count > 0 && abs(first) < 0.12 && abs(end - duration) < 0.12, "Reaction output does not cover the entire camera/microphone take")
    if type == .video { try require(abs(Double(count) - duration * 30) <= 2, "Reaction frame count differs from the take") }
    return ["samples": Double(count), "start": first, "end": end]
  }
  static func rejected(_ request: [String: Any]) async throws {
    let before = Set(try files.contentsOfDirectory(atPath: cache.path))
    do { _ = try await ReactVideoComposition.make(request); throw ReactFixtureError.failed("Invalid React request was accepted") }
    catch let error as ReactFixtureError { throw error }
    catch { try require(!files.fileExists(atPath: output(request).path), "Invalid React request left an output file") }
    let after = Set(try files.contentsOfDirectory(atPath: cache.path))
    try require(after.subtracting(before).filter { $0.hasPrefix("pc-react-") }.isEmpty, "Rejected React request leaked temporary media")
  }

  static func run() async throws {
    let sourceSilent = cache.appendingPathComponent("fixture-source-silent.mp4"), cameraSilent = cache.appendingPathComponent("fixture-camera-silent.mp4")
    let sourceAudio = cache.appendingPathComponent("fixture-source.wav"), microphone = cache.appendingPathComponent("fixture-microphone.wav")
    let source = cache.appendingPathComponent("fixture-source.mp4"), camera = cache.appendingPathComponent("fixture-camera.mp4")
    try wave(sourceAudio, seconds: 4, hz: 440); try wave(microphone, seconds: 8, hz: 880)
    try await movie(sourceSilent, seconds: 4, camera: false); try await movie(cameraSilent, seconds: 8, camera: true)
    try await addAudio(sourceSilent, sourceAudio, to: source); try await addAudio(cameraSilent, microphone, to: camera)
    let segments = [segment(0, 1, source: 0, playing: true), segment(1, 3, source: 1.4, playing: false), segment(3, 5, source: 1, playing: true), segment(5, 7, source: 0, playing: true, volume: 0.25), segment(7, 8, source: 3.2, playing: false)]
    let timed = request("pause-replay", source: source, camera: camera, segments: segments, duration: 8)
    let result = try await ReactVideoComposition.make(timed), movie = output(timed); try retain(movie)
    let red = try pixel(movie, at: 0.3, x: 180, y: 640), heldFirst = try pixel(movie, at: 1.4, x: 180, y: 640), heldLast = try pixel(movie, at: 2.4, x: 180, y: 640)
    let resumed = try pixel(movie, at: 4.4, x: 180, y: 640), replay = try pixel(movie, at: 5.4, x: 180, y: 640), lastHold = try pixel(movie, at: 7.4, x: 180, y: 640)
    let faceFirst = try pixel(movie, at: 1.4, x: 540, y: 640), faceLast = try pixel(movie, at: 2.4, x: 540, y: 640)
    try require(red[0] > 180 && red[1] < 80 && red[2] < 90, "Original did not begin on its red frame")
    try require(heldFirst[1] > 170 && heldFirst[0] < 90 && distance(heldFirst, heldLast) < 12, "Source pause did not become a green freeze frame")
    try require(distance(faceFirst, faceLast) > 15, "The camera stopped moving during the source hold")
    try require(resumed[2] > 180 && resumed[0] < 90 && replay[0] > 180 && replay[1] < 80, "Source resume/replay timing was lost")
    try require(lastHold[0] > 180 && lastHold[1] > 160 && lastHold[2] < 90, "Final source hold was not preserved")
    var windows: [[String: Double]] = []
    for at in [0.3, 1.4, 2.4, 3.4, 5.4, 7.4] {
      let sound = try await audio(movie, at: at); windows.append(sound)
      try require(sound["microphone880Hz"]! > 0.13 && sound["microphone880Hz"]! < 0.28, "The microphone disappeared or changed gain during source control: \(sound)")
      if at >= 1 && at < 3 || at >= 7 { try require(sound["source440Hz"]! < 0.015, "Source audio leaked into a freeze frame: \(sound)") }
      else if at >= 5 { try require(sound["source440Hz"]! > 0.06 && sound["source440Hz"]! < 0.15, "Replay source gain is wrong: \(sound)") }
      else { try require(sound["source440Hz"]! > 0.16 && sound["source440Hz"]! < 0.32, "Playing source audio was not mixed: \(sound)") }
    }
    let videoCoverage = try await coverage(movie, type: .video, duration: 8), audioCoverage = try await coverage(movie, type: .audio, duration: 8)
    results.append(["name": "source pauses and replays preserve moving face and continuous microphone", "reported": result, "sourcePixels": [red, heldFirst, heldLast, resumed, replay, lastHold], "facePixels": [faceFirst, faceLast], "audioWindows": windows, "videoCoverage": videoCoverage, "audioCoverage": audioCoverage])

    let photo = try picture("photo"), overlay = try picture("artwork", artwork: true)
    var still = request("photo-pip", source: photo, camera: camera, segments: [segment(0, 3, source: 0, playing: false)], duration: 3, kind: "image", cameraStart: 2)
    still["sourceRect"] = ["x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0]
    still["faceRect"] = ["x": 0.6, "y": 0.56, "width": 0.32, "height": 0.38]
    still["overlayUri"] = overlay.absoluteString; still["voiceVolume"] = 0.35
    _ = try await ReactVideoComposition.make(still); let stillMovie = output(still); try retain(stillMovie)
    let originalPixel = try pixel(stillMovie, at: 0.5, x: 150, y: 400), marker = try pixel(stillMovie, at: 0.5, x: 80, y: 90), pipFirst = try pixel(stillMovie, at: 0.4, x: 550, y: 950), pipLast = try pixel(stillMovie, at: 2.4, x: 550, y: 950)
    try require(originalPixel[0] > 180 && originalPixel[1] < 80 && marker[1] > 210 && marker[0] < 40, "Photo or annotation placement was not exported")
    try require(distance(pipFirst, pipLast) > 30, "PiP camera was replaced by a still image")
    let stillAudio = try await audio(stillMovie, at: 1.2)
    try require(stillAudio["source440Hz"]! < 0.015 && stillAudio["microphone880Hz"]! > 0.09 && stillAudio["microphone880Hz"]! < 0.2, "Photo reaction microphone mix is wrong")
    let stillVideoCoverage = try await coverage(stillMovie, type: .video, duration: 3), stillAudioCoverage = try await coverage(stillMovie, type: .audio, duration: 3)
    results.append(["name": "photo source keeps movable PiP voice and burned artwork in one video", "pixels": [originalPixel, marker, pipFirst, pipLast], "audio": stillAudio, "videoCoverage": stillVideoCoverage, "audioCoverage": stillAudioCoverage])

    let trimmed = request("trim-hold", source: source, camera: camera, segments: [segment(0, 1.5, source: 1.4, playing: false), segment(1.5, 3.5, source: 1, playing: true), segment(3.5, 4, source: 0, playing: true, volume: 0.25)], duration: 4, cameraStart: 1.5)
    _ = try await ReactVideoComposition.make(trimmed); let trimmedMovie = output(trimmed); try retain(trimmedMovie)
    let trimHold = try pixel(trimmedMovie, at: 0.4, x: 180, y: 640), trimPlay = try pixel(trimmedMovie, at: 2.8, x: 180, y: 640), trimFace = try pixel(trimmedMovie, at: 0.4, x: 540, y: 640), originalFace = try pixel(movie, at: 1.9, x: 540, y: 640)
    try require(trimHold[1] > 170 && trimPlay[2] > 180 && distance(trimFace, originalFace) < 15, "Trimming inside a hold shifted face/source alignment")
    let trimEarly = try await audio(trimmedMovie, at: 0.4), trimLate = try await audio(trimmedMovie, at: 2)
    try require(trimEarly["source440Hz"]! < 0.015 && trimLate["source440Hz"]! > 0.16 && trimEarly["microphone880Hz"]! > 0.13, "Trimmed freeze audio is incorrect")
    let trimVideoCoverage = try await coverage(trimmedMovie, type: .video, duration: 4), trimAudioCoverage = try await coverage(trimmedMovie, type: .audio, duration: 4)
    results.append(["name": "trimming inside a freeze keeps face source and voice aligned", "pixels": [trimHold, trimPlay, trimFace, originalFace], "audio": [trimEarly, trimLate], "videoCoverage": trimVideoCoverage, "audioCoverage": trimAudioCoverage])

    var gap = request("invalid-gap", source: source, camera: camera, segments: [segment(0, 1, source: 0, playing: true), segment(1.2, 3, source: 1, playing: true)], duration: 3)
    try await rejected(gap)
    gap["id"] = "react-fixture-hold-sound"; gap["segments"] = [["start": 0.0, "end": 3.0, "sourceStart": 1.0, "playing": false, "volume": 0.4]]; try await rejected(gap)
    var outside = request("invalid-source-range", source: source, camera: camera, segments: [segment(0, 2, source: 3.5, playing: true)], duration: 2); try await rejected(outside)
    outside["outputUri"] = "file:///tmp/pc-react-export-outside.mp4"; try await rejected(outside)
    var noVoice = request("invalid-mic", source: source, camera: cameraSilent, segments: [segment(0, 2, source: 0, playing: true)], duration: 2); try await rejected(noVoice)
    noVoice["voiceVolume"] = -1.0; try await rejected(noVoice)
    results.append(["name": "invalid timelines missing microphone and foreign paths leave no files"])

    let before = Set(try files.contentsOfDirectory(atPath: cache.path))
    let cancelled = request("cancel", source: source, camera: camera, segments: segments, duration: 8)
    let work = Task { try await ReactVideoComposition.make(cancelled) }
    try await Task.sleep(nanoseconds: 10_000_000)
    ReactVideoComposition.cancel(cancelled["id"] as! String)
    do { _ = try await work.value; throw ReactFixtureError.failed("Cancelled React export completed") }
    catch let error as ReactFixtureError { throw error }
    catch { try require(!files.fileExists(atPath: output(cancelled).path), "Cancelled reaction retained output") }
    let after = Set(try files.contentsOfDirectory(atPath: cache.path))
    try require(after.subtracting(before).filter { $0.hasPrefix("pc-react-") }.isEmpty, "Reaction cancellation left freeze images or partial MP4")
    var retry = request("retry", source: source, camera: camera, segments: [segment(0, 1, source: 1.4, playing: false)], duration: 1)
    retry["id"] = cancelled["id"]; _ = try await ReactVideoComposition.make(retry); try retain(output(retry))
    let heldOnlyPixel = try pixel(output(retry), at: 0.4, x: 180, y: 640), heldOnlyAudio = try await audio(output(retry), at: 0.3)
    try require(heldOnlyPixel[1] > 170 && heldOnlyAudio["source440Hz"]! < 0.015 && heldOnlyAudio["microphone880Hz"]! > 0.13, "A source held for the entire take did not export correctly")
    results.append(["name": "cancellation removes partial exports and allows same identifier retry", "heldOnlyPixel": heldOnlyPixel, "heldOnlyAudio": heldOnlyAudio])
  }
  static func finish(error: Error?) {
    let receipt: [String: Any] = ["passed": error == nil, "cases": results, "error": error?.localizedDescription as Any? ?? NSNull(),
      "physicalDevice": false, "personMatteQualityVerified": false, "photosWritten": false, "networkUsed": false]
    do {
      try files.createDirectory(at: documents, withIntermediateDirectories: true)
      try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys]).write(to: documents.appendingPathComponent("react-video-receipt.json"), options: .atomic)
    } catch { print("React receipt could not be written: \(error)"); exit(2) }
    print(error == nil ? "REACT_VIDEO_EXPORT_PASSED \(results.count)" : "REACT_VIDEO_EXPORT_FAILED \(error!.localizedDescription)")
    exit(error == nil ? 0 : 1)
  }
}
@MainActor
private final class ReactHarnessDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds); window?.rootViewController = UIViewController(); window?.makeKeyAndVisible()
    Task { do { try await ReactFixture.run(); ReactFixture.finish(error: nil) } catch { ReactFixture.finish(error: error) } }; return true
  }
}
@main
private struct ReactHarnessMain {
  @MainActor static func main() { UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(ReactHarnessDelegate.self)) }
}
