import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import UIKit

enum StoryVideoError: Error, LocalizedError {
  case invalid(String)
  var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

/// One sRGB matrix is shared by Skia photos, SVG video previews and this renderer.
enum StoryVideoPixels {
  static let identity: [Double] = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0]
  static let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  static let context = CIContext(options: [.workingColorSpace: colorSpace, .outputColorSpace: colorSpace, .cacheIntermediates: false])
  static func matrix(_ image: CIImage, _ values: [Double]) -> CIImage {
    guard values.count == 20, values.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { return image }
    func vector(_ offset: Int) -> CIVector { CIVector(x: CGFloat(values[offset]), y: CGFloat(values[offset+1]), z: CGFloat(values[offset+2]), w: CGFloat(values[offset+3])) }
    return image.applyingFilter("CIColorMatrix", parameters: ["inputRVector": vector(0), "inputGVector": vector(5), "inputBVector": vector(10), "inputAVector": vector(15), "inputBiasVector": CIVector(x: CGFloat(values[4]), y: CGFloat(values[9]), z: CGFloat(values[14]), w: CGFloat(values[19]))])
  }
}

private struct StoryExportLayer { let image: CIImage; let start: Double; let end: Double }

/// Writes a real MP4. No source file is overwritten; partial outputs are removed.
enum StoryVideoComposition {
  private struct Job { var session: AVAssetExportSession?; var asset: AVAsset?; var writer: AVAssetWriter?; var cancelled = false }
  private static let lock = NSLock()
  private static var jobs: [String: Job] = [:]
  static func cancel(_ id: String) { lock.lock(); jobs[id]?.cancelled = true; let session = jobs[id]?.session, asset = jobs[id]?.asset, writer = jobs[id]?.writer; lock.unlock(); asset?.cancelLoading(); if let writer, writer.status == .writing { writer.cancelWriting() }; session?.cancelExport() }
  private static func begin(_ id: String) throws { lock.lock(); defer { lock.unlock() }; guard jobs[id] == nil, jobs.isEmpty else { throw StoryVideoError.invalid("Another video is still exporting.") }; jobs[id] = Job() }
  private static func attach(_ id: String, _ session: AVAssetExportSession) throws { lock.lock(); defer { lock.unlock() }; guard var job = jobs[id], !job.cancelled else { throw StoryVideoError.invalid("Video export was cancelled.") }; job.session = session; jobs[id] = job }
  private static func attachAsset(_ id: String, _ asset: AVAsset) throws { lock.lock(); defer { lock.unlock() }; guard var job = jobs[id], !job.cancelled else { throw StoryVideoError.invalid("Video export was cancelled.") }; job.asset = asset; jobs[id] = job }
  private static func attachWriter(_ id: String, _ writer: AVAssetWriter) throws { lock.lock(); defer { lock.unlock() }; guard var job = jobs[id], !job.cancelled else { throw StoryVideoError.invalid("Video export was cancelled.") }; job.writer = writer; jobs[id] = job }
  private static func detachWriter(_ id: String, _ writer: AVAssetWriter) { lock.lock(); defer { lock.unlock() }; if jobs[id]?.writer === writer { jobs[id]?.writer = nil } }
  private static func check(_ id: String) throws { lock.lock(); defer { lock.unlock() }; guard let job = jobs[id], !job.cancelled else { throw StoryVideoError.invalid("Video export was cancelled.") } }
  private static func finish(_ id: String) { lock.lock(); jobs.removeValue(forKey: id); lock.unlock() }

  private static func local(_ raw: String, output: Bool = false) throws -> URL {
    let url = raw.hasPrefix("/") ? URL(fileURLWithPath: raw) : URL(string: raw)
    guard let url, url.isFileURL else { throw StoryVideoError.invalid("Export requires local media files.") }
    let file = url.standardizedFileURL.resolvingSymlinksInPath()
    let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
    guard file.path.hasPrefix(home) || file.path.hasPrefix(URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().path + "/") else { throw StoryVideoError.invalid("The export file is outside this app.") }
    if output {
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/"
      guard file.path.hasPrefix(cache), file.lastPathComponent.hasPrefix("pc-story-export-"), file.pathExtension == "mp4", !FileManager.default.fileExists(atPath: file.path) else { throw StoryVideoError.invalid("Choose a new export file in the app cache.") }
    } else if !FileManager.default.fileExists(atPath: file.path) { throw StoryVideoError.invalid("An export source file is missing.") }
    return file
  }

