import ExpoModulesCore
import AVFoundation
import UIKit

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
      DispatchQueue.main.async { [weak self] in guard let self, expected == self.generation, self.player.currentItem?.status == .readyToPlay else { return }; self.onPlayback(["type": "firstFrame"]) }
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
    if appliedSeek != seekRevision, seekSeconds.isFinite, player.currentItem != nil {
      appliedSeek = seekRevision
      player.seek(to: CMTime(seconds: max(0, seekSeconds), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    syncPlayback()
  }
  private func syncPlayback() {
    guard !paused, !interruption, window != nil, UIApplication.shared.applicationState == .active, player.currentItem?.status == .readyToPlay else { player.pause(); return }
    player.playImmediately(atRate: Float(max(0.25, min(4, rate.isFinite ? rate : 1))))
  }
  private func applyGrade(_ item: AVPlayerItem) {
    let values = matrix
    guard values.count == 20, values.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { return }
    renderedMatrix = values
    item.videoComposition = AVVideoComposition(asset: item.asset, applyingCIFiltersWithHandler: { request in
      request.finish(with: StoryVideoPixels.matrix(request.sourceImage, values).cropped(to: request.sourceImage.extent), context: StoryVideoPixels.context)
    })
  }
  private func load() {
    generation += 1; let expected = generation
    loadedURI = uri; loadedRevision = reloadRevision; appliedSeek = -1; renderedMatrix = []; loadTask?.cancel()
    player.pause(); itemStatus = nil; player.replaceCurrentItem(with: nil)
    guard !uri.isEmpty else { onPlayback(["type": "statusChange", "status": "idle"]); return }
    guard let url = URL(string: uri), url.isFileURL || url.scheme == "https" else { onPlayback(["type": "statusChange", "status": "error", "error": "This video URL is unsupported."]); return }
    onPlayback(["type": "statusChange", "status": "loading"])
    let asset = AVURLAsset(url: url)
    loadTask = Task { [weak self] in
      do {
        let playable = try await asset.load(.isPlayable)
        let duration = try await asset.load(.duration)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard !Task.isCancelled else { return }
        await MainActor.run {
          guard let self, expected == self.generation else { return }
          guard playable, !tracks.isEmpty, duration.seconds.isFinite, duration.seconds > 0 else { self.onPlayback(["type": "statusChange", "status": "error", "error": "This video could not be read."]); return }
          let item = AVPlayerItem(asset: asset)
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
