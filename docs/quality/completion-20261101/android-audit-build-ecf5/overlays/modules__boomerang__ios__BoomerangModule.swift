import ExpoModulesCore
import AVFoundation
import CoreMedia
import CoreVideo
import UIKit

public class BoomerangModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Boomerang")

    Constant("storyVideoVersion") { 1 }
    Constant("storyAudioExportVersion") { 1 }
    // Activated only after the whole-book generated-file acceptance gate passes.
    Constant("memoryMovieVersion") { 1 }
    AsyncFunction("composeMemoryMovie") { (request: [String: Any]) async throws -> [String: Any] in
      try await MemoryMovieComposition.make(request)
    }
    AsyncFunction("prepareMemoryMovieImage") { (request: [String: Any]) async throws -> [String: Any] in
      try await MemoryMovieComposition.prepareImage(request)
    }
    AsyncFunction("cancelMemoryMovie") { (id: String) in MemoryMovieComposition.cancel(id) }
    AsyncFunction("composeStory") { (request: [String: Any]) async throws -> [String: Any] in
      try await StoryVideoComposition.make(request)
    }
    AsyncFunction("cancelStoryComposition") { (id: String) in StoryVideoComposition.cancel(id) }
    View(StoryVideoView.self) {
      Events("onPlayback")
      Prop("uri") { (view: StoryVideoView, value: String) in view.uri = value }
      Prop("matrix") { (view: StoryVideoView, value: [Double]) in view.matrix = value }
      Prop("paused") { (view: StoryVideoView, value: Bool) in view.paused = value }
      Prop("muted") { (view: StoryVideoView, value: Bool) in view.muted = value }
      Prop("volume") { (view: StoryVideoView, value: Double) in view.volume = value }
      Prop("rate") { (view: StoryVideoView, value: Double) in view.rate = value }
      Prop("preservesPitch") { (view: StoryVideoView, value: Bool) in view.preservesPitch = value }
      Prop("loop") { (view: StoryVideoView, value: Bool) in view.loop = value }
      Prop("fit") { (view: StoryVideoView, value: String) in view.fit = value }
      Prop("seekSeconds") { (view: StoryVideoView, value: Double) in view.seekSeconds = value }
      Prop("seekRevision") { (view: StoryVideoView, value: Int) in view.seekRevision = value }
      Prop("reloadRevision") { (view: StoryVideoView, value: Int) in view.reloadRevision = value }
      OnViewDidUpdateProps { (view: StoryVideoView) in view.update() }
    }

    AsyncFunction("make") { (input: String, output: String, loops: Int) -> String in
      let id = try BoomerangWriter.createJob()
      try BoomerangWriter.make(id: id, input: input, output: output, loops: max(1, min(3, loops)))
      return output
    }.runOnQueue(.global(qos: .userInitiated))
    // Reserve synchronously so cancelling before the encoder queue starts is safe.
    Function("createBoomerangJob") { try BoomerangWriter.createJob() }
    Function("cancelBoomerang") { (id: String) in BoomerangWriter.cancel(id) }
    AsyncFunction("makeCancellable") { (id: String, input: String, output: String, loops: Int) -> String in
      try BoomerangWriter.make(id: id, input: input, output: output, loops: max(1, min(3, loops)))
      return output
    }.runOnQueue(.global(qos: .userInitiated))
  }
}

enum BoomerangError: Error, LocalizedError {
  case noVideoTrack
  case readerFailed(String)
  case writerFailed(String)
  case cancelled
  case timedOut
  case busy
  var errorDescription: String? {
    switch self {
    case .noVideoTrack: return "The clip has no video track."
    case .readerFailed(let m): return "Could not read the clip: \(m)"
    case .writerFailed(let m): return "Could not write the boomerang: \(m)"
    case .cancelled: return "Boomerang encoding was cancelled."
    case .timedOut: return "Boomerang encoding took too long."
    case .busy: return "Another Boomerang is still stopping. Try again shortly."
    }
  }
}

