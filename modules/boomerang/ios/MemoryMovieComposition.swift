import AVFoundation
import CoreImage
import CoreMedia
import ImageIO
import UIKit
import UniformTypeIdentifiers

/// Owns a complete book export, including every child encoder and temporary file.
/// The reservation remains held until cancellation has stopped the current writer.
enum MemoryMovieComposition {
  private final class Job {
    let id: String
    var cancelled = false
    var asset: AVAsset?
    var reader: AVAssetReader?
    var session: AVAssetExportSession?
    var child: String?
    var temporary: [URL] = []
    init(_ id: String) { self.id = id }
  }
  private static let lock = NSLock()
  private static var active: Job?
  private static let sourceLimit = 512 * 1024 * 1024
  private static let movieLimit = 256 * 1024 * 1024
  private static let imageLimit = 32 * 1024 * 1024
  private static let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]

  static func cancel(_ id: String) { lock.lock(); let job = active?.id == id ? active : nil; lock.unlock(); if let job { cancel(job) } }
  private static func cancel(_ job: Job) {
    lock.lock()
    guard active === job else { lock.unlock(); return }
    job.cancelled = true
    let asset = job.asset, reader = job.reader, session = job.session, child = job.child
    lock.unlock()
    StoryVideoComposition.cancelMemory(job.id)
    asset?.cancelLoading(); reader?.cancelReading(); session?.cancelExport()
    if let child { StoryVideoComposition.cancel(child) }
  }
  private static func begin(_ raw: Any?) throws -> Job {
    guard let id = raw as? String, identity(id) else { throw invalid("The memory export ID is invalid.") }
    lock.lock(); defer { lock.unlock() }
    guard active == nil else { throw invalid("Another memory is still exporting.") }
    try StoryVideoComposition.reserveMemory(id)
    let job = Job(id); active = job; return job
  }
  private static func check(_ job: Job) throws { lock.lock(); defer { lock.unlock() }; guard active === job, !job.cancelled else { throw invalid("Memory movie export was cancelled.") } }
  private static func attach(_ job: Job, asset: AVAsset? = nil, reader: AVAssetReader? = nil, session: AVAssetExportSession? = nil, child: String? = nil) throws {
    lock.lock(); defer { lock.unlock() }
    guard active === job, !job.cancelled else { throw invalid("Memory movie export was cancelled.") }
    job.asset = asset; job.reader = reader; job.session = session; job.child = child
  }
  private static func finish(_ job: Job, commit: Bool = false) throws {
    lock.lock(); defer { lock.unlock() }
    if commit { guard active === job, !job.cancelled else { throw invalid("Memory movie export was cancelled.") } }
    if active === job {
      job.asset = nil; job.reader = nil; job.session = nil; job.child = nil
      active = nil; StoryVideoComposition.releaseMemory(job.id)
    }
  }
  private static func identity(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9_-]{8,120}$", options: .regularExpression) != nil }
  private static func removeTemporary(_ job: Job) throws {
    for file in job.temporary where FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    job.temporary.removeAll()
  }
  private static func invalid(_ message: String) -> StoryVideoError { .invalid(message) }
  private static func encodingFailure(_ error: Error?, stage: String) -> NSError {
    var info: [String: Any] = [NSLocalizedDescriptionKey: "The memory movie could not finish \(stage)."]
    if let error { info[NSUnderlyingErrorKey] = error as NSError }
    return NSError(domain: "MemoryMovieEncoding", code: 1, userInfo: info)
  }
  private static func size(_ url: URL) throws -> Int { (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0 }
  private static func local(_ raw: Any?, output: String? = nil, limit: Int = sourceLimit) throws -> URL {
    guard let raw = raw as? String, let uri = URL(string: raw), uri.isFileURL else { throw invalid("Memory export requires private local media.") }
    let url = uri.standardizedFileURL.resolvingSymlinksInPath()
    let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path + "/"
    let temporary = URL(fileURLWithPath: NSTemporaryDirectory()).resolvingSymlinksInPath().path + "/"
    guard url.path.hasPrefix(home) || url.path.hasPrefix(temporary) else { throw invalid("A memory source is outside this app.") }
    if let output {
      let prefix = output == "png" ? "pc-memory-image-" : "pc-memory-export-"
      guard url.path.hasPrefix(cache.resolvingSymlinksInPath().path + "/"), url.lastPathComponent.hasPrefix(prefix), url.pathExtension == output,
            !FileManager.default.fileExists(atPath: url.path) else { throw invalid("Choose a new memory output in the app cache.") }
    } else {
      let info = try FileManager.default.attributesOfItem(atPath: url.path)
      let bytes = (info[.size] as? NSNumber)?.intValue ?? 0
      guard info[.type] as? FileAttributeType == .typeRegular, bytes > 0, bytes <= limit else { throw invalid("A memory source is missing or too large.") }
    }
    return url
  }
  private static func number(_ value: Any?, _ lower: Double, _ upper: Double, _ label: String) throws -> Double {
    guard let boxed = value as? NSNumber, CFGetTypeID(boxed) != CFBooleanGetTypeID() else { throw invalid("The memory \(label) is invalid.") }
    let n = boxed.doubleValue
    guard n.isFinite, n >= lower, n <= upper else { throw invalid("The memory \(label) is invalid.") }; return n
  }
  private static func monitor(_ job: Job, seconds: Double) -> (DispatchWorkItem, NSObjectProtocol) {
    let timeout = DispatchWorkItem { cancel(job) }
    DispatchQueue.global().asyncAfter(deadline: .now()+seconds, execute: timeout)
    let observer = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in cancel(job) }
    return (timeout, observer)
  }

  /// ImageIO downsamples before rasterization; no image framework or shared disk cache is used.
  static func prepareImage(_ request: [String: Any]) async throws -> [String: Any] {
    let sourceURL = try local(request["inputUri"], limit: imageLimit), destination = try local(request["outputUri"], output: "png")
    let job = try begin(request["id"]), monitoring = monitor(job, seconds: 30)
    var completed = false
    defer { monitoring.0.cancel(); NotificationCenter.default.removeObserver(monitoring.1); if !completed { try? FileManager.default.removeItem(at: destination) }; try? finish(job) }
    // Unwind the ImageIO decoder, mapped bytes and PNG writer before releasing
    // the shared encoder reservation or allowing another raster allocation.
    let result = try autoreleasepool { try normalizeImage(sourceURL, destination: destination, job: job, outputURI: request["outputUri"]!) }
    try finish(job, commit: true); completed = true
    return result
  }
  private static func normalizeImage(_ sourceURL: URL, destination: URL, job: Job, outputURI: Any) throws -> [String: Any] {
    try check(job)
    let data = try Data(contentsOf: sourceURL, options: .mappedIfSafe)
    try staticImage(data)
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) == 1, CGImageSourceGetStatus(source) == .statusComplete,
          let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let rawWidth = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
          let rawHeight = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
          rawWidth > 0, rawHeight > 0, rawWidth <= 50000, rawHeight <= 50000, rawWidth * rawHeight <= 200_000_000 else { throw invalid("This memory photo is animated, too large, or unreadable.") }
    let orientation = (props[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
    let swaps = (5...8).contains(orientation), width = swaps ? rawHeight : rawWidth, height = swaps ? rawWidth : rawHeight
    let scale = min(1, min(1440/width, 2560/height)), maximum = max(1, Int(floor(max(width,height)*scale)))
    try check(job)
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maximum] as CFDictionary), image.width <= 1440, image.height <= 2560,
      let writer = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw invalid("The memory photo could not be prepared.") }
    try check(job)
    CGImageDestinationAddImage(writer, image, nil)
    guard CGImageDestinationFinalize(writer) else { throw invalid("The memory photo could not be written.") }
    let bytes = try size(destination)
    guard bytes > 0, bytes <= imageLimit else { throw invalid("The prepared memory photo is too large.") }
    try check(job)
    return ["uri": outputURI, "width": image.width, "height": image.height, "bytes": bytes]
  }
  private static func staticImage(_ data: Data) throws {
    guard !data.isEmpty, data.count <= imageLimit else { throw invalid("The memory photo is empty or too large.") }
    let bytes = [UInt8](data.prefix(16))
    func text(_ offset: Int, _ count: Int) -> String { String(data: data.subdata(in: offset..<offset+count), encoding: .ascii) ?? "" }
    if bytes.count >= 6, text(0,3) == "GIF" { throw invalid("Animated memory photos need the animated movie renderer.") }
    if bytes.count >= 8, bytes.prefix(8).elementsEqual([137,80,78,71,13,10,26,10]) {
      var offset = 8, chunks = 0
      while offset+12 <= data.count {
        chunks += 1; guard chunks <= 65536 else { throw invalid("The memory PNG has too many chunks.") }
        let length = data[offset..<offset+4].reduce(0) { $0 << 8 | Int($1) }
        guard length <= data.count-offset-12 else { throw invalid("The memory PNG is incomplete.") }
        if ["acTL","fcTL","fdAT"].contains(text(offset+4,4)) { throw invalid("Animated memory photos need the animated movie renderer.") }
        offset += length+12
      }
    } else if bytes.count >= 12, text(0,4) == "RIFF", text(8,4) == "WEBP" {
      var offset = 12, chunks = 0
      while offset+8 <= data.count {
        chunks += 1; guard chunks <= 65536 else { throw invalid("The memory WebP has too many chunks.") }
        let length = (0..<4).reduce(0) { $0 | Int(data[offset+4+$1]) << (8*$1) }
        guard length <= data.count-offset-8 else { throw invalid("The memory WebP is incomplete.") }
        let kind = text(offset,4)
        if kind == "ANIM" || kind == "ANMF" || kind == "VP8X" && length > 0 && data[offset+8] & 2 != 0 { throw invalid("Animated memory photos need the animated movie renderer.") }
        offset += 8+length+(length%2)
      }
    }
  }

  static func make(_ request: [String: Any]) async throws -> [String: Any] {
    guard try number(request["width"],720,720,"width") == 720, try number(request["height"],1280,1280,"height") == 1280,
          let scenes = request["scenes"] as? [[String: Any]], !scenes.isEmpty, scenes.count <= 82 else { throw invalid("The memory movie scene list is invalid.") }
    let destination = try local(request["outputUri"], output: "mp4"), job = try begin(request["id"]), monitoring = monitor(job, seconds: 720)
    var completed = false
    defer { monitoring.0.cancel(); NotificationCenter.default.removeObserver(monitoring.1); try? removeTemporary(job); if !completed { try? FileManager.default.removeItem(at: destination) }; try? finish(job) }
    let result = try await render(request, scenes: scenes, destination: destination, job: job)
    // The renderer and verifier have stopped their writers/readers. Keep the
    // reservation until every child movie has actually been removed.
    try removeTemporary(job)
    try finish(job, commit: true); completed = true
    return result
  }
  private static func render(_ request: [String: Any], scenes: [[String: Any]], destination: URL, job: Job) async throws -> [String: Any] {
    var inputFiles = Set<String>(), checkedImages = Set<String>(), inputBytes = 0, rasterCount = 0, duration = 0.0
    func source(_ raw: Any?, limit: Int = sourceLimit) throws -> URL {
      let url = try local(raw, limit: limit)
      if inputFiles.insert(url.path).inserted { inputBytes += try size(url); guard inputBytes <= sourceLimit else { throw invalid("The book’s source files exceed the device export limit. Choose a shorter cut.") } }
      return url
    }
    func imageSource(_ raw: Any?) throws -> URL {
      let url = try source(raw, limit: imageLimit)
      if checkedImages.insert(url.path).inserted {
        try check(job)
        try autoreleasepool {
          let data = try Data(contentsOf: url, options: .mappedIfSafe); try staticImage(data)
          guard let image = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
                CGImageSourceGetCount(image) == 1, CGImageSourceGetStatus(image) == .statusComplete,
                let properties = CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any],
                let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
                let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue,
                width > 0, height > 0, width <= 2200, height <= 4000 else { throw invalid("A memory image must be a bounded, readable static photo.") }
        }
        try check(job)
      }
      return url
    }
    var lengths: [Double] = [], sceneIDs = Set<String>()
    for scene in scenes {
      try check(job)
      guard let id = scene["id"] as? String, identity(id), sceneIDs.insert(id).inserted,
            let recipe = scene["recipe"] as? [String: Any], try number(recipe["width"],720,720,"width") == 720, try number(recipe["height"],1280,1280,"height") == 1280,
            let kind = scene["inputKind"] as? String, kind == "image" || kind == "video",
            let layers = scene["layers"] as? [[String: Any]], layers.count <= 24,
            let fit = recipe["fit"] as? String, ["contain","cover"].contains(fit),
            let matrix = recipe["matrix"] as? [Any], matrix.count == 20,
            let motion = scene["motion"] as? [String: Any], let transition = scene["transition"] as? [String: Any] else { throw invalid("A memory scene is incomplete.") }
      let start = try number(recipe["trimStart"], 0, 600, "trim start"), end = try number(recipe["trimEnd"], start+0.05, 660, "trim end"), speed = try number(recipe["speed"], 0.25, 4, "speed")
      let length = (end-start)/speed
      guard end-start <= 60.001, length >= 0.05, length <= 120, kind != "image" || start == 0 && speed == 1 && length >= 1 && length <= 30 else { throw invalid("A memory scene is too long.") }
      _ = try number(recipe["volume"],0,1,"original volume"); _ = try number(recipe["scale"],0.35,5,"scale")
      _ = try number(recipe["x"],-2,2,"horizontal position"); _ = try number(recipe["y"],-2,2,"vertical position")
      for value in matrix { _ = try number(value,-16,16,"color matrix") }
      _ = try number(motion["fromScale"],1,1.1,"motion scale"); _ = try number(motion["toScale"],1,1.1,"motion scale")
      _ = try number(motion["x"],-0.05,0.05,"motion position"); _ = try number(motion["y"],-0.05,0.05,"motion position")
      _ = try number(transition["fadeSec"],0,min(0.5,length/2),"scene transition")
      duration += length; lengths.append(length)
      guard duration <= 300.001 else { throw invalid("Choose a memory movie of five minutes or less.") }
      let input: URL
      if kind == "image" { input = try imageSource(scene["inputUri"]) } else { input = try source(scene["inputUri"]) }
      if kind == "video" {
        let asset = AVURLAsset(url: input); try attach(job, asset: asset)
        guard let video = try await asset.loadTracks(withMediaType: .video).first else { throw invalid("A memory video is unreadable.") }
        let dimensions = try await video.load(.naturalSize), range = try await video.load(.timeRange)
        guard dimensions.width > 0, dimensions.height > 0, dimensions.width <= 4096, dimensions.height <= 4096, dimensions.width*dimensions.height <= 9_000_000,
              range.duration.seconds.isFinite, end <= range.end.seconds+0.1 else { throw invalid("A memory video’s size or trim cannot be exported.") }
      }
      if let background = scene["backgroundUri"] { _ = try imageSource(background) }
      rasterCount += layers.count; guard rasterCount <= 240 else { throw invalid("The movie has too many timed artwork layers.") }
      for layer in layers {
        let from = try number(layer["start"],0,length,"artwork start"); _ = try number(layer["end"],from+0.001,length+0.001,"artwork end")
        _ = try imageSource(layer["uri"])
      }
      if let rawAudio = scene["audio"] {
        guard let audio = rawAudio as? [String: Any] else { throw invalid("The memory page audio is invalid.") }
        try validateAudio(audio); _ = try source(audio["uri"], limit: 50*1024*1024)
      }
    }
    let sound = request["soundtrack"] as? [String: Any]
    if request["soundtrack"] != nil, sound == nil { throw invalid("The book soundtrack is invalid.") }
    if let sound {
      try validateAudio(sound); _ = try source(sound["uri"], limit: 50*1024*1024)
      guard let gains = sound["gain"] as? [[String: Any]], gains.count == scenes.count else { throw invalid("The book soundtrack’s timing is invalid.") }
      var cursor = 0.0
      for (index,gain) in gains.enumerated() {
        let from = try number(gain["start"],0,duration,"soundtrack window"), to = try number(gain["end"],from+0.01,duration+0.002,"soundtrack window")
        _ = try number(gain["volume"],0,1,"soundtrack gain")
        guard abs(from-cursor) <= 0.002, abs(to-from-lengths[index]) <= 0.002 else { throw invalid("The book soundtrack windows do not match its scenes.") }; cursor = to
      }
    }
    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw invalid("The memory movie tracks could not be created.") }
    // A silent book must be a video-only composition. An empty audio track and
    // mix parameter do not represent silence and can make MP4 export fail.
    var sceneAudioTrack: AVMutableCompositionTrack?
    var cursor = CMTime.zero, temporaryBytes = 0, expectedAudio = false
    let audioMix = AVMutableAudioMix()
    var parameters: [AVAudioMixInputParameters] = []
    for (index, scene) in scenes.enumerated() {
      try check(job)
      guard movieLimit-temporaryBytes > 1024 else { throw invalid("The movie’s temporary video exceeds the device export limit.") }
      let child = UUID().uuidString, output = cache.appendingPathComponent("pc-story-export-\(UUID().uuidString)-memory.mp4")
      job.temporary.append(output)
      var childRequest = scene; childRequest["id"] = child; childRequest["outputUri"] = output.absoluteString
      childRequest["memoryFileLengthLimit"] = movieLimit-temporaryBytes
      try attach(job, child: child)
      do { _ = try await StoryVideoComposition.make(childRequest, reservation: job.id) }
      catch { throw encodingFailure(error, stage: "memory \(index+1)") }
      try check(job)
      temporaryBytes += try size(output); guard temporaryBytes <= movieLimit else { throw invalid("The movie’s temporary video exceeds the device export limit.") }
      let asset = AVURLAsset(url: output); try attach(job, asset: asset)
      guard let video = try await asset.loadTracks(withMediaType: .video).first else { throw invalid("A prepared memory video is missing.") }
      let expected = CMTime(seconds: lengths[index], preferredTimescale: 60000), available = try await video.load(.timeRange)
      guard abs(available.duration.seconds-lengths[index]) <= 0.1 else { throw invalid("A prepared memory scene has the wrong duration.") }
      let range = CMTimeRange(start: .zero, duration: CMTimeMinimum(expected, available.duration))
      try videoTrack.insertTimeRange(range, of: video, at: cursor)
      if let audio = try await asset.loadTracks(withMediaType: .audio).first {
        let audible = CMTimeRangeGetIntersection(CMTimeRange(start: .zero, duration: expected), otherRange: try await audio.load(.timeRange))
        if !audible.isEmpty && audible.duration.seconds > 0 {
          let track: AVMutableCompositionTrack
          if let existing = sceneAudioTrack { track = existing }
          else {
            guard let created = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw invalid("The memory page audio track could not be created.") }
            track = created
            sceneAudioTrack = track
            let mix = AVMutableAudioMixInputParameters(track: track)
            mix.setVolume(1, at: .zero); mix.audioTimePitchAlgorithm = .spectral
            parameters.append(mix)
          }
          try track.insertTimeRange(audible, of: audio, at: CMTimeAdd(cursor,audible.start)); expectedAudio = true
        }
      }
      cursor = CMTimeAdd(cursor, expected)
    }
    if let sound {
      let start = try number(sound["start"], 0, 600, "soundtrack start"), excerpt = try number(sound["duration"], 1, 600, "soundtrack duration"), volume = try number(sound["volume"], 0, 1, "soundtrack volume")
      guard let loop = sound["loop"] as? Bool, let gains = sound["gain"] as? [[String: Any]], gains.count == scenes.count else { throw invalid("The book soundtrack’s timing is invalid.") }
      let asset = AVURLAsset(url: try source(sound["uri"], limit: 50*1024*1024)); try attach(job, asset: asset)
      let soundDuration = try await asset.load(.duration)
      guard soundDuration.seconds.isFinite, soundDuration.seconds <= 600.1, start+excerpt <= soundDuration.seconds+0.1,
            try await asset.loadTracks(withMediaType: .video).isEmpty, let audio = try await asset.loadTracks(withMediaType: .audio).first,
            let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw invalid("The book soundtrack could not be read.") }
      let available = try await audio.load(.timeRange), selected = CMTime(seconds: excerpt, preferredTimescale: 48000), from = CMTime(seconds: start, preferredTimescale: 48000)
      var position = CMTime.zero, inserted = false
      for _ in 0..<301 {
        try check(job)
        let remaining = CMTimeSubtract(cursor,position); if remaining.seconds <= 0.00001 { break }
        let length = CMTimeMinimum(selected,remaining), audible = CMTimeRangeGetIntersection(CMTimeRange(start: from,duration: length),otherRange: available)
        if !audible.isEmpty && audible.duration.seconds > 0 { try track.insertTimeRange(audible,of: audio,at: CMTimeAdd(position,CMTimeSubtract(audible.start,from))); inserted = true }
        position = CMTimeAdd(position,length); if !loop { break }
      }
      guard inserted, !loop || position.seconds >= cursor.seconds-0.001 else { throw invalid("The book soundtrack could not fill its excerpt.") }
      let mix = AVMutableAudioMixInputParameters(track: track); mix.audioTimePitchAlgorithm = .spectral
      var gainCursor = 0.0
      for (index,gain) in gains.enumerated() {
        let from = try number(gain["start"],0,300,"soundtrack window"), to = try number(gain["end"],0,300.001,"soundtrack window"), value = try number(gain["volume"],0,1,"soundtrack gain")
        guard abs(from-gainCursor) < 0.002, abs(to-from-lengths[index]) < 0.002 else { throw invalid("The book soundtrack windows do not match its scenes.") }
        // A sequence of point volumes can interpolate toward the next page's
        // gain. Hold each page's exact level over its complete time range.
        let level = Float(volume*value)
        mix.setVolumeRamp(fromStartVolume: level, toEndVolume: level,
          timeRange: CMTimeRange(start: CMTime(seconds: from,preferredTimescale: 60000), duration: CMTime(seconds: to-from,preferredTimescale: 60000)))
        gainCursor = to
      }
      parameters.append(mix); expectedAudio = true
    }
    audioMix.inputParameters = parameters
    let instruction = AVMutableVideoCompositionInstruction(); instruction.timeRange = CMTimeRange(start: .zero,duration: cursor)
    instruction.layerInstructions = [AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)]
    let videoComposition = AVMutableVideoComposition(); videoComposition.instructions = [instruction]; videoComposition.renderSize = CGSize(width: 720,height: 1280)
    videoComposition.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid; videoComposition.frameDuration = CMTime(value: 1,timescale: 30)
    videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2; videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2; videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    guard let export = AVAssetExportSession(asset: composition,presetName: AVAssetExportPresetHighestQuality), export.supportedFileTypes.contains(.mp4) else { throw invalid("The memory movie encoder is unavailable.") }
    export.outputURL = destination; export.outputFileType = .mp4; export.videoComposition = videoComposition
    if !parameters.isEmpty { export.audioMix = audioMix }
    export.timeRange = CMTimeRange(start: .zero,duration: cursor); export.fileLengthLimit = Int64(movieLimit); export.shouldOptimizeForNetworkUse = true
    try attach(job,session: export)
    await withCheckedContinuation { (continuation: CheckedContinuation<Void,Never>) in export.exportAsynchronously { continuation.resume() } }
    guard export.status == .completed else { throw encodingFailure(export.error, stage: "the final encoding") }
    let verified = try await verify(destination,expected: duration,audio: expectedAudio,job: job)
    try check(job)
    return ["uri": request["outputUri"]!, "duration": verified.0, "width": 720, "height": 1280, "bytes": verified.1, "sceneCount": scenes.count, "soundtrackMixed": sound != nil]
  }

  private static func validateAudio(_ value: [String: Any]) throws {
    _ = try number(value["start"],0,600,"audio start"); _ = try number(value["duration"],1,600,"audio duration"); _ = try number(value["volume"],0,1,"audio volume")
    guard let loop = value["loop"] as? NSNumber, CFGetTypeID(loop) == CFBooleanGetTypeID() else { throw invalid("The memory audio loop mode is invalid.") }
  }

  private static func verify(_ url: URL, expected: Double, audio: Bool, job: Job) async throws -> (Double,Int) {
    try check(job)
    let asset = AVURLAsset(url: url); try attach(job,asset: asset)
    guard let video = try await asset.loadTracks(withMediaType: .video).first else { throw invalid("The exported memory movie has no video.") }
    let range = try await video.load(.timeRange), dimensions = try await video.load(.naturalSize), audioTracks = try await asset.loadTracks(withMediaType: .audio), bytes = try size(url)
    guard range.duration.seconds.isFinite, abs(range.duration.seconds-expected) < 0.2, dimensions.width == 720, dimensions.height == 1280,
          bytes > 1024, bytes <= movieLimit, !audio || !audioTracks.isEmpty else { throw invalid("The exported memory movie could not be verified.") }
    for audioTrack in audioTracks { let audioRange = try await audioTrack.load(.timeRange); guard audioRange.end.seconds <= expected+0.2 else { throw invalid("The movie soundtrack extends beyond the picture.") } }
    let reader = try AVAssetReader(asset: asset), output = AVAssetReaderTrackOutput(track: video,outputSettings: nil)
    guard reader.canAdd(output) else { throw invalid("The memory video samples cannot be verified.") }
    reader.add(output); try attach(job,asset: asset,reader: reader)
    guard reader.startReading() else { throw reader.error ?? invalid("The memory video samples are unreadable.") }
    defer { if reader.status == .reading { reader.cancelReading() } }
    var frames = 0, first = Double.infinity, last = 0.0
    while let sample = output.copyNextSampleBuffer() {
      try check(job)
      if CMSampleBufferGetTotalSampleSize(sample) == 0 { continue }
      let time = CMSampleBufferGetPresentationTimeStamp(sample).seconds
      guard time.isFinite, time >= -0.001, time <= expected+0.1 else { throw invalid("The memory video contains invalid timestamps.") }
      first = min(first,time); last = max(last,time); frames += CMSampleBufferGetNumSamples(sample)
      guard frames <= Int(ceil(expected*30))+2 else { throw invalid("The memory movie exceeded its frame limit.") }
    }
    guard reader.status == .completed, frames > 0, first < 0.1, last >= expected-0.15 else { throw invalid("The memory movie’s picture is incomplete.") }
    try check(job); return (range.duration.seconds,bytes)
  }
}
