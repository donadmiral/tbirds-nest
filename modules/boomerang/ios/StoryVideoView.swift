import ExpoModulesCore
import AVFoundation
import UIKit

/// Warm metadata for only the next two authorized clips. AVPlayerItem owns
/// mutable playback state and must never move from a preroll player to a view's
/// player. Only the immutable asset is transferred; every view creates its own
/// item. Nothing is written to disk, and unused assets expire with their scope.
@MainActor final class StoryVideoWarmPool {
  @MainActor private final class Entry {
    let uri: String
    let asset: AVURLAsset
    let deadline: TimeInterval
    var loadTask: Task<Void, Never>?
    init(uri: String, url: URL, deadline: TimeInterval) {
      self.uri = uri; self.deadline = deadline
      asset = AVURLAsset(url: url)
      let asset = self.asset
      loadTask = Task {
        do {
          async let playable = asset.load(.isPlayable)
          async let duration = asset.load(.duration)
          async let tracks = asset.loadTracks(withMediaType: .video)
          _ = try await (playable, duration, tracks)
        } catch { /* The active viewer owns the recoverable loading error. */ }
      }
    }
    func cancel() {
      loadTask?.cancel(); loadTask = nil; asset.cancelLoading()
    }
  }
  private static var scope = ""
  private static var entries: [Entry] = []
  static func clear() {
    entries.forEach { $0.cancel() }; entries.removeAll(); scope = ""
  }
  static func warm(uri: String, session: String, expiresAt: Double) {
    guard !session.isEmpty, let url = URL(string: uri), url.scheme == "https" else { return }
    if scope != session { clear(); scope = session }
    let now = Date().timeIntervalSince1970
    let deadline = min(now + 20, expiresAt.isFinite && expiresAt > 0 ? expiresAt / 1000 - 5 : now + 20)
    guard deadline > now else { return }
    entries.removeAll { entry in
      if entry.deadline <= now { entry.cancel(); return true }; return false
    }
    guard !entries.contains(where: { $0.uri == uri }) else { return }
    if entries.count >= 2 { entries.removeFirst().cancel() }
    let entry = Entry(uri: uri, url: url, deadline: deadline)
    entries.append(entry)
    DispatchQueue.main.asyncAfter(deadline: .now() + max(0, deadline - now)) { [weak entry] in
      guard let entry, let index = entries.firstIndex(where: { $0 === entry }) else { return }
      entries.remove(at: index).cancel()
    }
  }
  static func take(_ uri: String) -> AVURLAsset? {
    guard let index = entries.firstIndex(where: { $0.uri == uri }) else { return nil }
    let entry = entries.remove(at: index)
    guard entry.deadline > Date().timeIntervalSince1970 else { entry.cancel(); return nil }
    // A taken asset belongs to the viewer. Pool expiry/clear must not cancel its
    // in-flight metadata read or the playback loading that follows it.
    entry.loadTask = nil
    return entry.asset
  }
}