fileprivate final class BoomerangJob {
  let id: String
  let deadline = DispatchTime.now() + .seconds(20)
  private let lock = NSLock()
  private let writerLock = NSLock()
  private let readerLock = NSLock()
  private var started = false, cancelled = false, completed = false, disposingWriter = false, writerStopped = false
  private var asset: AVAsset?, reader: AVAssetReader?, writer: AVAssetWriter?, staging: URL?
  private var timeout: DispatchWorkItem?, backgroundObserver: NSObjectProtocol?
  private let cleanupDone = DispatchSemaphore(value: 0)
  init(id: String) { self.id = id }

  func arm(_ cancel: @escaping () -> Void) {
    let work = DispatchWorkItem(block: cancel)
    timeout = work
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: deadline, execute: work)
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in cancel() }
  }
  deinit {
    timeout?.cancel()
    if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
  }
  func start() throws {
    lock.lock(); defer { lock.unlock() }
    guard !started, !cancelled, DispatchTime.now() < deadline else { throw BoomerangError.cancelled }
    started = true
  }
  func check() throws {
    if DispatchTime.now() >= deadline { _ = cancel(); throw BoomerangError.timedOut }
    lock.lock(); let stopped = cancelled; lock.unlock()
    if stopped { throw BoomerangError.cancelled }
  }
  func attach(_ value: AVAsset) throws {
    lock.lock(); asset = value; lock.unlock()
    try check()
  }
  func attach(_ value: AVAssetReader) throws {
    lock.lock(); reader = value; lock.unlock()
    try check()
  }
  func detach(_ value: AVAssetReader) {
    lock.lock(); if reader === value { reader = nil }; lock.unlock()
  }
  func attach(_ value: AVAssetWriter, staging: URL) throws {
    lock.lock(); writer = value; self.staging = staging; let stopped = cancelled; lock.unlock()
    // Cancellation may have arrived while the writer was being constructed.
    if stopped { _ = cancel() }
    try check()
  }
  func write<T>(_ body: () throws -> T) throws -> T {
    writerLock.lock(); defer { writerLock.unlock() }
    try check()
    return try body()
  }
  func prepareReader(_ body: () throws -> Void) throws {
    readerLock.lock(); defer { readerLock.unlock() }
    try check()
    try body()
  }
  var canRelease: Bool {
    lock.lock(); defer { lock.unlock() }
    return !disposingWriter || writerStopped
  }
  @discardableResult func cancel() -> Bool {
    lock.lock()
    let wasStarted = started
    if completed { lock.unlock(); return wasStarted }
    cancelled = true
    let source = asset, input = reader
    let output = disposingWriter ? nil : writer, partial = staging
    if output != nil { disposingWriter = true }
    lock.unlock()
    // AVFoundation cancellation can block. It must not hold the state lock or
    // block the JavaScript/native promise from rejecting at its deadline.
    if source != nil || input != nil {
      DispatchQueue.global(qos: .utility).async {
        source?.cancelLoading()
        self.readerLock.lock(); input?.cancelReading(); self.readerLock.unlock()
      }
    }
    if let output {
      DispatchQueue.global(qos: .utility).async {
        self.writerLock.lock()
        output.cancelWriting()
        // cancelWriting returns only after pending writes stop. Until then the
        // unique staging path is retained, never unlinked under an active writer.
        if let partial { try? FileManager.default.removeItem(at: partial) }
        self.writerLock.unlock()
        self.lock.lock(); self.writerStopped = true; self.lock.unlock()
        self.cleanupDone.signal()
        BoomerangWriter.finish(self.id, self)
      }
    }
    return wasStarted
  }
  func waitForCleanup() {
    lock.lock(); let pending = disposingWriter; lock.unlock()
    if pending { _ = cleanupDone.wait(timeout: .now() + .milliseconds(500)) }
  }
  func publish(to destination: URL) throws {
    lock.lock(); defer { lock.unlock() }
    guard !cancelled, DispatchTime.now() < deadline else { throw BoomerangError.cancelled }
    guard let partial = staging, writer?.status == .completed,
          let bytes = try FileManager.default.attributesOfItem(atPath: partial.path)[.size] as? NSNumber,
          bytes.int64Value > 0 else { throw BoomerangError.writerFailed("empty or unfinished output") }
    // Move only a completed file. A late finish callback cannot publish or
    // delete a newer result; it only signals its own job's semaphore.
    try FileManager.default.moveItem(at: partial, to: destination)
    completed = true
  }
}

