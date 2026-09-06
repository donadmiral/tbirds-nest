import ExpoModulesCore
import AVFoundation
import CoreMedia
import CoreVideo

public class BoomerangModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Boomerang")

    AsyncFunction("make") { (input: String, output: String, loops: Int) -> String in
      try BoomerangWriter.make(input: input, output: output, loops: max(1, min(3, loops)))
      return output
    }.runOnQueue(.global(qos: .userInitiated))
  }
}

enum BoomerangError: Error, LocalizedError {
  case noVideoTrack
  case readerFailed(String)
  case writerFailed(String)
  var errorDescription: String? {
    switch self {
    case .noVideoTrack: return "The clip has no video track."
    case .readerFailed(let m): return "Could not read the clip: \(m)"
    case .writerFailed(let m): return "Could not write the boomerang: \(m)"
    }
  }
}

enum BoomerangWriter {
  static let fps: Int32 = 30
  static let chunk: Double = 0.5

  static func toURL(_ s: String) -> URL {
    if let u = URL(string: s), u.scheme != nil { return u }
    return URL(fileURLWithPath: s)
  }

  static func make(input: String, output: String, loops: Int) throws {
    let inURL = toURL(input)
    let outURL = toURL(output)
    try? FileManager.default.removeItem(at: outURL)

    let asset = AVURLAsset(url: inURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = asset.tracks(withMediaType: .video).first else { throw BoomerangError.noVideoTrack }
    let total = CMTimeGetSeconds(asset.duration)
    guard total > 0.1 else { throw BoomerangError.readerFailed("clip too short") }

    // The composition applies the recording's rotation, so frames come out
    // upright and the writer never has to know about transforms.
    let composition = AVMutableVideoComposition(propertiesOf: asset)
    let width = Int(composition.renderSize.width.rounded(.down)) & ~1
    let height = Int(composition.renderSize.height.rounded(.down)) & ~1
    guard width > 0, height > 0 else { throw BoomerangError.readerFailed("empty render size") }

    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
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
    guard writer.canAdd(writerInput) else { throw BoomerangError.writerFailed("input rejected") }
    writer.add(writerInput)
    guard writer.startWriting() else { throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "start failed") }
    writer.startSession(atSourceTime: .zero)

    var frame: Int64 = 0
    func append(_ pixels: CVPixelBuffer) throws {
      while !writerInput.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.003) }
      if !adaptor.append(pixels, withPresentationTime: CMTime(value: frame, timescale: fps)) {
        throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "append failed")
      }
      frame += 1
    }

    // One time range, decoded upright. The sample buffers are kept alive for
    // the chunk so the reader's pool cannot recycle them while we reverse.
    func read(_ start: Double, _ end: Double) throws -> [CMSampleBuffer] {
      let reader = try AVAssetReader(asset: asset)
      let output = AVAssetReaderVideoCompositionOutput(
        videoTracks: [track],
        videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
      )
      output.videoComposition = composition
      output.alwaysCopiesSampleData = true
      guard reader.canAdd(output) else { throw BoomerangError.readerFailed("output rejected") }
      reader.add(output)
      reader.timeRange = CMTimeRange(
        start: CMTime(seconds: start, preferredTimescale: 600),
        end: CMTime(seconds: end, preferredTimescale: 600)
      )
      guard reader.startReading() else { throw BoomerangError.readerFailed(reader.error?.localizedDescription ?? "start failed") }
      var frames: [CMSampleBuffer] = []
      while let sample = output.copyNextSampleBuffer() {
        if CMSampleBufferGetImageBuffer(sample) != nil { frames.append(sample) }
      }
      reader.cancelReading()
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

    writerInput.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    if writer.status != .completed {
      throw BoomerangError.writerFailed(writer.error?.localizedDescription ?? "status \(writer.status.rawValue)")
    }
  }
}