/// AVPlayer's decoded frames receive the same grade as the exported composition.
final class StoryVideoView: ExpoView {
  let onPlayback = EventDispatcher()
  private let player = AVPlayer()
  private lazy var playerLayer = AVPlayerLayer(player: player)
  private var itemStatus: NSKeyValueObservation?
  private var displayStatus: NSKeyValueObservation?
  private var timeObserver: Any?
  private var notifications: [NSObjectProtocol] = []
  private var loadTask: Task<Void, Never>?
  private var loadedAsset: AVURLAsset?
  private var generation = 0
  private var loadedURI: String?
  private var loadedRevision = -1
  private var renderedMatrix: [Double] = []
  private var gradeSurface: StoryHLSGradeSurface?
  private var sourceTransform = CGAffineTransform.identity
  private var gradeOutputFailed = false
  private var preparingHLS = false
  private var hlsReadinessStarted = false
  private var appliedSeek = -1
  private var initialSeekCompleted = false
  private var firstFrameReported = false
  private var interruption = false
  var uri = ""
  var matrix = StoryVideoPixels.identity
  var paused = true
  var muted = false
  var volume = 1.0
  var rate = 1.0
  var preservesPitch = true
  var loop = false
  var fit = "contain"
  var seekSeconds = 0.0
  var seekRevision = 0
  var reloadRevision = 0
  var allowsHLSGrade = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    layer.addSublayer(playerLayer)
    timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 20), queue: .main) { [weak self] time in
      guard let self, time.seconds.isFinite else { return }
      self.onPlayback(["type": "timeUpdate", "currentTime": time.seconds, "playing": self.player.rate > 0])
    }
    let center = NotificationCenter.default
    notifications.append(center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] notification in
      guard let self, let item = notification.object as? AVPlayerItem, item === self.player.currentItem else { return }
      self.onPlayback(["type": "playToEnd"])
      if self.loop && !self.paused { self.player.seek(to: .zero) { [weak self] _ in DispatchQueue.main.async { self?.syncPlayback() } } }
    })
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification, UIApplication.didBecomeActiveNotification] {
      notifications.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        if name == UIApplication.didBecomeActiveNotification { self?.syncPlayback() }
        else { self?.player.pause(); self?.gradeSurface?.update(matrix: self?.matrix ?? StoryVideoPixels.identity, fit: self?.fit ?? "contain", active: false) }
      })
    }
    notifications.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
      if value == AVAudioSession.InterruptionType.began.rawValue { self.interruption = true }
      else { self.interruption = !AVAudioSession.InterruptionOptions(rawValue: notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0).contains(.shouldResume) }
      self.syncPlayback()
    })
  }

  override func layoutSubviews() { super.layoutSubviews(); playerLayer.frame = bounds; gradeSurface?.frame = bounds }
  override func didMoveToWindow() { super.didMoveToWindow(); syncPlayback() }
  func update() {
    playerLayer.videoGravity = fit == "cover" ? .resizeAspectFill : .resizeAspect
    player.isMuted = muted; player.volume = Float(max(0, min(1, volume.isFinite ? volume : 1)))
    if loadedURI != uri || loadedRevision != reloadRevision { load() }
    // A stream obtains tracks and duration through its ready player item.
    // Keep its ungraded layer and trim frame hidden during that preparation.
    if preparingHLS { return }
    if renderedMatrix != matrix, let item = player.currentItem { applyGrade(item) }
    player.currentItem?.audioTimePitchAlgorithm = preservesPitch ? .spectral : .varispeed
    if appliedSeek != seekRevision, seekSeconds.isFinite, player.currentItem?.status == .readyToPlay {
      appliedSeek = seekRevision
      let expected = generation, expectedSeek = appliedSeek
      if seekSeconds <= 0.001 && player.currentTime().seconds <= 0.001 {
        initialSeekCompleted = true; playerLayer.player = player; reportFirstFrame(expected)
      } else {
        // Keep frame zero hidden until the saved trim has been applied.
        if !initialSeekCompleted { playerLayer.player = nil }
        initialSeekCompleted = false
        gradeSurface?.resetFrame()
        gradeSurface?.update(matrix: matrix, fit: fit, active: false)
        player.seek(to: CMTime(seconds: max(0, seekSeconds), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
          DispatchQueue.main.async {
            guard let self, finished, expected == self.generation, expectedSeek == self.appliedSeek else { return }
            self.initialSeekCompleted = true; self.playerLayer.player = self.player
            self.reportFirstFrame(expected); self.syncPlayback()
          }
        }
      }
    }
    syncPlayback()
    reportFirstFrame(generation)
  }
  private func syncPlayback() {
    let visible = initialSeekCompleted && !gradeOutputFailed && !interruption && window != nil && UIApplication.shared.applicationState == .active && player.currentItem?.status == .readyToPlay
    guard visible, !paused else { player.pause(); gradeSurface?.update(matrix: matrix, fit: fit, active: visible); return }
    player.playImmediately(atRate: Float(max(0.25, min(4, rate.isFinite ? rate : 1))))
    gradeSurface?.update(matrix: matrix, fit: fit, active: visible)
  }
  private func reportFirstFrame(_ expected: Int) {
    guard expected == generation, initialSeekCompleted, !gradeOutputFailed, !firstFrameReported,
      (gradeSurface?.firstFrameReady ?? playerLayer.isReadyForDisplay), player.currentItem?.status == .readyToPlay else { return }
    firstFrameReported = true
    onPlayback(["type": "firstFrame"])
  }
  private func applyGrade(_ item: AVPlayerItem) {
    let values = matrix
    guard values.count == 20, values.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { return }
    renderedMatrix = values
    // A neutral look needs no Core Image composition or second decode/render
    // pipeline. Most stories and memory pages take this hardware-only path.
    let neutral = zip(values, StoryVideoPixels.identity).allSatisfy({ pair in abs(pair.0 - pair.1) < 0.000001 })
    if neutral {
      clearGradeSurface(); playerLayer.isHidden = false
      item.videoComposition = nil
      return
    }
    if URL(string: uri)?.pathExtension.lowercased() == "m3u8" {
      item.videoComposition = nil; playerLayer.isHidden = true
      let expected = generation
      guard allowsHLSGrade else { gradeFailed(expected); return }
      if gradeSurface == nil {
        guard let surface = StoryHLSGradeSurface(player: player, item: item, transform: sourceTransform,
          onFirstFrame: { [weak self] in self?.reportFirstFrame(expected) },
          onFailure: { [weak self] in self?.gradeFailed(expected) }) else { gradeFailed(expected); return }
        surface.frame = bounds; addSubview(surface); gradeSurface = surface
      }
      gradeSurface?.update(matrix: values, fit: fit, active: false)
      return
    }
    clearGradeSurface(); playerLayer.isHidden = false
    item.videoComposition = AVVideoComposition(asset: item.asset, applyingCIFiltersWithHandler: { request in
      request.finish(with: StoryVideoPixels.matrix(request.sourceImage, values).cropped(to: request.sourceImage.extent), context: StoryVideoPixels.context)
    })
  }
  private func clearGradeSurface() { gradeSurface?.stop(); gradeSurface?.removeFromSuperview(); gradeSurface = nil }
  private func gradeFailed(_ expected: Int) {
    guard expected == generation, !gradeOutputFailed else { return }
    gradeOutputFailed = true; player.pause(); clearGradeSurface()
    // The JS controller retries the same authorized source as a graded file.
    // Never expose the ungraded HLS layer when the output pipeline fails.
    playerLayer.isHidden = true
    onPlayback(["type": "statusChange", "status": "error", "error": "This video needs its original playback format."])
  }
  private func loadHLS(_ asset: AVURLAsset, expected: Int) {
    preparingHLS = true; hlsReadinessStarted = false; playerLayer.isHidden = true
    let item = AVPlayerItem(asset: asset)
    item.preferredForwardBufferDuration = 3
    // Observe before association. AVPlayer starts resolving HLS media when it
    // receives the item, so AVAsset's earlier empty tracks are not a failure.
    itemStatus = item.observe(\.status, options: [.initial, .new]) { @Sendable [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self, expected == self.generation, self.player.currentItem === item else { return }
        if item.status == .failed {
          self.onPlayback(["type": "statusChange", "status": "error", "error": item.error?.localizedDescription ?? "This video could not play."])
        } else if item.status == .readyToPlay, !self.hlsReadinessStarted {
          self.hlsReadinessStarted = true
          self.loadTask = Task { @MainActor [weak self] in
            do {
              let track = item.tracks.compactMap { $0.assetTrack }.first { $0.mediaType == .video }
              let transform: CGAffineTransform
              if let track { transform = try await track.load(.preferredTransform) }
              else { transform = .identity }
              guard !Task.isCancelled, let self, expected == self.generation, self.player.currentItem === item else { return }
              let duration = item.duration.seconds
              guard duration.isFinite, duration > 0 else {
                self.onPlayback(["type": "statusChange", "status": "error", "error": "This video could not be read."]); return
              }
              self.sourceTransform = transform; self.preparingHLS = false
              self.applyGrade(item)
              guard !self.gradeOutputFailed else { return }
              self.onPlayback(["type": "statusChange", "status": "readyToPlay", "duration": duration])
              self.update()
            } catch {
              guard !Task.isCancelled, let self, expected == self.generation, self.player.currentItem === item else { return }
              self.onPlayback(["type": "statusChange", "status": "error", "error": error.localizedDescription])
            }
          }
        }
      }
    }
    player.replaceCurrentItem(with: item)
  }
  private func load() {
    generation += 1; let expected = generation
    loadedURI = uri; loadedRevision = reloadRevision; appliedSeek = -1; renderedMatrix = []; loadTask?.cancel()
    initialSeekCompleted = false; firstFrameReported = false; preparingHLS = false; hlsReadinessStarted = false
    player.pause(); clearGradeSurface(); sourceTransform = .identity; gradeOutputFailed = false; playerLayer.isHidden = false
    displayStatus = nil; playerLayer.player = nil; itemStatus = nil; player.replaceCurrentItem(with: nil)
    loadedAsset?.cancelLoading(); loadedAsset = nil
    guard !uri.isEmpty else { onPlayback(["type": "statusChange", "status": "idle"]); return }
    guard let url = URL(string: uri), url.isFileURL || url.scheme == "https" else { onPlayback(["type": "statusChange", "status": "error", "error": "This video URL is unsupported."]); return }
    onPlayback(["type": "statusChange", "status": "loading"])
    // KVO may arrive on AVFoundation's worker queue. Capture only this load's
    // immutable generation there; read the layer and view on the main queue.
    displayStatus = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { @Sendable [weak self] _, _ in
      DispatchQueue.main.async { [weak self] in self?.reportFirstFrame(expected) }
    }
    let asset = StoryVideoWarmPool.take(uri) ?? AVURLAsset(url: url)
    loadedAsset = asset
    if url.pathExtension.lowercased() == "m3u8" { loadHLS(asset, expected: expected); return }
    loadTask = Task { [weak self] in
      do {
        async let playableLoad = asset.load(.isPlayable)
        async let durationLoad = asset.load(.duration)
        async let tracksLoad = asset.loadTracks(withMediaType: .video)
        let (playable, duration, tracks) = try await (playableLoad, durationLoad, tracksLoad)
        guard !Task.isCancelled else { return }
        await MainActor.run {
          guard let self, expected == self.generation else { return }
          guard playable, !tracks.isEmpty, duration.seconds.isFinite, duration.seconds > 0 else { self.onPlayback(["type": "statusChange", "status": "error", "error": "This video could not be read."]); return }
          let item = AVPlayerItem(asset: asset)
          self.sourceTransform = .identity
          item.preferredForwardBufferDuration = 3
          self.applyGrade(item)
          guard !self.gradeOutputFailed else { return }
          self.player.replaceCurrentItem(with: item)
          self.itemStatus = item.observe(\.status, options: [.initial, .new]) { @Sendable [weak self] _, _ in
            DispatchQueue.main.async {
              guard let self, expected == self.generation, let item = self.player.currentItem else { return }
              if item.status == .readyToPlay {
                self.onPlayback(["type": "statusChange", "status": "readyToPlay", "duration": duration.seconds])
                self.update()
              } else if item.status == .failed { self.onPlayback(["type": "statusChange", "status": "error", "error": item.error?.localizedDescription ?? "This video could not play."]) }
            }
          }
          self.update()
        }
      } catch {
        guard !Task.isCancelled else { return }
        await MainActor.run { [weak self] in guard let self, expected == self.generation else { return }; self.onPlayback(["type": "statusChange", "status": "error", "error": error.localizedDescription]) }
      }
    }
  }
  deinit {
    generation += 1; loadTask?.cancel(); player.pause(); player.replaceCurrentItem(with: nil); loadedAsset?.cancelLoading()
    if let observer = timeObserver { player.removeTimeObserver(observer) }
    notifications.forEach(NotificationCenter.default.removeObserver)
  }
}