  private static func stillVideo(_ id: String, imageURL: URL, destination: URL, width: Int, height: Int, duration: Double) async throws {
    guard duration.isFinite, duration >= 1, duration <= 30,
          let source = CIImage(contentsOf: imageURL, options: [.applyOrientationProperty: true]),
          source.extent.width > 0, source.extent.height > 0, source.extent.width <= 2200, source.extent.height <= 4000 else { throw StoryVideoError.invalid("The story image could not be prepared as a movie.") }
    let writer = try AVAssetWriter(outputURL: destination, fileType: .mp4)
    defer { detachWriter(id, writer); if writer.status == .writing { writer.cancelWriting() } }
    try attachWriter(id, writer)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = false
    let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
    guard writer.canAdd(input) else { throw StoryVideoError.invalid("The story movie encoder is unavailable.") }
    writer.add(input)
    try check(id)
    guard writer.startWriting() else { throw writer.error ?? StoryVideoError.invalid("The story movie could not start.") }
    writer.startSession(atSourceTime: .zero)
    var buffer: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer) == kCVReturnSuccess, let buffer else { throw StoryVideoError.invalid("The story movie frame could not be allocated.") }
    let bounds = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
    let frame = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
      .transformed(by: CGAffineTransform(scaleX: bounds.width/source.extent.width, y: bounds.height/source.extent.height))
      .composited(over: CIImage(color: .black).cropped(to: bounds))
    StoryVideoPixels.context.render(frame, to: buffer, bounds: bounds, colorSpace: StoryVideoPixels.colorSpace)
    for index in 0..<Int(ceil(duration * 30)) {
      try check(id)
      while !input.isReadyForMoreMediaData {
        try check(id)
        if writer.status == .failed { throw writer.error ?? StoryVideoError.invalid("The story movie stopped encoding.") }
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: 30)) else { throw writer.error ?? StoryVideoError.invalid("A story movie frame could not be written.") }
    }
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(seconds: duration, preferredTimescale: 600))
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in writer.finishWriting { continuation.resume() } }
    try check(id)
    guard writer.status == .completed else { throw writer.error ?? StoryVideoError.invalid("The story movie could not finish.") }
  }

  static func make(_ request: [String: Any]) async throws -> [String: Any] {
    guard let id = request["id"] as? String, id.count >= 8, id.count <= 120,
          let input = request["inputUri"] as? String, let output = request["outputUri"] as? String,
          let recipe = request["recipe"] as? [String: Any] else { throw StoryVideoError.invalid("The export request is incomplete.") }
    var source = try local(input)
    let destination = try local(output, output: true)
    try begin(id)
    var completed = false, stillSource: URL?
    let timeout = DispatchWorkItem { cancel(id) }
    DispatchQueue.global().asyncAfter(deadline: .now() + 180, execute: timeout)
    let backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in cancel(id) }
    defer { timeout.cancel(); NotificationCenter.default.removeObserver(backgroundObserver); finish(id); if let stillSource { try? FileManager.default.removeItem(at: stillSource) }; if !completed { try? FileManager.default.removeItem(at: destination) } }
    func number(_ key: String, _ min: Double, _ max: Double) throws -> Double {
      guard let n = recipe[key] as? Double, n.isFinite, n >= min, n <= max else { throw StoryVideoError.invalid("The video \(key) is invalid.") }; return n
    }
    let width = try number("width", 2, 1080), height = try number("height", 2, 1920)
    let start = try number("trimStart", 0, 86400), end = try number("trimEnd", 0.1, 86400)
    let speed = try number("speed", 0.25, 4), volume = try number("volume", 0, 1)
    let scale = try number("scale", 0.35, 5), x = try number("x", -2, 2), y = try number("y", -2, 2)
    guard width.truncatingRemainder(dividingBy: 2) == 0, height.truncatingRemainder(dividingBy: 2) == 0,
          end > start, end-start <= 60.01, (end-start)/speed <= 120.01,
          let matrix = recipe["matrix"] as? [Double], matrix.count == 20, matrix.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { throw StoryVideoError.invalid("The export size, duration or grade is invalid.") }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    let fit = recipe["fit"] as? String == "cover"
    let inputKind = request["inputKind"] as? String ?? "video"
    guard inputKind == "video" || inputKind == "image" else { throw StoryVideoError.invalid("The story input type is invalid.") }
    if inputKind == "image" {
      guard start == 0, speed == 1, end >= 1, end <= 30 else { throw StoryVideoError.invalid("The story image movie duration is invalid.") }
      let temporary = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pc-story-export-\(UUID().uuidString)-still.mp4")
      stillSource = temporary
      try await stillVideo(id, imageURL: source, destination: temporary, width: Int(width), height: Int(height), duration: end)
      source = temporary
    }
    let asset = AVURLAsset(url: source)
    try attachAsset(id, asset)
    let duration = try await asset.load(.duration)
    guard duration.seconds.isFinite, end <= duration.seconds + 0.1,
          let video = try await asset.loadTracks(withMediaType: .video).first else { throw StoryVideoError.invalid("The selected video could not be read.") }
    let composition = AVMutableComposition()
    guard let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw StoryVideoError.invalid("The video track could not be created.") }
    let timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: min(end, duration.seconds)-start, preferredTimescale: 600))
    try track.insertTimeRange(timeRange, of: video, at: .zero)
    track.preferredTransform = try await video.load(.preferredTransform)
    let outputDuration = CMTimeMultiplyByFloat64(timeRange.duration, multiplier: 1/speed)
    let audioMix = AVMutableAudioMix()
    var audioParameters: [AVAudioMixInputParameters] = []
    if volume > 0, let audio = try await asset.loadTracks(withMediaType: .audio).first,
       let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
      // Intersect with the actual audio track; silent lead/trail remains silent.
      let audioRange = CMTimeRangeGetIntersection(timeRange, otherRange: try await audio.load(.timeRange))
      if !audioRange.isEmpty && audioRange.duration.seconds > 0 {
        let offset = CMTimeSubtract(audioRange.start, timeRange.start)
        try audioTrack.insertTimeRange(audioRange, of: audio, at: offset)
        let params = AVMutableAudioMixInputParameters(track: audioTrack)
        params.setVolume(Float(volume), at: .zero)
        params.audioTimePitchAlgorithm = .spectral
        audioParameters.append(params)
      }
    }
    // Scale the complete timeline so audio gaps/shorter audio tracks stay aligned.
    composition.scaleTimeRange(CMTimeRange(start: .zero, duration: timeRange.duration), toDuration: outputDuration)
    // Added audio follows output time, independently of the source video's speed.
    // Reuse only the selected excerpt. Voiceover plays once and then stays silent.
    var soundtrackMixed = false
    if request["audio"] != nil {
      guard let sound = request["audio"] as? [String: Any], let uri = sound["uri"] as? String,
            let audioStart = sound["start"] as? Double, let audioDuration = sound["duration"] as? Double,
            let audioVolume = sound["volume"] as? Double, let looping = sound["loop"] as? Bool,
            audioStart.isFinite, audioStart >= 0, audioStart <= 600,
            audioDuration.isFinite, audioDuration >= 1, audioDuration <= 600,
            audioVolume.isFinite, audioVolume >= 0, audioVolume <= 1 else { throw StoryVideoError.invalid("The soundtrack excerpt is invalid.") }
      let soundURL = try local(uri)
      let soundBytes = (try FileManager.default.attributesOfItem(atPath: soundURL.path)[.size] as? NSNumber)?.intValue ?? 0
      guard soundBytes > 0, soundBytes <= 50 * 1024 * 1024 else { throw StoryVideoError.invalid("The soundtrack file is too large or empty.") }
      let soundAsset = AVURLAsset(url: soundURL)
      try attachAsset(id, soundAsset)
      let soundDuration = try await soundAsset.load(.duration)
      guard soundDuration.seconds.isFinite, soundDuration.seconds <= 600.1,
            audioStart + audioDuration <= soundDuration.seconds + 0.1,
            try await soundAsset.loadTracks(withMediaType: .video).isEmpty,
            let soundTrack = try await soundAsset.loadTracks(withMediaType: .audio).first,
            let mixedTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw StoryVideoError.invalid("The original soundtrack could not be read.") }
      let available = try await soundTrack.load(.timeRange)
      let excerptStart = CMTime(seconds: audioStart, preferredTimescale: 48000)
      let excerptDuration = CMTime(seconds: audioDuration, preferredTimescale: 48000)
      var cursor = CMTime.zero, inserted = false
      for _ in 0..<121 {
        try check(id)
        let remaining = CMTimeSubtract(outputDuration, cursor)
        if remaining.seconds <= 0.00001 { break }
        let length = CMTimeMinimum(excerptDuration, remaining)
        let requested = CMTimeRange(start: excerptStart, duration: length)
        let audible = CMTimeRangeGetIntersection(requested, otherRange: available)
        if !audible.isEmpty && audible.duration.seconds > 0 {
          let offset = CMTimeAdd(cursor, CMTimeSubtract(audible.start, excerptStart))
          try mixedTrack.insertTimeRange(audible, of: soundTrack, at: offset)
          inserted = true
        }
        cursor = CMTimeAdd(cursor, length)
        if !looping { break }
      }
      guard inserted, !looping || cursor.seconds >= outputDuration.seconds - 0.001 else { throw StoryVideoError.invalid("The soundtrack could not fill its selected time range.") }
      let params = AVMutableAudioMixInputParameters(track: mixedTrack)
      params.setVolume(Float(audioVolume), at: .zero)
      params.audioTimePitchAlgorithm = .spectral
      audioParameters.append(params)
      soundtrackMixed = true
    }
    audioMix.inputParameters = audioParameters
    try check(id)
    func image(_ raw: String) throws -> CIImage {
      let url = try local(raw)
      guard let original = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]), original.extent.width > 0, original.extent.height > 0,
            original.extent.width <= 2200, original.extent.height <= 4000 else { throw StoryVideoError.invalid("A story artwork layer could not be read.") }
      return original.transformed(by: CGAffineTransform(translationX: -original.extent.minX, y: -original.extent.minY)).transformed(by: CGAffineTransform(scaleX: rect.width/original.extent.width, y: rect.height/original.extent.height)).cropped(to: rect)
    }
    let background = try (request["backgroundUri"] as? String).map(image) ?? CIImage(color: .black).cropped(to: rect)
    let rawLayers = request["layers"] as? [[String: Any]] ?? []
    guard rawLayers.count <= 23 else { throw StoryVideoError.invalid("Too many artwork layers.") }
    let layers: [StoryExportLayer] = try rawLayers.map { raw in
      guard let path = raw["uri"] as? String, let from = raw["start"] as? Double, let to = raw["end"] as? Double,
            from.isFinite, to.isFinite, from >= 0, to > from, to <= outputDuration.seconds + 0.1 else { throw StoryVideoError.invalid("An artwork time range is invalid.") }
      return StoryExportLayer(image: try image(path), start: from, end: to)
    }
    let videoComposition = AVMutableVideoComposition(asset: composition, applyingCIFiltersWithHandler: { request in
      let source = request.sourceImage
      let w = source.extent.width, h = source.extent.height
      guard w > 0, h > 0 else { request.finish(with: StoryVideoError.invalid("The video frame is empty.")); return }
      let ratio: CGFloat = (fit ? max(rect.width/w, rect.height/h) : min(rect.width/w, rect.height/h)) * CGFloat(scale)
      let translationX: CGFloat = (rect.width - w * ratio) / 2 + CGFloat(x) * rect.width
      let translationY: CGFloat = (rect.height - h * ratio) / 2 - CGFloat(y) * rect.height
      var frame = StoryVideoPixels.matrix(source, matrix).transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
        .transformed(by: CGAffineTransform(scaleX: ratio, y: ratio))
        .transformed(by: CGAffineTransform(translationX: translationX, y: translationY))
      frame = frame.composited(over: background).cropped(to: rect)
      let time = request.compositionTime.seconds
      for layer in layers where time >= layer.start && time < layer.end { frame = layer.image.composited(over: frame) }
      request.finish(with: frame.cropped(to: rect), context: StoryVideoPixels.context)
    })
    videoComposition.renderSize = rect.size
    // The filter initializer preserves source-frame timing. Disable that
    // override so a speed change cannot bypass the fixed 30 fps output bound.
    videoComposition.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality), export.supportedFileTypes.contains(.mp4) else { throw StoryVideoError.invalid("This video cannot be exported as MP4.") }
    export.outputURL = destination; export.outputFileType = .mp4; export.videoComposition = videoComposition
    export.audioMix = audioMix; export.shouldOptimizeForNetworkUse = true
    try attach(id, export)
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
    guard export.status == .completed else { throw export.error ?? StoryVideoError.invalid(export.status == .cancelled ? "Video export was cancelled." : "Video export failed.") }
    let exported = AVURLAsset(url: destination)
    let verifiedDuration = try await exported.load(.duration)
    let verifiedTracks = try await exported.loadTracks(withMediaType: .video)
    let verifiedAudioTracks = try await exported.loadTracks(withMediaType: .audio)
    let bytes = (try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.intValue ?? 0
    guard bytes > 1024, !verifiedTracks.isEmpty, verifiedDuration.seconds.isFinite,
          abs(verifiedDuration.seconds-outputDuration.seconds) < 0.25,
          !soundtrackMixed || !verifiedAudioTracks.isEmpty else { throw StoryVideoError.invalid("The exported video or soundtrack could not be verified.") }
    try check(id)
    completed = true
    // Return the caller's validated locator; resolving /var -> /private/var is an
    // internal confinement check and must not change its file identity contract.
    return ["uri": output, "duration": verifiedDuration.seconds, "width": width, "height": height, "bytes": bytes, "soundtrackMixed": soundtrackMixed]
  }
}
