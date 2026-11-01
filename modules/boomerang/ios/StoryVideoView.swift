import ExpoModulesCore
import AVFoundation
import UIKit

/// Only the next two authorized clips are warmed. Items are transferred once,
/// never written to disk, and discarded on session change or capability expiry.
@MainActor final class StoryVideoWarmPool {
  private final class Entry {
    let uri: String
    let asset: AVURLAsset
    let item: AVPlayerItem
    let player: AVPlayer
    let deadline: TimeInterval
    var observation: NSKeyValueObservation?
    var prerollStarted = false
    init(uri: String, url: URL, deadline: TimeInterval) {
      self.uri = uri; self.deadline = deadline
      let preparedAsset = AVURLAsset(url: url)
      let preparedItem = AVPlayerItem(asset: preparedAsset)
      asset = preparedAsset; item = preparedItem
      player = AVPlayer(playerItem: preparedItem)
      item.preferredForwardBufferDuration = 3
      player.isMuted = true
    }
    func detach() {
      observation = nil; player.cancelPendingPrerolls(); player.pause()
      player.replaceCurrentItem(with: nil)
    }
  }
  private static var scope = ""
  private static var entries: [Entry] = []
  static func clear() {
    entries.forEach { $0.detach() }; entries.removeAll(); scope = ""
  }
  static func warm(uri: String, session: String, expiresAt: Double) {
    guard !session.isEmpty, let url = URL(string: uri), url.scheme == "https" else { return }
    if scope != session { clear(); scope = session }
    let now = Date().timeIntervalSince1970
    let deadline = min(now + 20, expiresAt.isFinite && expiresAt > 0 ? expiresAt / 1000 - 5 : now + 20)
    guard deadline > now else { return }
    entries.removeAll { entry in
      if entry.deadline <= now { entry.detach(); return true }; return false
    }
    guard !entries.contains(where: { $0.uri == uri }) else { return }
    if entries.count >= 2 { entries.removeFirst().detach() }
    let entry = Entry(uri: uri, url: url, deadline: deadline)
    entries.append(entry)
    entry.observation = entry.player.observe(\.status, options: [.initial, .new]) { [weak entry] _, _ in
      DispatchQueue.main.async {
        guard let entry, entries.contains(where: { $0 === entry }), entry.player.status == .readyToPlay,
          !entry.prerollStarted, entry.player.rate == 0 else { return }
        entry.prerollStarted = true
        entry.player.preroll(atRate: 1, completionHandler: nil)
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + max(0, deadline - now)) { [weak entry] in
      guard let entry, let index = entries.firstIndex(where: { $0 === entry }) else { return }
      entries.remove(at: index).detach()
    }
  }
  static func take(_ uri: String) -> (asset: AVURLAsset, item: AVPlayerItem)? {
    guard let index = entries.firstIndex(where: { $0.uri == uri }) else { return nil }
    let entry = entries.remove(at: index)
    entry.detach()
    guard entry.deadline > Date().timeIntervalSince1970 else { return nil }
    return (entry.asset, entry.item)
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
  private var generation = 0
  private var loadedURI: String?
  private var loadedRevision = -1
  private var renderedMatrix: [Double] = []
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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    layer.addSublayer(playerLayer)
    displayStatus = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] layer, _ in
      guard let self, layer.isReadyForDisplay else { return }; let expected = self.generation
      DispatchQueue.main.async { [weak self] in self?.reportFirstFrame(expected) }
    }
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
      notifications.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in if name == UIApplication.didBecomeActiveNotification { self?.syncPlayback() } else { self?.player.pause() } })
    }
    notifications.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      guard let self, let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
      if value == AVAudioSession.InterruptionType.began.rawValue { self.interruption = true }
      else { self.interruption = !AVAudioSession.InterruptionOptions(rawValue: notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0).contains(.shouldResume) }
      self.syncPlayback()
    })
  }

  override func layoutSubviews() { super.layoutSubviews(); playerLayer.frame = bounds }
  override func didMoveToWindow() { super.didMoveToWindow(); syncPlayback() }
  func update() {
    playerLayer.videoGravity = fit == "cover" ? .resizeAspectFill : .resizeAspect
    player.isMuted = muted; player.volume = Float(max(0, min(1, volume.isFinite ? volume : 1)))
    if loadedURI != uri || loadedRevision != reloadRevision { load() }
    if renderedMatrix != matrix, let item = player.currentItem { applyGrade(item) }
    player.currentItem?.audioTimePitchAlgorithm = preservesPitch ? .spectral : .varispeed
    if appliedSeek != seekRevision, seekSeconds.isFinite, player.currentItem?.status == .readyToPlay {
      appliedSeek = seekRevision
      let expected = generation, expectedSeek = appliedSeek
      if seekSeconds <= 0.001 && player.currentTime().seconds <= 0.001 {
        initialSeekCompleted = true; playerLayer.player = player; reportFirstFrame(expected)
      } else {
        // Keep the layer detached until the saved trim is applied. A warmed
        // item can already have frame zero decoded when it enters the viewer.
        if !initialSeekCompleted { playerLayer.player = nil }
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
  }
  private func syncPlayback() {
    guard initialSeekCompleted, !paused, !interruption, window != nil, UIApplication.shared.applicationState == .active, player.currentItem?.status == .readyToPlay else { player.pause(); return }
    player.playImmediately(atRate: Float(max(0.25, min(4, rate.isFinite ? rate : 1))))
  }
  private func reportFirstFrame(_ expected: Int) {
    guard expected == generation, initialSeekCompleted, !firstFrameReported,
      playerLayer.isReadyForDisplay, player.currentItem?.status == .readyToPlay else { return }
    firstFrameReported = true
    onPlayback(["type": "firstFrame"])
  }
  private func applyGrade(_ item: AVPlayerItem) {
    let values = matrix
    guard values.count == 20, values.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { return }
    renderedMatrix = values
    // A neutral look needs no Core Image composition or second decode/render
    // pipeline. Most stories and memory pages take this hardware-only path.
    if zip(values, StoryVideoPixels.identity).allSatisfy({ pair in abs(pair.0 - pair.1) < 0.000001 }) {
      item.videoComposition = nil
      return
    }
    item.videoComposition = AVVideoComposition(asset: item.asset, applyingCIFiltersWithHandler: { request in
      request.finish(with: StoryVideoPixels.matrix(request.sourceImage, values).cropped(to: request.sourceImage.extent), context: StoryVideoPixels.context)
    })
  }
  private func load() {
    generation += 1; let expected = generation
    loadedURI = uri; loadedRevision = reloadRevision; appliedSeek = -1; renderedMatrix = []; loadTask?.cancel()
    initialSeekCompleted = false; firstFrameReported = false
    player.pause(); playerLayer.player = nil; itemStatus = nil; player.replaceCurrentItem(with: nil)
    guard !uri.isEmpty else { onPlayback(["type": "statusChange", "status": "idle"]); return }
    guard let url = URL(string: uri), url.isFileURL || url.scheme == "https" else { onPlayback(["type": "statusChange", "status": "error", "error": "This video URL is unsupported."]); return }
    onPlayback(["type": "statusChange", "status": "loading"])
    let prepared = StoryVideoWarmPool.take(uri)
    let asset = prepared?.asset ?? AVURLAsset(url: url)
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
          let item = prepared?.item ?? AVPlayerItem(asset: asset)
          item.preferredForwardBufferDuration = 3
          self.applyGrade(item)
          self.player.replaceCurrentItem(with: item)
          self.itemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            DispatchQueue.main.async {
              guard let self, expected == self.generation else { return }
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
    generation += 1; loadTask?.cancel(); player.pause(); player.replaceCurrentItem(with: nil)
    if let observer = timeObserver { player.removeTimeObserver(observer) }
    notifications.forEach(NotificationCenter.default.removeObserver)
  }
}
