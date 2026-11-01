import UIKit
import AVFoundation
import ExpoModulesCore
import Darwin

private enum PlaybackFixtureError: Error, LocalizedError {
  case failed(String)
  var errorDescription: String? { if case .failed(let value) = self { return value }; return nil }
}

@MainActor private func requirePlayback(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw PlaybackFixtureError.failed(message) }
}

@MainActor private final class ObservedView {
  let view = StoryVideoView()
  var events: [[String: Any]] = []
  var violation: String?
  var trim = 0.0
  var layer: AVPlayerLayer? { view.layer.sublayers?.compactMap { $0 as? AVPlayerLayer }.first }
  var player: AVPlayer? { layer?.player }
  var frames: [[String: Any]] { events.filter { $0["type"] as? String == "firstFrame" } }
  var failure: String? {
    events.first { $0["status"] as? String == "error" }?["error"] as? String
  }

  init(in container: UIView) {
    view.frame = container.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.muted = true
    view.onPlayback.fixtureListener = { [weak self] value in
      guard let self else { return }
      guard Thread.isMainThread else { self.violation = "Playback event arrived off the main thread"; return }
      var event = value
      event["expectedURI"] = self.view.uri
      event["at"] = ProcessInfo.processInfo.systemUptime
      if value["type"] as? String == "firstFrame" {
        let item = self.player?.currentItem
        let actual = (item?.asset as? AVURLAsset)?.url.absoluteString
        let time = self.player?.currentTime().seconds ?? -1
        event["actualURI"] = actual ?? "missing"
        event["currentTime"] = time
        event["readyForDisplay"] = self.layer?.isReadyForDisplay ?? false
        if actual != self.view.uri { self.violation = "First frame belongs to a different URL" }
        if !time.isFinite || time < self.trim - 0.06 { self.violation = "First frame preceded the requested trim" }
        if item?.status != .readyToPlay || self.layer?.isReadyForDisplay != true {
          self.violation = "First-frame event did not have a decoded native display frame"
        }
      }
      self.events.append(event)
    }
    container.addSubview(view)
    view.layoutIfNeeded()
  }

  func load(_ uri: String, trim: Double = 0, playing: Bool = false) {
    self.trim = trim
    view.uri = uri
    view.seekSeconds = trim
    view.seekRevision += 1
    view.paused = !playing
    view.update()
  }

  func close() {
    view.paused = true
    view.uri = ""
    view.update()
    view.removeFromSuperview()
    view.onPlayback.fixtureListener = nil
  }
}

@MainActor private final class WeakStoryView {
  weak var view: StoryVideoView?
  init(_ view: StoryVideoView) { self.view = view }
}

@MainActor private enum StoryPlaybackFixture {
  static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  static var results: [[String: Any]] = []
  static var diagnostics: [[String: Any]] = []
  static var stage = "starting"
  static var origin: String { Bundle.main.object(forInfoDictionaryKey: "StoryFixtureOrigin") as! String }
  static func uri(_ name: String) -> String { origin + "/" + name + ".mp4" }
  static var expiration: Double { (Date().timeIntervalSince1970 + 60) * 1000 }

