import UIKit
import AVFoundation
import ExpoModulesCore
import Darwin

private enum HLSFixtureError: Error, LocalizedError {
  case failed(String)
  var errorDescription: String? { if case .failed(let text) = self { return text }; return nil }
}
@MainActor private func requireHLS(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
  if try !value() { throw HLSFixtureError.failed(message) }
}

@MainActor private final class ObservedHLS {
  let item: AVPlayerItem
  let player: AVPlayer
  var surface: StoryHLSGradeSurface!
  var frames = 0
  var failures = 0
  var firstTimes: [Double] = []
  var callbackAfterStop = false
  var stopped = false
  var matrix = StoryVideoPixels.identity
  init(in container: UIView) throws {
    let origin = Bundle.main.object(forInfoDictionaryKey: "StoryFixtureOrigin") as! String
    item = AVPlayerItem(url: URL(string: origin + "/fixture.m3u8")!)
    player = AVPlayer(playerItem: item)
    player.isMuted = true
    surface = StoryHLSGradeSurface(player: player, item: item, transform: .identity, onFirstFrame: { [weak self] in
      guard let self else { return }
      self.frames += 1
      self.firstTimes.append(self.player.currentTime().seconds)
      if self.stopped { self.callbackAfterStop = true }
    }, onFailure: { [weak self] in
      guard let self else { return }
      self.failures += 1
      if self.stopped { self.callbackAfterStop = true }
    })
    guard let surface else { throw HLSFixtureError.failed("Metal HLS surface could not initialize") }
    surface.frame = container.bounds
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(surface)
    surface.layoutIfNeeded()
  }
  func prepare(trim: Double = 1.5) async throws {
    try await HLSFixture.wait("HLS item never became ready") { self.item.status != .unknown }
    try requireHLS(item.status == .readyToPlay, item.error?.localizedDescription ?? "HLS item failed")
    let sought = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
      player.seek(to: CMTime(seconds: trim, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
    }
    try requireHLS(sought, "Trim seek was cancelled")
    surface.resetFrame()
  }
  func update(_ value: [Double]? = nil, active: Bool = true) {
    if let value { matrix = value }
    surface.update(matrix: matrix, fit: "contain", active: active)
  }
  func ready() async throws {
    try await HLSFixture.wait("No real graded HLS display frame") { self.surface.firstFrameReady || self.failures > 0 }
    try requireHLS(failures == 0 && surface.firstFrameReady, "HLS surface reported a render failure")
  }
  // Runtime inspection measures the actual scheduled display link. It does not
  // replace AVFoundation/Metal rendering or infer success from source strings.
  func displayLinkScheduled() throws -> Bool {
    guard let value = Mirror(reflecting: surface!).children.first(where: { $0.label == "displayLink" })?.value else {
      throw HLSFixtureError.failed("Surface scheduling diagnostic is unavailable")
    }
    return !Mirror(reflecting: value).children.isEmpty
  }
  func close() {
    guard !stopped else { return }
    stopped = true
    surface.stop()
    surface.removeFromSuperview()
    player.pause()
  }
}

@MainActor private final class ObservedHLSView {
  let view = StoryVideoView()
  var events: [[String: Any]] = []
  var layer: AVPlayerLayer? { view.layer.sublayers?.compactMap { $0 as? AVPlayerLayer }.first }
  var item: AVPlayerItem? { layer?.player?.currentItem }
  var frames: Int { events.filter { $0["type"] as? String == "firstFrame" }.count }
  var failure: String? { events.first { $0["status"] as? String == "error" }?["error"] as? String }
  init(in container: UIView) {
    view.frame = container.bounds; view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.muted = true; view.paused = true; view.allowsHLSGrade = true
    view.onPlayback.fixtureListener = { [weak self] event in self?.events.append(event) }
    container.addSubview(view); view.layoutIfNeeded()
  }
  func load() {
    let origin = Bundle.main.object(forInfoDictionaryKey: "StoryFixtureOrigin") as! String
    view.matrix = HLSFixture.green; view.seekSeconds = 1.5; view.seekRevision += 1
    view.uri = origin + "/fixture.m3u8"; view.update()
  }
  func close() {
    view.uri = ""; view.paused = true; view.update(); view.removeFromSuperview()
    view.onPlayback.fixtureListener = nil
  }
}

@MainActor private enum HLSFixture {
  static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  static let green: [Double] = [0,0,0,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,1,0]
  static let red: [Double] = [0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,1,0]
  static var cases: [[String: Any]] = []
  static var stage = "starting"
  static func json(_ name: String, _ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
      try? data.write(to: documents.appendingPathComponent(name), options: .atomic)
    }
  }
  static func receipt(_ passed: Bool, error: String? = nil) {
    var value: [String: Any] = ["schemaVersion": 1, "passed": passed, "stage": stage, "cases": cases,
      "scope": "Production StoryHLSGradeSurface and StoryVideoPixels with real AVPlayer HLS, Metal and compositor screenshots; no React Native bridge or physical-device claim"]
    if let error { value["error"] = error }
    json("story-hls-grade-receipt.json", value)
  }
  static func phase(_ name: String, color: String? = nil) {
    var value: [String: Any] = ["phase": name, "at": Date().timeIntervalSince1970]
    if let color { value["color"] = color }
    json("story-hls-grade-phase.json", value)
    print("STORY_HLS_GRADE_PHASE " + name); fflush(stdout)
  }
  static func wait(_ message: String, timeout: Double = 15, until: () -> Bool) async throws {
    let end = ProcessInfo.processInfo.systemUptime + timeout
    while !until() {
      if ProcessInfo.processInfo.systemUptime >= end { throw HLSFixtureError.failed(message) }
      try await Task.sleep(nanoseconds: 20_000_000)
    }
  }
  static func snapshot(_ name: String, color: String) async throws {
    phase(name, color: color)
    var ack: [String: Any] = [:]
    try await wait("Compositor screenshot was not verified", timeout: 20) {
      if let data = try? Data(contentsOf: documents.appendingPathComponent("story-hls-grade-ack.json")),
         let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { ack = value }
      return ack["phase"] as? String == name
    }
    try requireHLS(ack["passed"] as? Bool == true, "Compositor pixels did not match " + color)
  }
  static func record(_ name: String, body: () async throws -> [String: Any]) async throws {
    stage = name; receipt(false)
    let start = ProcessInfo.processInfo.systemUptime
    do {
      let evidence = try await body()
      cases.append(["name": name, "passed": true, "runtimeSeconds": ProcessInfo.processInfo.systemUptime - start, "evidence": evidence])
      receipt(false)
    } catch {
      cases.append(["name": name, "passed": false, "error": error.localizedDescription]); throw error
    }
  }
  static func run(in container: UIView) async {
    do {
      try await wait("Fixture did not become active") { UIApplication.shared.applicationState == .active }
      try await record("HLS trim gate and paused grade update display verified pixels") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        try await observed.prepare()
        observed.update(green)
        try await observed.ready()
        try requireHLS(observed.frames == 1 && observed.firstTimes.allSatisfy { $0 >= 1.45 }, "First frame preceded trim or repeated")
        try requireHLS(observed.item.videoComposition == nil && observed.item.outputs.count == 1, "HLS used an extra composition/output")
        try await snapshot("trim-green", color: "green")
        observed.update(StoryVideoPixels.identity)
        try await snapshot("paused-blue", color: "blue")
        observed.update(red)
        try await snapshot("paused-red", color: "red")
        try requireHLS(observed.frames == 1 && observed.failures == 0, "Paused grade update changed frame ownership")
        return ["firstFrameTimes": observed.firstTimes, "realHLS": true, "pixelScreenshots": ["trim-green", "paused-blue", "paused-red"], "singlePlayerOutput": true]
      }
      try await record("production StoryVideoView switches graded and neutral HLS without duplicate outputs") {
        let observed = ObservedHLSView(in: container)
        defer { observed.close() }
        observed.load()
        try await wait("Production wrapper did not display graded HLS") { observed.frames == 1 || observed.failure != nil }
        try requireHLS(observed.failure == nil, observed.failure ?? "Wrapper failed")
        guard let item = observed.item else { throw HLSFixtureError.failed("Wrapper lost its HLS item") }
        try requireHLS(item.outputs.count == 1 && item.videoComposition == nil, "Wrapper did not attach exactly one HLS output")
        try await snapshot("wrapper-green", color: "green")
        observed.view.matrix = StoryVideoPixels.identity; observed.view.update()
        try requireHLS(observed.item === item && item.outputs.isEmpty && item.videoComposition == nil, "Neutral transition retained an HLS output or changed item")
        try await snapshot("wrapper-blue", color: "blue")
        observed.view.matrix = red; observed.view.update()
        try await snapshot("wrapper-red", color: "red")
        try requireHLS(observed.failure == nil && observed.item === item && item.outputs.count == 1 && item.videoComposition == nil, "Regrading changed item, failed, or duplicated outputs")
        try requireHLS(observed.frames == 1, "Grade changes repeated first-frame ownership")
        return ["outputCounts": [1, 0, 1], "samePlayerItem": true, "videoComposition": false,
          "pixelScreenshots": ["wrapper-green", "wrapper-blue", "wrapper-red"]]
      }
      try await record("surface reset and seek discard obsolete pending graded frames") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        var pendingAtReset: [Bool] = []
        for index in 0..<6 {
          observed.update(active: false)
          try await observed.prepare(trim: 0)
          observed.update(green)
          observed.player.play()
          // Vary the reset within one display interval to cover both queued
          // drawing and completed-command callbacks without assuming GPU speed.
          try await Task.sleep(nanoseconds: UInt64(index + 1) * 3_000_000)
          pendingAtReset.append(Mirror(reflecting: observed.surface!).children.first { $0.label == "framePending" }?.value as? Bool ?? false)
          observed.player.pause(); observed.update(active: false)
          observed.surface.resetFrame(); observed.frames = 0; observed.firstTimes.removeAll()
          try await observed.prepare(trim: 1.5)
          observed.update(green); try await observed.ready()
          try requireHLS(observed.frames == 1 && observed.firstTimes.allSatisfy { $0 >= 1.45 }, "Reset allowed an obsolete frame callback before trim")
          try requireHLS(observed.failures == 0 && observed.item.outputs.count == 1, "Reset duplicated or failed the decoder output")
        }
        try await snapshot("reset-green", color: "green")
        return ["resetCycles": 6, "commandPendingAtReset": pendingAtReset, "firstFrameTimes": observed.firstTimes, "attachedOutputs": observed.item.outputs.count]
      }
      try await record("paused and inactive HLS surfaces stop scheduling work") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        try await observed.prepare(); observed.update(green); try await observed.ready()
        try await wait("Paused surface retained a display link") { (try? observed.displayLinkScheduled()) == false }
        let time = observed.player.currentTime().seconds
        observed.update(red, active: false)
        try await Task.sleep(nanoseconds: 400_000_000)
        try requireHLS(try !observed.displayLinkScheduled(), "Inactive surface retained a display link")
        try requireHLS(abs(observed.player.currentTime().seconds - time) < 0.02 && observed.frames == 1, "Paused surface advanced or emitted another first frame")
        observed.update(active: true)
        try await snapshot("inactive-resume-red", color: "red")
        return ["pausedDisplayLink": false, "inactiveDisplayLink": false, "pausedTimeDelta": observed.player.currentTime().seconds - time]
      }
      try await record("actual OS background and foreground preserve graded HLS ownership") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        try await observed.prepare(); observed.update(green); observed.player.play(); try await observed.ready()
        var background = false
        var backgroundDetached = false
        let down = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
          observed.player.pause(); observed.update(active: false)
          backgroundDetached = (try? observed.displayLinkScheduled()) == false
          background = true; phase("background-observed")
        }
        let up = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
          if background { observed.update(active: true) }
        }
        defer { NotificationCenter.default.removeObserver(down); NotificationCenter.default.removeObserver(up) }
        phase("background-ready")
        try await wait("Driver did not perform OS background/foreground", timeout: 35) { background && UIApplication.shared.applicationState == .active }
        try requireHLS(backgroundDetached && observed.player.rate == 0, "Background did not stop surface/player work")
        try await snapshot("foreground-green", color: "green")
        try requireHLS(observed.frames == 1 && observed.failures == 0, "Foreground lost first-frame ownership")
        return ["actualOSBackground": true, "hostInvokedActiveEntryPoint": true, "backgroundDisplayLink": false, "samePlayerItem": observed.player.currentItem === observed.item]
      }
      try await record("stopped HLS surfaces detach outputs and cancel late callbacks") {
        var weakSurfaces: [() -> Bool] = []
        var observedItems: [AVPlayerItem] = []
        var stoppedModels: [ObservedHLS] = []
        for _ in 0..<12 {
          var observed: ObservedHLS? = try ObservedHLS(in: container)
          try await observed!.prepare()
          observed!.update(green)
          weak var weakSurface = observed!.surface
          weakSurfaces.append { weakSurface != nil }
          observed!.close()
          try requireHLS(observed!.item.outputs.isEmpty, "Stopped surface left its output attached")
          try requireHLS(try !observed!.displayLinkScheduled(), "Stopped surface retained scheduled work")
          observedItems.append(observed!.item)
          stoppedModels.append(observed!)
          observed = nil
        }
        try await Task.sleep(nanoseconds: 400_000_000)
        try requireHLS(stoppedModels.allSatisfy { !$0.callbackAfterStop }, "Stopped surface emitted a late callback")
        stoppedModels.removeAll()
        try await wait("Stopped Metal surfaces remained retained") { weakSurfaces.allSatisfy { !$0() } }
        try requireHLS(observedItems.allSatisfy { $0.outputs.isEmpty }, "An output reattached after cancellation")
        return ["cancelledSurfaces": 12, "retainedSurfaces": 0, "attachedOutputs": 0]
      }
      try await record("frozen HLS output fails within five seconds despite repeated backward seeks") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        try await observed.prepare(); observed.update(green); observed.player.play(); try await observed.ready()
        guard let output = observed.item.outputs.first else { throw HLSFixtureError.failed("No output available for failure fixture") }
        observed.item.remove(output)
        let started = ProcessInfo.processInfo.systemUptime
        var rewinds = 0
        while observed.failures == 0 && ProcessInfo.processInfo.systemUptime - started < 5 {
          try await Task.sleep(nanoseconds: 600_000_000)
          if observed.failures > 0 { break }
          let sought = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            observed.player.seek(to: CMTime(seconds: 1.5, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { c.resume(returning: $0) }
          }
          try requireHLS(sought, "Failure fixture rewind was cancelled")
          rewinds += 1; observed.player.play()
        }
        let elapsed = ProcessInfo.processInfo.systemUptime - started
        try requireHLS(observed.failures == 1 && elapsed <= 5 && rewinds >= 2, "Backward seeks suppressed the bounded frozen-output failure")
        try requireHLS(observed.item.outputs.isEmpty, "Failed output remained attached")
        try await Task.sleep(nanoseconds: 150_000_000)
        try requireHLS(observed.failures == 1, "Frozen output reported duplicate failure")
        return ["failureSeconds": elapsed, "rewinds": rewinds, "failureCallbacks": observed.failures, "attachedOutputs": observed.item.outputs.count]
      }
      try await record("invalid grade fails once and releases its HLS output") {
        let observed = try ObservedHLS(in: container)
        defer { observed.close() }
        try await observed.prepare()
        observed.update([Double.nan])
        observed.update(green)
        try await Task.sleep(nanoseconds: 100_000_000)
        try requireHLS(observed.failures == 1 && observed.frames == 0 && observed.item.outputs.isEmpty, "Render failure did not settle once and detach")
        return ["failureCallbacks": observed.failures, "firstFrames": observed.frames, "attachedOutputs": observed.item.outputs.count]
      }
      stage = "completed"; receipt(true); phase("completed")
      print("STORY_HLS_GRADE_PASSED \(cases.count)"); fflush(stdout); exit(0)
    } catch {
      receipt(false, error: error.localizedDescription); phase("failed")
      print("STORY_HLS_GRADE_FAILED " + error.localizedDescription); fflush(stdout); exit(1)
    }
  }
}

@main final class StoryHLSGradeApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    NSSetUncaughtExceptionHandler { exception in
      let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      let value: [String: Any] = ["name": exception.name.rawValue, "reason": exception.reason ?? "", "stack": exception.callStackSymbols]
      if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]) {
        try? data.write(to: root.appendingPathComponent("story-hls-grade-uncaught-exception.json"), options: .atomic)
      }
    }
    let controller = UIViewController(); controller.view.backgroundColor = .black
    let window = UIWindow(frame: UIScreen.main.bounds); window.rootViewController = controller
    self.window = window; window.makeKeyAndVisible()
    Task { @MainActor in await HLSFixture.run(in: controller.view) }
    return true
  }
}
