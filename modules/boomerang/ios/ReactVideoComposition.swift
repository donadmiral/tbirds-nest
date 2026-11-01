import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import UIKit
import Vision

private struct ReactSourceWindow {
  let start: Double, end: Double, sourceStart: Double, volume: Double
  let playing: Bool
}

/// A separate instruction for each source action lets AVFoundation request the
/// source decoder only during playback. Holds require just the continuous face
/// track and a fixed image; they cannot accidentally pause the microphone.
private final class ReactVideoInstruction: NSObject, AVVideoCompositionInstructionProtocol {
  let timeRange: CMTimeRange
  let enablePostProcessing = false
  let containsTweening = false
  let passthroughTrackID = kCMPersistentTrackID_Invalid
  let requiredSourceTrackIDs: [NSValue]?
  let faceID: CMPersistentTrackID, sourceID: CMPersistentTrackID?
  let faceTransform: CGAffineTransform, sourceTransform: CGAffineTransform
  let faceRect: CGRect, sourceRect: CGRect
  let holdURL: URL?, overlayURL: URL?
  let sourceZoom: CGFloat, cutout: Bool
  init(range: CMTimeRange, faceID: CMPersistentTrackID, sourceID: CMPersistentTrackID?, faceTransform: CGAffineTransform,
       sourceTransform: CGAffineTransform, faceRect: CGRect, sourceRect: CGRect, holdURL: URL?, overlayURL: URL?, sourceZoom: CGFloat, cutout: Bool) {
    timeRange = range; self.faceID = faceID; self.sourceID = sourceID
    requiredSourceTrackIDs = ([faceID] + (sourceID.map { [$0] } ?? [])).map { NSNumber(value: $0) }
    self.faceTransform = faceTransform; self.sourceTransform = sourceTransform
    self.faceRect = faceRect; self.sourceRect = sourceRect; self.holdURL = holdURL; self.overlayURL = overlayURL
    self.sourceZoom = sourceZoom; self.cutout = cutout
  }
}