  static func receipt(passed: Bool, error: String? = nil) {
    var value: [String: Any] = [
      "schemaVersion": 1, "passed": passed, "stage": stage, "cases": results,
      "diagnostics": diagnostics, "nativePlayer": "unmodified production StoryVideoView and StoryVideoWarmPool",
      "bridgeBoundary": "ExpoView/EventDispatcher host adapter; React Native bridge is not executed",
    ]
    if let error { value["error"] = error }
    if let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
      try? bytes.write(to: documents.appendingPathComponent("story-playback-receipt.json"), options: .atomic)
    }
  }

  static func phase(_ value: String) {
    let data = try! JSONSerialization.data(withJSONObject: ["phase": value, "at": Date().timeIntervalSince1970])
    try? data.write(to: documents.appendingPathComponent("story-playback-phase.json"), options: .atomic)
    print("STORY_PLAYBACK_PHASE " + value)
    fflush(stdout)
  }

  static func wait(_ message: String, timeout: Double = 15, until: () -> Bool) async throws {
    let deadline = ProcessInfo.processInfo.systemUptime + timeout
    while !until() {
      if ProcessInfo.processInfo.systemUptime >= deadline { throw PlaybackFixtureError.failed(message) }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
  }

  static func ready(_ observed: ObservedView, frames: Int = 1) async throws {
    try await wait("The actual native player did not display a frame", until: {
      observed.frames.count >= frames || observed.failure != nil || observed.violation != nil
    })
    try requirePlayback(observed.failure == nil, observed.failure ?? "Native playback failed")
    try requirePlayback(observed.violation == nil, observed.violation ?? "Native playback ownership failed")
    try requirePlayback(observed.frames.count >= frames, "No actual first frame")
  }

  static func record(_ name: String, _ body: () async throws -> [String: Any]) async throws {
    stage = name
    receipt(passed: false)
    print("STORY_PLAYBACK_CASE " + name)
    fflush(stdout)
    let started = ProcessInfo.processInfo.systemUptime
    do {
      let evidence = try await body()
      results.append(["name": name, "passed": true,
        "runtimeSeconds": ProcessInfo.processInfo.systemUptime - started, "evidence": evidence])
      receipt(passed: false)
    } catch {
      results.append(["name": name, "passed": false,
        "runtimeSeconds": ProcessInfo.processInfo.systemUptime - started, "error": error.localizedDescription])
      throw error
    }
  }

  static func run(in container: UIView) async {
    do {
      try await wait("Harness did not become foreground", until: { UIApplication.shared.applicationState == .active })
      try await record("cold native view displays only the requested trimmed frame") {
        let observed = ObservedView(in: container)
        defer { observed.close() }
        let file = Bundle.main.url(forResource: "fixture", withExtension: "mp4")!
        observed.load(file.absoluteString, trim: 0.65)
        try await ready(observed)
        try requirePlayback(observed.frames.count == 1, "Repeated first frame for one load")
        try requirePlayback(observed.player?.currentItem?.videoComposition == nil, "Neutral grade unexpectedly uses Core Image")
        return ["frames": observed.frames]
      }

      try await record("warmed HTTPS handoff repeatedly reaches a real decoded frame") {
        let observed = ObservedView(in: container)
        defer { observed.close(); StoryVideoWarmPool.clear() }
        for index in 0..<12 {
          let source = uri("handoff-\(index)")
          StoryVideoWarmPool.warm(uri: source, session: "handoff", expiresAt: expiration)
          // Exercise both pending preparation and fully active preroll handoff.
          try await Task.sleep(nanoseconds: index % 2 == 0 ? 15_000_000 : 500_000_000)
          observed.load(source, trim: index % 2 == 0 ? 0 : 0.75)
          try await ready(observed, frames: index + 1)
          try requirePlayback(StoryVideoWarmPool.take(source) == nil, "A warm entry was consumable twice")
        }
        return ["handoffs": 12, "frames": observed.frames]
      }

      try await record("two views of one warmed URL never share an AVPlayerItem") {
        let source = uri("same-url")
        StoryVideoWarmPool.warm(uri: source, session: "two-views", expiresAt: expiration)
        try await Task.sleep(nanoseconds: 500_000_000)
        let first = ObservedView(in: container), second = ObservedView(in: container)
        defer { first.close(); second.close(); StoryVideoWarmPool.clear() }
        second.view.matrix[0] = 0.8
        first.load(source, trim: 0.2)
        second.load(source, trim: 0.8)
        try await ready(first); try await ready(second)
        guard let firstItem = first.player?.currentItem, let secondItem = second.player?.currentItem else {
          throw PlaybackFixtureError.failed("Visible views lost their player items")
        }
        try requirePlayback(firstItem !== secondItem, "Two visible AVPlayers share one item")
        try requirePlayback(firstItem.videoComposition == nil && secondItem.videoComposition != nil,
          "Independent neutral and graded views did not retain their own composition")
        return ["first": first.frames, "second": second.frames, "exclusiveItems": true, "gradedSecondView": true]
      }

      try await record("rapid pending source switches cannot report an obsolete frame") {
        let observed = ObservedView(in: container)
        defer { observed.close(); StoryVideoWarmPool.clear() }
        for index in 0..<16 {
          let source = uri(index == 15 ? "rapid-final" : "slow-rapid-\(index)")
          StoryVideoWarmPool.warm(uri: source, session: "rapid", expiresAt: expiration)
          observed.load(source, trim: index == 15 ? 1.1 : 0)
        }
        try await ready(observed)
        try await Task.sleep(nanoseconds: 700_000_000)
        try requirePlayback(observed.violation == nil, observed.violation ?? "Obsolete source callback")
        try requirePlayback(observed.frames.count == 1, "Cancelled loads emitted additional first frames")
        try requirePlayback(observed.frames.first?["actualURI"] as? String == uri("rapid-final"), "Wrong final source")
        return ["switches": 16, "frames": observed.frames]
      }

      try await record("warm pool respects capacity capability expiry scope and explicit clear") {
        StoryVideoWarmPool.clear()
        let a = uri("capacity-a"), b = uri("capacity-b"), c = uri("capacity-c")
        for source in [a, b, c] { StoryVideoWarmPool.warm(uri: source, session: "capacity", expiresAt: expiration) }
        try requirePlayback(StoryVideoWarmPool.take(a) == nil, "Pool retained more than two clips")
        try requirePlayback(StoryVideoWarmPool.take(b) != nil, "Second permitted warm entry missing")
        try requirePlayback(StoryVideoWarmPool.take(c) != nil, "Newest permitted warm entry missing")
        let expired = uri("expiry")
        StoryVideoWarmPool.warm(uri: expired, session: "expiry", expiresAt: (Date().timeIntervalSince1970 + 5.25) * 1000)
        try await Task.sleep(nanoseconds: 550_000_000)
        try requirePlayback(StoryVideoWarmPool.take(expired) == nil, "Expired capability was returned")
        StoryVideoWarmPool.warm(uri: a, session: "account-one", expiresAt: expiration)
        StoryVideoWarmPool.warm(uri: b, session: "account-two", expiresAt: expiration)
        try requirePlayback(StoryVideoWarmPool.take(a) == nil, "Previous account retained its warm entry")
        StoryVideoWarmPool.clear()
        try requirePlayback(StoryVideoWarmPool.take(b) == nil, "Explicit clear retained an entry")
        return ["maximumEntries": 2, "expiredDiscarded": true, "oldScopeDiscarded": true, "clearDiscarded": true]
      }

      try await record("actual background foreground transition pauses playback and clears warm work") {
        let observed = ObservedView(in: container)
        observed.view.loop = true
        defer { observed.close(); StoryVideoWarmPool.clear() }
        observed.load(uri("background-active"), playing: true)
        try await ready(observed)
        try await wait("Visible native playback did not advance", until: { (observed.player?.currentTime().seconds ?? 0) > 0.15 })
        let next = uri("slow-background-next")
        StoryVideoWarmPool.warm(uri: next, session: "background", expiresAt: expiration)
        var didBackground = false, backgroundRate: Float = -1
        let token = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
          // Exercise the explicit native cleanup entry point during a real OS
          // transition. This does not assert that AppState invokes it in the app.
          StoryVideoWarmPool.clear()
          backgroundRate = observed.player?.rate ?? -1
          didBackground = true
          phase("background-observed")
        }
        defer { NotificationCenter.default.removeObserver(token) }
        phase("background-ready")
        try await wait("The host did not background and resume the simulator app", timeout: 35, until: {
          didBackground && UIApplication.shared.applicationState == .active
        })
        try requirePlayback(backgroundRate == 0, "Native player continued during OS background")
        try requirePlayback(StoryVideoWarmPool.take(next) == nil, "Background clear retained an in-flight warm entry")
        try await wait("Native player did not resume after foreground", until: { (observed.player?.rate ?? 0) > 0 })
        phase("foreground-verified")
        return ["actualOSBackground": true, "backgroundRate": backgroundRate, "resumed": true, "clearEntryPointCalled": true]
      }

      try await record("teardown cancels pending loads without retaining native views") {
        var weakViews: [WeakStoryView] = []
        for index in 0..<16 {
          let source = uri("slow-teardown-\(index)")
          StoryVideoWarmPool.warm(uri: source, session: "teardown", expiresAt: expiration)
          var observed: ObservedView? = ObservedView(in: container)
          weakViews.append(WeakStoryView(observed!.view))
          observed!.load(source)
          observed!.close()
          observed = nil
        }
        StoryVideoWarmPool.clear()
        try await wait("Disposed native video views were retained", until: { weakViews.allSatisfy { $0.view == nil } })
        try await Task.sleep(nanoseconds: 800_000_000)
        return ["disposedViews": weakViews.count, "retainedViews": weakViews.filter { $0.view != nil }.count]
      }

      try await record("unsupported and unavailable sources report errors without a process crash") {
        let observed = ObservedView(in: container)
        defer { observed.close() }
        observed.load("http://127.0.0.1/not-authorized.mp4")
        try await wait("Unsupported source did not report an error", until: { observed.failure != nil })
        observed.events.removeAll()
        observed.load(uri("missing"))
        try await wait("Missing source did not report an error", until: { observed.failure != nil })
        try requirePlayback(observed.frames.isEmpty, "Failed source reported a first frame")
        return ["reportedErrors": 2, "frames": 0]
      }
      stage = "completed"
      receipt(passed: true)
      phase("completed")
      print("STORY_PLAYBACK_PASSED \(results.count)")
      fflush(stdout)
      exit(0)
    } catch {
      receipt(passed: false, error: error.localizedDescription)
      phase("failed")
      print("STORY_PLAYBACK_FAILED " + error.localizedDescription)
      fflush(stdout)
      exit(1)
    }
  }
}

@main final class StoryPlaybackApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    NSSetUncaughtExceptionHandler { exception in
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let value = ["name": exception.name.rawValue, "reason": exception.reason ?? "", "stack": exception.callStackSymbols] as [String: Any]
      if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: directory.appendingPathComponent("story-playback-uncaught-exception.json"), options: .atomic)
      }
    }
    let controller = UIViewController()
    controller.view.backgroundColor = .black
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()
    Task { @MainActor in await StoryPlaybackFixture.run(in: controller.view) }
    return true
  }
}
