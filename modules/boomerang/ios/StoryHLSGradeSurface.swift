import AVFoundation
import CoreImage
import Metal
import QuartzCore
import UIKit

/// Pulls decoded HLS frames from the existing player. Unlike videoComposition,
/// AVPlayerItemVideoOutput does not require a file-backed asset. No second
/// decoder, audio player, disk cache, or CPU pixel readback is created.
final class StoryHLSGradeSurface: UIView {
  private struct Renderer {
    let device: MTLDevice
    let queue: MTLCommandQueue
    let context: CIContext
  }
  // Reuse GPU programs and resources across story changes. Pixel buffers stay
  // per-view and intermediates are uncached, so no media survives this owner.
  private static let renderer: Renderer? = {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    return Renderer(device: device, queue: queue, context: CIContext(mtlDevice: device, options: [
      .workingColorSpace: StoryVideoPixels.colorSpace, .outputColorSpace: StoryVideoPixels.colorSpace,
      .cacheIntermediates: false
    ]))
  }()
  override class var layerClass: AnyClass { CAMetalLayer.self }
  private var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
  private weak var player: AVPlayer?
  private weak var item: AVPlayerItem?
  private let output: AVPlayerItemVideoOutput
  private let queue: MTLCommandQueue
  private let context: CIContext
  private let transform: CGAffineTransform
  private let onFirstFrame: () -> Void
  private let onFailure: () -> Void
  private var displayLink: CADisplayLink?
  private var pixelBuffer: CVPixelBuffer?
  private var matrix = StoryVideoPixels.identity
  private var fit = "contain"
  private var active = false
  private var stopped = false
  private var failed = false
  private var framePending = false
  private var needsRedraw = true
  private var epoch = 0
  private var waitingSince: TimeInterval?
  private var lastPlayingTick: TimeInterval?
  private var stalledPlayingTime: TimeInterval = 0
  private(set) var firstFrameReady = false