/// A bounded two-input compositor, also used for real person-background removal.
/// Only the current held image, overlay and Vision mask are resident at once.
@objc(ReactVideoCompositor)
final class ReactVideoCompositor: NSObject, AVVideoCompositing {
  var sourcePixelBufferAttributes: [String: Any]? { [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA] }
  var requiredPixelBufferAttributesForRenderContext: [String: Any] { [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferIOSurfacePropertiesKey as String: [:]] }
  private let queue = DispatchQueue(label: "com.platinum.react.compositor", qos: .userInitiated)
  private let lock = NSLock()
  private var generation = 0
  private var renderContext: AVVideoCompositionRenderContext?
  private var held: (URL, CIImage)?, overlay: (URL, CIImage)?
  private let context = CIContext(options: [.cacheIntermediates: false, .workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
  private lazy var segmentation: VNGeneratePersonSegmentationRequest = {
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .balanced
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return request
  }()
  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {
    lock.lock(); renderContext = newRenderContext; lock.unlock()
  }
  func cancelAllPendingVideoCompositionRequests() { lock.lock(); generation += 1; lock.unlock() }
  private func upright(_ image: CIImage, _ transform: CGAffineTransform = .identity) -> CIImage {
    let turned = image.transformed(by: transform)
    return turned.transformed(by: CGAffineTransform(translationX: -turned.extent.minX, y: -turned.extent.minY))
  }
  private func fitted(_ source: CIImage, in rect: CGRect, cover: Bool, zoom: CGFloat = 1) -> CIImage {
    let image = upright(source), size = image.extent.size
    let ratio = (cover ? max(rect.width / size.width, rect.height / size.height) : min(rect.width / size.width, rect.height / size.height)) * zoom
    return image.transformed(by: CGAffineTransform(scaleX: ratio, y: ratio))
      .transformed(by: CGAffineTransform(translationX: rect.midX - size.width * ratio / 2, y: rect.midY - size.height * ratio / 2)).cropped(to: rect)
  }
  private func read(_ url: URL) throws -> CIImage {
    guard let value = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]), value.extent.width > 0, value.extent.height > 0,
          value.extent.width <= 4096, value.extent.height <= 4096, value.extent.width * value.extent.height <= 12_000_000 else { throw StoryVideoError.invalid("A reaction image could not be read.") }
    return upright(value)
  }
  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    lock.lock(); let version = generation, render = renderContext; lock.unlock()
    queue.async {
      self.lock.lock(); let cancelled = version != self.generation; self.lock.unlock()
      if cancelled { request.finishCancelledRequest(); return }
      do {
        guard let instruction = request.videoCompositionInstruction as? ReactVideoInstruction,
              let pixels = render?.newPixelBuffer(), let faceBuffer = request.sourceFrame(byTrackID: instruction.faceID) else {
          throw StoryVideoError.invalid("The reaction camera frame is missing.")
        }
        let bounds = CGRect(x: 0, y: 0, width: 720, height: 1280)
        var frame = CIImage(color: CIColor(red: 0.03, green: 0.035, blue: 0.045)).cropped(to: bounds)
        let original: CIImage
        if let sourceID = instruction.sourceID {
          guard let buffer = request.sourceFrame(byTrackID: sourceID) else { throw StoryVideoError.invalid("The reaction source frame is missing.") }
          original = self.upright(CIImage(cvPixelBuffer: buffer), instruction.sourceTransform)
        } else if let url = instruction.holdURL {
          if self.held?.0 != url { self.held = (url, try self.read(url)) }
          original = self.held!.1
        } else { throw StoryVideoError.invalid("The reaction source hold is missing.") }
        frame = self.fitted(original, in: instruction.sourceRect, cover: false, zoom: instruction.sourceZoom).composited(over: frame)
        var face = self.upright(CIImage(cvPixelBuffer: faceBuffer), instruction.faceTransform)
        if instruction.cutout {
          // Vision runs on the upright face image, so its mask follows the same
          // crop/rotation as the camera rather than an assumed device orientation.
          try VNImageRequestHandler(ciImage: face, options: [:]).perform([self.segmentation])
          guard let buffer = self.segmentation.results?.first?.pixelBuffer else { throw StoryVideoError.invalid("Person cutout could not process this frame. Try picture in picture.") }
          let mask = CIImage(cvPixelBuffer: buffer)
          let scaledMask = mask.transformed(by: CGAffineTransform(scaleX: face.extent.width / mask.extent.width, y: face.extent.height / mask.extent.height))
          face = face.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage(color: .clear).cropped(to: face.extent), kCIInputMaskImageKey: scaledMask])
        }
        frame = self.fitted(face, in: instruction.faceRect, cover: true).composited(over: frame)
        if let url = instruction.overlayURL {
          if self.overlay?.0 != url { self.overlay = (url, try self.read(url)) }
          let art = self.overlay!.1
          frame = art.transformed(by: CGAffineTransform(scaleX: bounds.width / art.extent.width, y: bounds.height / art.extent.height)).composited(over: frame)
        }
        self.lock.lock(); let stopped = version != self.generation; self.lock.unlock()
        if stopped { request.finishCancelledRequest(); return }
        self.context.render(frame.cropped(to: bounds), to: pixels, bounds: bounds, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
        request.finish(withComposedVideoFrame: pixels)
      } catch { request.finish(with: error) }
    }
  }
}