enum BoomerangWriter {
  static let fps: Int32 = 30
  static let chunk: Double = 0.5
  private static let jobsLock = NSLock()
  private static var jobs: [String: BoomerangJob] = [:]

  static func createJob() throws -> String {
    jobsLock.lock()
    guard jobs.isEmpty else { jobsLock.unlock(); throw BoomerangError.busy }
    let id = UUID().uuidString
    let job = BoomerangJob(id: id)
    jobs[id] = job
    jobsLock.unlock()
    job.arm { cancel(id) }
    return id
  }
  static func cancel(_ id: String) {
    jobsLock.lock(); let job = jobs[id]; jobsLock.unlock()
    if let job, !job.cancel() { finish(id, job) }
  }
  fileprivate static func finish(_ id: String, _ job: BoomerangJob) {
    guard job.canRelease else { return }
    jobsLock.lock(); if jobs[id] === job { jobs.removeValue(forKey: id) }; jobsLock.unlock()
  }

  static func toURL(_ s: String) -> URL {
    if let u = URL(string: s), u.scheme != nil { return u }
    return URL(fileURLWithPath: s)
  }

  static func make(id: String, input: String, output: String, loops: Int) throws {
    jobsLock.lock(); let reserved = jobs[id]; jobsLock.unlock()
    guard let job = reserved else { throw BoomerangError.cancelled }
    defer { finish(id, job) }
    do {
      try job.start()
      try render(job: job, input: input, output: output, loops: loops)
    } catch {
      job.cancel()
      job.waitForCleanup()
      throw error
    }
  }