  init?(player: AVPlayer, item: AVPlayerItem, transform: CGAffineTransform,
        onFirstFrame: @escaping () -> Void, onFailure: @escaping () -> Void) {
    guard let renderer = Self.renderer else { return nil }
    self.player = player; self.item = item; queue = renderer.queue; self.transform = transform
    self.onFirstFrame = onFirstFrame; self.onFailure = onFailure
    context = renderer.context
    output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferMetalCompatibilityKey as String: true
    ])
    super.init(frame: .zero)
    isUserInteractionEnabled = false; isOpaque = false
    metalLayer.device = renderer.device; metalLayer.pixelFormat = .bgra8Unorm
    metalLayer.colorspace = StoryVideoPixels.colorSpace
    metalLayer.framebufferOnly = false; metalLayer.isOpaque = false
    metalLayer.isHidden = true
    metalLayer.maximumDrawableCount = 2; metalLayer.allowsNextDrawableTimeout = true
    output.suppressesPlayerRendering = true
    item.add(output)
  }
  required init?(coder: NSCoder) { return nil }

  override func layoutSubviews() {
    super.layoutSubviews()
    let scale = window?.screen.scale ?? UIScreen.main.scale
    let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    if metalLayer.drawableSize != size { metalLayer.contentsScale = scale; metalLayer.drawableSize = size; needsRedraw = true }
    schedule()
  }
  override func didMoveToWindow() { super.didMoveToWindow(); schedule() }

  func update(matrix: [Double], fit: String, active: Bool) {
    guard !stopped, !failed else { return }
    guard matrix.count == 20, matrix.allSatisfy({ $0.isFinite && abs($0) <= 16 }) else { fail(); return }
    if self.matrix != matrix || self.fit != fit { self.matrix = matrix; self.fit = fit; needsRedraw = true }
    if self.active != active { waitingSince = nil; lastPlayingTick = nil }
    self.active = active
    schedule()
  }
  func resetFrame() {
    epoch += 1; firstFrameReady = false; pixelBuffer = nil; framePending = false
    waitingSince = nil; lastPlayingTick = nil; stalledPlayingTime = 0; needsRedraw = true; metalLayer.isHidden = true
  }
  func stop() {
    guard !stopped else { return }
    stopped = true; epoch += 1; displayLink?.invalidate(); displayLink = nil
    if let item { item.remove(output) }
    pixelBuffer = nil; player = nil; item = nil; waitingSince = nil
    metalLayer.isHidden = true
  }
  private func fail() {
    guard !stopped, !failed else { return }
    failed = true; stop(); onFailure()
  }
  private var mayRender: Bool {
    active && !stopped && !failed && window != nil && UIApplication.shared.applicationState == .active
  }
  private func schedule() {
    guard mayRender, !firstFrameReady || needsRedraw || (player?.rate ?? 0) != 0 else {
      displayLink?.invalidate(); displayLink = nil; waitingSince = nil; return
    }
    guard displayLink == nil else { return }
    // The weak relay avoids the CADisplayLink -> view retain cycle.
    let relay = StoryHLSDisplayRelay(self)
    let link = CADisplayLink(target: relay, selector: #selector(StoryHLSDisplayRelay.tick(_:)))
    link.preferredFramesPerSecond = 60
    displayLink = link; link.add(to: .main, forMode: .common)
  }
  fileprivate func draw(_ link: CADisplayLink) {
    guard mayRender, let player, let item, player.currentItem === item, item.status == .readyToPlay else { schedule(); return }
    guard !framePending, bounds.width > 0, bounds.height > 0 else { return }
    let time = player.rate == 0 ? player.currentTime() : output.itemTime(forHostTime: link.targetTimestamp)
    let fresh = output.hasNewPixelBuffer(forItemTime: time)
    let clock = ProcessInfo.processInfo.systemUptime
    let playing = player.timeControlStatus == .playing
    if fresh, let next = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) {
      pixelBuffer = next; needsRedraw = true; stalledPlayingTime = 0
    } else if playing, let lastPlayingTick {
      // Count visible playing time, not the media timestamp, which jumps back
      // on loops. Repeated rewinds must not hide frozen output behind audio.
      stalledPlayingTime += max(0, min(1, clock - lastPlayingTick))
      if stalledPlayingTime > 3 { fail(); return }
    }
    lastPlayingTick = playing ? clock : nil
    guard let pixelBuffer, needsRedraw else {
      if !firstFrameReady {
        let now = ProcessInfo.processInfo.systemUptime
        if waitingSince == nil { waitingSince = now }
        if now - (waitingSince ?? now) > 3 { fail() }
      } else { schedule() }
      return
    }
    guard let drawable = metalLayer.nextDrawable(), let command = queue.makeCommandBuffer() else { fail(); return }
    let source = CIImage(cvPixelBuffer: pixelBuffer).transformed(by: transform)
    guard source.extent.width > 0, source.extent.height > 0 else { fail(); return }
    let target = CGRect(origin: .zero, size: metalLayer.drawableSize)
    let ratio = fit == "cover" ? max(target.width / source.extent.width, target.height / source.extent.height)
      : min(target.width / source.extent.width, target.height / source.extent.height)
    let normalized = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
    let scaled = StoryVideoPixels.matrix(normalized, matrix).transformed(by: CGAffineTransform(scaleX: ratio, y: ratio))
    let centered = scaled.transformed(by: CGAffineTransform(translationX: (target.width - scaled.extent.width) / 2, y: (target.height - scaled.extent.height) / 2))
    let image = centered.composited(over: CIImage(color: .clear).cropped(to: target)).cropped(to: target)
    let expected = epoch; framePending = true; needsRedraw = false
    context.render(image, to: drawable.texture, commandBuffer: command, bounds: target, colorSpace: StoryVideoPixels.colorSpace)
    command.present(drawable)
    command.addCompletedHandler { [weak self] completed in
      let succeeded = completed.status == .completed
      DispatchQueue.main.async {
        guard let self, expected == self.epoch, !self.stopped else { return }
        self.framePending = false
        guard succeeded else { self.fail(); return }
        guard self.mayRender else { self.needsRedraw = true; return }
        self.metalLayer.isHidden = false; self.waitingSince = nil
        if !self.firstFrameReady { self.firstFrameReady = true; self.onFirstFrame() }
        self.schedule()
      }
    }
    command.commit()
  }
  deinit { displayLink?.invalidate(); if let item { item.remove(output) } }
}

private final class StoryHLSDisplayRelay: NSObject {
  weak var surface: StoryHLSGradeSurface?
  init(_ surface: StoryHLSGradeSurface) { self.surface = surface }
  @objc func tick(_ link: CADisplayLink) { surface?.draw(link) }
}