enum ReactVideoComposition {
  private final class Job { var cancelled = false; var export: AVAssetExportSession?; var generators: [AVAssetImageGenerator] = [] }
  private static let lock = NSLock()
  private static var jobs: [String: Job] = [:]
  static func cancel(_ id: String) {
    lock.lock(); let job = jobs[id]; job?.cancelled = true; let export = job?.export; let generators = job?.generators ?? []; lock.unlock()
    export?.cancelExport(); generators.forEach { $0.cancelAllCGImageGeneration() }
  }
  private static func check(_ id: String) throws { lock.lock(); defer { lock.unlock() }; guard let job = jobs[id], !job.cancelled else { throw StoryVideoError.invalid("Reaction export was cancelled.") } }
  private static func number(_ raw: [String: Any], _ key: String, _ min: Double, _ max: Double) throws -> Double {
    guard let value = raw[key] as? Double, value.isFinite, value >= min, value <= max else { throw StoryVideoError.invalid("The reaction \(key) is invalid.") }; return value
  }
  private static func local(_ raw: Any?, output: Bool = false) throws -> URL {
    guard let text = raw as? String, let url = URL(string: text), url.isFileURL, url.host == nil || url.host == "", url.query == nil, url.fragment == nil else { throw StoryVideoError.invalid("React requires local app media.") }
    let file = url.standardizedFileURL.resolvingSymlinksInPath()
    let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
    let temporary = URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().path + "/"
    guard file.path.hasPrefix(home) || file.path.hasPrefix(temporary) else { throw StoryVideoError.invalid("A reaction file is outside this app.") }
    if output {
      let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/"
      guard file.path.hasPrefix(cache), file.lastPathComponent.hasPrefix("pc-react-export-"), file.pathExtension == "mp4", !FileManager.default.fileExists(atPath: file.path) else { throw StoryVideoError.invalid("Choose a new reaction export file.") }
    } else {
      let bytes = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
      guard bytes > 0, bytes <= 512 * 1024 * 1024 else { throw StoryVideoError.invalid("A reaction input is empty or too large.") }
    }
    return file
  }
  private static func rectangle(_ raw: Any?) throws -> CGRect {
    guard let raw = raw as? [String: Any] else { throw StoryVideoError.invalid("The reaction layout is missing.") }
    let x = try number(raw, "x", 0, 1), y = try number(raw, "y", 0, 1), width = try number(raw, "width", 0.1, 1), height = try number(raw, "height", 0.1, 1)
    guard x + width <= 1.001, y + height <= 1.001 else { throw StoryVideoError.invalid("The reaction layout is outside its canvas.") }
    // UI uses top-left coordinates; Core Image uses bottom-left coordinates.
    return CGRect(x: x * 720, y: (1 - y - height) * 1280, width: width * 720, height: height * 1280)
  }
  private static func video(_ asset: AVAsset) async throws -> AVAssetTrack {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw StoryVideoError.invalid("A reaction video track is missing.") }
    let size = try await track.load(.naturalSize)
    guard size.width > 0, size.height > 0, size.width <= 4096, size.height <= 4096, size.width * size.height <= 4096 * 2160 else { throw StoryVideoError.invalid("Choose a reaction video of 4K resolution or lower.") }
    return track
  }
  static func make(_ raw: [String: Any]) async throws -> [String: Any] {
    guard let id = raw["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{8,120}$", options: .regularExpression) != nil,
          let output = raw["outputUri"] as? String, let kind = raw["sourceKind"] as? String, ["image", "video"].contains(kind),
          let cutout = raw["cutout"] as? Bool, (raw["width"] as? Int) == 720, (raw["height"] as? Int) == 1280,
          let rawSegments = raw["segments"] as? [[String: Any]], rawSegments.count >= 1, rawSegments.count <= 160 else { throw StoryVideoError.invalid("The reaction export request is incomplete.") }
    let sourceURL = try local(raw["sourceUri"]), cameraURL = try local(raw["cameraUri"]), destination = try local(output, output: true)
    let overlayURL = try raw["overlayUri"].map { try local($0) }
    let duration = try number(raw, "duration", 0.1, 120), cameraStart = try number(raw, "cameraStart", 0, 120)
    let voice = try number(raw, "voiceVolume", 0, 1), zoom = try number(raw, "sourceZoom", 1, 3)
    guard cameraStart + duration <= 120.01, destination != sourceURL, destination != cameraURL else { throw StoryVideoError.invalid("The reaction duration is invalid.") }
    let sourceRect = try rectangle(raw["sourceRect"]), faceRect = try rectangle(raw["faceRect"])
    var cursor = 0.0
    let segments: [ReactSourceWindow] = try rawSegments.map { item in
      let start = try number(item, "start", 0, duration), end = try number(item, "end", 0, duration + 0.002), sourceStart = try number(item, "sourceStart", 0, 86400), volume = try number(item, "volume", 0, 1)
      guard let playing = item["playing"] as? Bool, abs(start - cursor) < 0.002, end > start, kind == "video" || !playing, playing || volume == 0 else { throw StoryVideoError.invalid("The reaction source has an invalid hold or gap.") }
      cursor = end; return ReactSourceWindow(start: start, end: end, sourceStart: sourceStart, volume: volume, playing: playing)
    }
    guard abs(cursor - duration) < 0.002 else { throw StoryVideoError.invalid("The reaction source does not cover the camera take.") }
    try StoryVideoComposition.reserveMemory(id)
    let job = Job(); lock.lock(); jobs[id] = job; lock.unlock()
    var completed = false, temporary: [URL] = []
    let timeout = DispatchWorkItem { cancel(id) }
    DispatchQueue.global().asyncAfter(deadline: .now() + 360, execute: timeout)
    let background = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in cancel(id) }
    defer {
      timeout.cancel(); NotificationCenter.default.removeObserver(background)
      lock.lock(); jobs.removeValue(forKey: id); lock.unlock(); StoryVideoComposition.releaseMemory(id)
      temporary.forEach { try? FileManager.default.removeItem(at: $0) }
      if !completed { try? FileManager.default.removeItem(at: destination) }
    }
    try check(id)
    let camera = AVURLAsset(url: cameraURL), faceVideo = try await video(camera)
    let cameraDuration = try await camera.load(.duration)
    guard cameraDuration.seconds.isFinite, cameraStart + duration <= cameraDuration.seconds + 0.06,
          let microphone = try await camera.loadTracks(withMediaType: .audio).first else { throw StoryVideoError.invalid("The face recording has no microphone audio or ends too early. Record another take.") }
    let source = kind == "video" ? AVURLAsset(url: sourceURL) : nil
    var sourceVideo: AVAssetTrack?, sourceDuration = 0.0, sourceAudio: AVAssetTrack?
    if let source {
      sourceVideo = try await video(source)
      sourceDuration = (try await source.load(.duration)).seconds
      sourceAudio = try await source.loadTracks(withMediaType: .audio).first
    }
    if kind == "video" { guard sourceDuration.isFinite, sourceDuration > 0 else { throw StoryVideoError.invalid("The source duration is invalid.") } }
    let composition = AVMutableComposition()
    guard let faceTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw StoryVideoError.invalid("The reaction camera track could not be created.") }
    let usesSourceVideo = segments.contains(where: { $0.playing })
    let sourceTrack = usesSourceVideo ? composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) : nil
    guard !usesSourceVideo || sourceTrack != nil else { throw StoryVideoError.invalid("The reaction source track could not be created.") }
    func time(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 60000) }
    let takeRange = CMTimeRange(start: time(cameraStart), duration: time(duration))
    try faceTrack.insertTimeRange(takeRange, of: faceVideo, at: .zero)
    let faceTransform = try await faceVideo.load(.preferredTransform)
    let sourceTransform = try await sourceVideo?.load(.preferredTransform) ?? .identity
    let audioMix = AVMutableAudioMix(); var audioParameters: [AVAudioMixInputParameters] = []
    if voice > 0 {
      guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw StoryVideoError.invalid("The reaction microphone track could not be created.") }
      let audible = CMTimeRangeGetIntersection(takeRange, otherRange: try await microphone.load(.timeRange))
      guard !audible.isEmpty else { throw StoryVideoError.invalid("The recorded microphone audio is empty.") }
      try track.insertTimeRange(audible, of: microphone, at: CMTimeSubtract(audible.start, takeRange.start))
      let parameters = AVMutableAudioMixInputParameters(track: track); parameters.setVolume(Float(voice), at: .zero); audioParameters.append(parameters)
    }
    let usesSourceAudio = sourceAudio != nil && segments.contains(where: { $0.playing && $0.volume > 0 })
    let sourceAudioTrack = usesSourceAudio ? composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) : nil
    guard !usesSourceAudio || sourceAudioTrack != nil else { throw StoryVideoError.invalid("The original audio track could not be created.") }
    let sourceAudioParameters = sourceAudioTrack.map { AVMutableAudioMixInputParameters(track: $0) }
    let availableAudio = try await sourceAudio?.load(.timeRange)
    var generator: AVAssetImageGenerator?
    if let source {
      let value = AVAssetImageGenerator(asset: source); value.appliesPreferredTrackTransform = true
      value.maximumSize = CGSize(width: 1440, height: 1280)
      value.requestedTimeToleranceBefore = .zero; value.requestedTimeToleranceAfter = .zero
      generator = value; lock.lock(); job.generators.append(value); lock.unlock()
    }
    var holds: [Int: URL] = [:], instructions: [AVVideoCompositionInstructionProtocol] = []
    for segment in segments {
      try check(id)
      let outputRange = CMTimeRange(start: time(segment.start), duration: time(segment.end - segment.start))
      var holdURL: URL? = kind == "image" ? sourceURL : nil, activeSource: CMPersistentTrackID?
      if segment.playing, let sourceVideo, let sourceTrack {
        guard segment.sourceStart + segment.end - segment.start <= sourceDuration + 0.01 else { throw StoryVideoError.invalid("A reaction playback segment exceeds the source. Record the take again.") }
        let inputRange = CMTimeRange(start: time(segment.sourceStart), duration: outputRange.duration)
        try sourceTrack.insertTimeRange(inputRange, of: sourceVideo, at: outputRange.start); activeSource = sourceTrack.trackID
        if segment.volume > 0, let sourceAudio, let sourceAudioTrack, let availableAudio {
          let audible = CMTimeRangeGetIntersection(inputRange, otherRange: availableAudio)
          if !audible.isEmpty {
            let offset = CMTimeAdd(outputRange.start, CMTimeSubtract(audible.start, inputRange.start))
            try sourceAudioTrack.insertTimeRange(audible, of: sourceAudio, at: offset)
            sourceAudioParameters?.setVolume(Float(segment.volume), at: outputRange.start)
            sourceAudioParameters?.setVolume(0, at: CMTimeRangeGetEnd(outputRange))
          }
        }
      } else if let generator {
        let position = min(max(0, segment.sourceStart), max(0, sourceDuration - 1 / 30))
        let key = Int((position * 1000).rounded())
        if let known = holds[key] { holdURL = known }
        else {
          let pixels = try generator.copyCGImage(at: time(position), actualTime: nil)
          let url = destination.deletingLastPathComponent().appendingPathComponent("pc-react-hold-\(UUID().uuidString).png")
          temporary.append(url)
          guard let bytes = UIImage(cgImage: pixels).pngData() else { throw StoryVideoError.invalid("A reaction freeze frame could not be prepared.") }
          try bytes.write(to: url, options: .atomic); holds[key] = url; holdURL = url
        }
      }
      instructions.append(ReactVideoInstruction(range: outputRange, faceID: faceTrack.trackID, sourceID: activeSource, faceTransform: faceTransform,
        sourceTransform: sourceTransform, faceRect: faceRect, sourceRect: sourceRect, holdURL: holdURL, overlayURL: overlayURL, sourceZoom: CGFloat(zoom), cutout: cutout))
    }
    if let sourceAudioParameters { audioParameters.append(sourceAudioParameters) }; audioMix.inputParameters = audioParameters
    let videoComposition = AVMutableVideoComposition()
    videoComposition.customVideoCompositorClass = ReactVideoCompositor.self
    videoComposition.instructions = instructions; videoComposition.renderSize = CGSize(width: 720, height: 1280)
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality), export.supportedFileTypes.contains(.mp4) else { throw StoryVideoError.invalid("This device cannot export the combined reaction.") }
    export.outputURL = destination; export.outputFileType = .mp4; export.videoComposition = videoComposition; export.audioMix = audioMix
    export.timeRange = CMTimeRange(start: .zero, duration: time(duration)); export.shouldOptimizeForNetworkUse = true
    lock.lock(); job.export = export; let stopped = job.cancelled; lock.unlock()
    if stopped { throw StoryVideoError.invalid("Reaction export was cancelled.") }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
    try check(id)
    guard export.status == .completed else { throw export.error ?? StoryVideoError.invalid("The combined reaction could not finish exporting.") }
    let result = AVURLAsset(url: destination), verifiedDuration = try await result.load(.duration), verifiedVideo = try await video(result)
    let size = try await verifiedVideo.load(.naturalSize), bytes = (try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.intValue ?? 0
    let sound = try await result.loadTracks(withMediaType: .audio)
    let expectedAudio = voice > 0 || usesSourceAudio
    guard verifiedDuration.seconds.isFinite, abs(verifiedDuration.seconds - duration) < 0.25, size.width == 720, size.height == 1280, bytes > 1024, bytes <= 512 * 1024 * 1024,
          !expectedAudio || !sound.isEmpty else { throw StoryVideoError.invalid("The combined reaction video or audio could not be verified.") }
    try check(id); completed = true
    return ["uri": output, "duration": verifiedDuration.seconds, "width": 720, "height": 1280, "bytes": bytes, "segmentCount": segments.count, "voiceMixed": voice > 0]
  }
}