  private static func render(job: BoomerangJob, input: String, output: String, loops: Int) throws {
    let inURL = toURL(input).standardizedFileURL.resolvingSymlinksInPath()
    let outURL = toURL(output).standardizedFileURL.resolvingSymlinksInPath()
    let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath().path + "/"
    guard inURL.isFileURL, outURL.isFileURL, inURL != outURL,
          FileManager.default.fileExists(atPath: inURL.path), outURL.path.hasPrefix(cache),
          outURL.lastPathComponent.hasPrefix("boom-"), outURL.pathExtension == "mp4",
          !FileManager.default.fileExists(atPath: outURL.path) else {
      throw BoomerangError.writerFailed("choose a new Boomerang file in the app cache")
    }
    let staging = outURL.deletingLastPathComponent().appendingPathComponent("boom-partial-" + UUID().uuidString + ".mp4")
    try job.check()

    let asset = AVURLAsset(url: inURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    try job.attach(asset)
    guard let track = asset.tracks(withMediaType: .video).first else { throw BoomerangError.noVideoTrack }
    let total = CMTimeGetSeconds(asset.duration)
    try job.check()
    guard total.isFinite, total > 0.1, total <= 5 else { throw BoomerangError.readerFailed("clip must be between 0.1 and 5 seconds") }

    // The composition applies the recording's rotation, so frames come out
    // upright and the writer never has to know about transforms.
    let composition = AVMutableVideoComposition(propertiesOf: asset)
    composition.frameDuration = CMTime(value: 1, timescale: fps)
    guard composition.renderSize.width.isFinite, composition.renderSize.height.isFinite,
          composition.renderSize.width <= 4096, composition.renderSize.height <= 4096 else { throw BoomerangError.readerFailed("invalid render size") }
    let width = Int(composition.renderSize.width.rounded(.down)) & ~1
    let height = Int(composition.renderSize.height.rounded(.down)) & ~1
    guard width > 0, height > 0 else { throw BoomerangError.readerFailed("empty render size") }

    let writer = try AVAssetWriter(outputURL: staging, fileType: .mp4)
    try job.attach(writer, staging: staging)
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 6_000_000,
        AVVideoExpectedSourceFrameRateKey: 30,
      ],
    ]
    let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    writerInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: writerInput, sourcePixelBufferAttributes: nil)
    try job.write {
      guard writer.canAdd(writerInput) else { throw BoomerangError.writerFailed("input rejected") }
      writer.add(writerInput)
      guard writer.startWriting() else { throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "start failed") }
      writer.startSession(atSourceTime: .zero)
    }

    var frame: Int64 = 0
    func checkWriter() throws {
      try job.check()
      guard writer.status == .writing else { throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "writer stopped") }
    }
    func append(_ pixels: CVPixelBuffer) throws {
      try checkWriter()
      while !writerInput.isReadyForMoreMediaData {
        try checkWriter()
        Thread.sleep(forTimeInterval: 0.003)
      }
      try checkWriter()
      try job.write {
        try checkWriter()
        if !adaptor.append(pixels, withPresentationTime: CMTime(value: frame, timescale: fps)) {
          throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "append failed")
        }
      }
      frame += 1
    }

    // One time range, decoded upright. The sample buffers are kept alive for
    // the chunk so the reader's pool cannot recycle them while we reverse.
    func read(_ start: Double, _ end: Double) throws -> [CMSampleBuffer] {
      try job.check()
      let reader = try AVAssetReader(asset: asset)
      try job.attach(reader)
      defer {
        job.detach(reader)
        if reader.status == .reading { DispatchQueue.global(qos: .utility).async { reader.cancelReading() } }
      }
      let output = AVAssetReaderVideoCompositionOutput(
        videoTracks: [track],
        videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      )
      output.videoComposition = composition
      output.alwaysCopiesSampleData = true
      try job.prepareReader {
        guard reader.canAdd(output) else { throw BoomerangError.readerFailed("output rejected") }
        reader.add(output)
        reader.timeRange = CMTimeRange(
          start: CMTime(seconds: start, preferredTimescale: 600),
          end: CMTime(seconds: end, preferredTimescale: 600)
        )
        guard reader.startReading() else { throw BoomerangError.readerFailed(reader.error?.localizedDescription ?? "start failed") }
      }
      var frames: [CMSampleBuffer] = []
      while true {
        try job.check()
        guard let sample = output.copyNextSampleBuffer() else { break }
        if CMSampleBufferGetImageBuffer(sample) != nil { frames.append(sample) }
      }
      try job.check()
      guard reader.status == .completed else { throw BoomerangError.readerFailed(reader.error?.localizedDescription ?? "decoding stopped") }
      return frames
    }

    let starts = Array(stride(from: 0.0, to: total, by: chunk))
    for _ in 0..<loops {
      for s in starts {
        for sample in try read(s, min(total, s + chunk)) {
          if let pixels = CMSampleBufferGetImageBuffer(sample) { try append(pixels) }
        }
      }
      for s in starts.reversed() {
        for sample in try read(s, min(total, s + chunk)).reversed() {
          if let pixels = CMSampleBufferGetImageBuffer(sample) { try append(pixels) }
        }
      }
    }
    guard frame > 1 else { throw BoomerangError.readerFailed("no frames decoded") }

    let done = DispatchSemaphore(value: 0)
    try job.write {
      try checkWriter()
      writerInput.markAsFinished()
      writer.finishWriting { done.signal() }
    }
    while done.wait(timeout: .now() + .milliseconds(50)) != .success {
      try job.check()
      if writer.status == .failed || writer.status == .cancelled {
        throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "finalization stopped")
      }
    }
    try job.check()
    if writer.status != .completed {
      throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "status \(writer.status.rawValue)")
    }
    try job.publish(to: outURL)
  }
}
