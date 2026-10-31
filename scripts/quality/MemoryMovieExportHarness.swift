import UIKit
import AVFoundation
import CoreMedia
import CoreVideo
import ImageIO
import UniformTypeIdentifiers

private enum FixtureError: Error, LocalizedError {
  case failed(String)
  var errorDescription: String? { if case .failed(let value) = self { return value }; return nil }
}
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw FixtureError.failed(message) }
}

@MainActor
private enum MemoryMovieFixture {
  static let width = 720, height = 1280
  static let files = FileManager.default
  static var cache: URL { files.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
  static var documents: URL { files.urls(for: .documentDirectory, in: .userDomainMask)[0] }
  static var results: [[String: Any]] = []
  static var diagnostics: [[String: Any]] = []

  static func wave(_ url: URL, seconds: Int, sample: (Double) -> Double) throws {
    let rate = 48000, count = seconds * rate
    var data = Data()
    func word<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
    data.append(contentsOf: "RIFF".utf8); word(UInt32(36 + count * 2)); data.append(contentsOf: "WAVEfmt ".utf8)
    word(UInt32(16)); word(UInt16(1)); word(UInt16(1)); word(UInt32(rate)); word(UInt32(rate * 2)); word(UInt16(2)); word(UInt16(16))
    data.append(contentsOf: "data".utf8); word(UInt32(count * 2))
    for index in 0..<count { word(Int16(max(-0.95, min(0.95, sample(Double(index)/Double(rate)))) * 32767)) }
    try data.write(to: url)
  }

  static func video(_ url: URL, seconds: Int) async throws {
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    input.expectsMediaDataInRealTime = false
    let attrs: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)
    try require(writer.canAdd(input), "Fixture video input unavailable")
    writer.add(input); try require(writer.startWriting(), "Fixture video did not start"); writer.startSession(atSourceTime: .zero)
    var pixel: CVPixelBuffer?
    try require(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pixel) == kCVReturnSuccess, "Fixture pixel allocation failed")
    guard let pixel else { throw FixtureError.failed("Fixture pixel missing") }
    CVPixelBufferLockBaseAddress(pixel, [])
    guard let address = CVPixelBufferGetBaseAddress(pixel) else { throw FixtureError.failed("Fixture pixel address missing") }
    let stride = CVPixelBufferGetBytesPerRow(pixel), pixels = address.assumingMemoryBound(to: UInt8.self)
    for y in 0..<height { for x in 0..<width { let offset = y * stride + x * 4; pixels[offset] = 180; pixels[offset+1] = 90; pixels[offset+2] = 20; pixels[offset+3] = 255 } }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    for index in 0..<(seconds * 30) {
      while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 10_000_000) }
      try require(adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(index), timescale: 30)), "Fixture video frame failed")
    }
    input.markAsFinished(); writer.endSession(atSourceTime: CMTime(seconds: Double(seconds), preferredTimescale: 600))
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in writer.finishWriting { continuation.resume() } }
    try require(writer.status == .completed, "Fixture video did not finish")
  }

  static func withOriginalAudio(video: URL, audio: URL, destination: URL) async throws {
    let asset = AVURLAsset(url: video), sound = AVURLAsset(url: audio), composition = AVMutableComposition()
    let range = CMTimeRange(start: .zero, duration: try await asset.load(.duration))
    guard let v = try await asset.loadTracks(withMediaType: .video).first, let a = try await sound.loadTracks(withMediaType: .audio).first,
      let vt = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
      let at = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw FixtureError.failed("Fixture source tracks missing") }
    try vt.insertTimeRange(range, of: v, at: .zero); try at.insertTimeRange(range, of: a, at: .zero)
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw FixtureError.failed("Fixture export unavailable") }
    export.outputURL = destination; export.outputFileType = .mp4
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in export.exportAsynchronously { continuation.resume() } }
    try require(export.status == .completed, "Fixture source mux failed")
  }

  static func samples(_ url: URL, at: Double) async throws -> [Float] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: .audio).first else { throw FixtureError.failed("Encoded audio track missing") }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(seconds: at, preferredTimescale: 48000), duration: CMTime(seconds: 0.3, preferredTimescale: 48000))
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false])
    try require(reader.canAdd(output), "PCM reader output unavailable"); reader.add(output)
    try require(reader.startReading(), "PCM reader did not start")
    var values: [Float] = []
    while let sample = output.copyNextSampleBuffer() {
      guard let buffer = CMSampleBufferGetDataBuffer(sample) else { throw FixtureError.failed("PCM buffer missing") }
      let size = CMBlockBufferGetDataLength(buffer)
      var bytes = Data(count: size)
      let status = bytes.withUnsafeMutableBytes { raw in CMBlockBufferCopyDataBytes(buffer, atOffset: 0, dataLength: size, destination: raw.baseAddress!) }
      try require(status == kCMBlockBufferNoErr && size % 4 == 0, "PCM buffer invalid")
      bytes.withUnsafeBytes { raw in values.append(contentsOf: raw.bindMemory(to: Float.self)) }
    }
    try require(reader.status == .completed, "PCM decoder failed")
    return values
  }
  static func measurement(_ url: URL, at: Double) async throws -> [String: Double] {
    let values = try await samples(url, at: at)
    let rms = values.isEmpty ? 0 : sqrt(values.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(values.count))
    var below = false, cycles = 0
    for sample in values { if sample < -0.02 { below = true }; if below && sample > 0.02 { cycles += 1; below = false } }
    let hz = values.isEmpty ? 0 : Double(cycles) * 48000 / Double(values.count)
    return ["rms": rms, "hz": hz, "samples": Double(values.count)]
  }
  // Zero crossings cannot distinguish the original from a second audible tone.
  // Measure each frequency independently in the PCM decoded from the final MP4.
  static func mixedMeasurement(_ url: URL, at: Double, speed: Double) async throws -> [String: Double] {
    let values = try await samples(url, at: at)
    try require(values.count >= 12000 && values.count <= 19200, "Mixed audio window is missing or truncated")
    func amplitude(_ hz: Double) -> Double {
      var real = 0.0, imaginary = 0.0
      for (index, sample) in values.enumerated() {
        let phase = 2 * Double.pi * hz * Double(index) / 48000
        real += Double(sample) * cos(phase); imaginary += Double(sample) * sin(phase)
      }
      return 2 * sqrt(real * real + imaginary * imaginary) / Double(values.count)
    }
    return ["at": at, "samples": Double(values.count), "original440Hz": amplitude(440), "music660Hz": amplitude(660),
      "shiftedOriginalHz": 440 * speed, "shiftedOriginalAmplitude": amplitude(440 * speed),
      "shiftedMusicHz": 660 * speed, "shiftedMusicAmplitude": amplitude(660 * speed),
      "beforeExcerpt1540Hz": amplitude(1540), "afterExcerpt1760Hz": amplitude(1760)]
  }
  static func trackCoverage(_ url: URL, mediaType: AVMediaType, expectedDuration: Double) async throws -> [String: Double] {
    let asset = AVURLAsset(url: url)
    guard let track = try await asset.loadTracks(withMediaType: mediaType).first else { throw FixtureError.failed("Mixed export track is missing") }
    // Compressed samples need not expose a numeric duration. Attest decoded
    // PCM frames and decoded video timestamps instead of inventing that value.
    let settings: [String: Any] = mediaType == .audio
      ? [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1,
         AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false]
      : [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    let reader = try AVAssetReader(asset: asset), output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    try require(reader.canAdd(output), "Mixed export track reader is unavailable"); reader.add(output)
    try require(reader.startReading(), "Mixed export track reader did not start")
    var count = 0, first = Double.infinity, end = 0.0, pcmFrames = 0
    var videoTimes: [Double] = []
    while let sample = output.copyNextSampleBuffer() {
      let start = CMSampleBufferGetPresentationTimeStamp(sample).seconds
      try require(start.isFinite, "Mixed export has an invalid presentation timestamp")
      first = min(first, start); count += 1
      if mediaType == .audio {
        guard let format = CMSampleBufferGetFormatDescription(sample),
              let stream = CMAudioFormatDescriptionGetStreamBasicDescription(format),
              let buffer = CMSampleBufferGetDataBuffer(sample) else { throw FixtureError.failed("Decoded PCM format or bytes are missing") }
        let frames = CMSampleBufferGetNumSamples(sample), rate = stream.pointee.mSampleRate
        try require(frames > 0 && rate.isFinite && rate > 0 && stream.pointee.mFormatID == kAudioFormatLinearPCM, "Decoded PCM has no finite sample duration")
        let bytesPerFrame = Int(stream.pointee.mBytesPerFrame)
        try require(bytesPerFrame > 0 && CMBlockBufferGetDataLength(buffer) >= frames * bytesPerFrame, "Decoded PCM frames are truncated")
        let duration = Double(frames) / rate
        end = max(end, start + duration); pcmFrames += frames
      } else {
        guard let image = CMSampleBufferGetImageBuffer(sample) else { throw FixtureError.failed("Decoded video frame is missing") }
        try require(CVPixelBufferGetWidth(image) == width && CVPixelBufferGetHeight(image) == height, "Decoded video frame has the wrong size")
        videoTimes.append(start)
      }
    }
    try require(reader.status == .completed && count > 0, "Mixed export track could not be read completely")
    var frameInterval = 0.0
    if mediaType == .video {
      videoTimes.sort()
      try require(videoTimes.count >= Int(floor(expectedDuration * 30)) - 2 && videoTimes.count <= Int(ceil(expectedDuration * 30)) + 2, "Mixed export frame count does not cover the edited timeline")
      var intervals: [Double] = []
      for index in 1..<videoTimes.count {
        let interval = videoTimes[index] - videoTimes[index - 1]
        try require(interval > 0 && abs(interval - 1.0 / 30.0) < 0.01, "Mixed export has duplicate frames or an unexpected frame gap")
        intervals.append(interval)
      }
      try require(!intervals.isEmpty, "Mixed export has no measurable video frame interval")
      intervals.sort(); frameInterval = intervals[intervals.count / 2]
      end = videoTimes.last! + frameInterval
    }
    try require(abs(first) < 0.12 && abs(end - expectedDuration) < 0.12, "Mixed export has a missing start, truncated track or trailing audio/video")
    return ["sampleBuffers": Double(count), "pcmFrames": Double(pcmFrames), "frameInterval": frameInterval, "firstPresentation": first, "end": end]
  }
  static func frame(_ url: URL, at: Double) throws {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url)); generator.appliesPreferredTrackTransform = true
    let image = try generator.copyCGImage(at: CMTime(seconds: at, preferredTimescale: 600), actualTime: nil)
    try require(image.width == width && image.height == height, "Encoded final video frame missing or wrong size")
  }
  static func recipe(end: Double, speed: Double = 1, start: Double = 0, volume: Double = 0) -> [String: Any] {
    ["width": Double(width), "height": Double(height), "trimStart": start, "trimEnd": end, "speed": speed, "volume": volume,
     "fit": "contain", "scale": 1.0, "x": 0.0, "y": 0.0, "matrix": StoryVideoPixels.identity]
  }
  static func scene(_ input: URL, kind: String = "image", seconds: Double = 1.2, speed: Double = 1, start: Double = 0, volume: Double = 0, fade: Double = 0) -> [String: Any] {
    ["id": UUID().uuidString, "inputUri": input.absoluteString, "inputKind": kind, "recipe": recipe(end: start+seconds*speed,speed: speed,start: start,volume: volume), "layers": [],
     "transition": ["fadeSec": fade], "motion": ["fromScale": 1.0,"toScale": 1.0,"x": 0.0,"y": 0.0]]
  }
  static func sound(_ uri: URL, volume: Double = 0.5, loop: Bool = true) -> [String: Any] { ["uri": uri.absoluteString,"start": 1.0,"duration": 1.0,"volume": volume,"loop": loop] }
  static func request(_ name: String, scenes: [[String: Any]], soundtrack: [String: Any]? = nil) -> [String: Any] {
    var result: [String: Any] = ["id": "memory-fixture-"+name,"width": width,"height": height,"scenes": scenes,"outputUri": cache.appendingPathComponent("pc-memory-export-"+name+".mp4").absoluteString]
    if let soundtrack { result["soundtrack"] = soundtrack }; return result
  }
  static func output(_ request: [String: Any]) -> URL { URL(string: request["outputUri"] as! String)! }
  static func retain(_ url: URL) throws {
    let target = documents.appendingPathComponent("media",isDirectory: true)
    try files.createDirectory(at: target,withIntermediateDirectories: true)
    try files.copyItem(at: url,to: target.appendingPathComponent(url.lastPathComponent))
  }
  static func image(_ name: String, color: UIColor, transparent: Bool = false) throws -> URL {
    let url = cache.appendingPathComponent(name+".png"), format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = !transparent
    let png = UIGraphicsImageRenderer(size: CGSize(width: CGFloat(width),height: CGFloat(height)),format: format).pngData { context in
      if !transparent { color.setFill(); context.fill(CGRect(x: 0,y: 0,width: CGFloat(width),height: CGFloat(height))) }
      else { color.setFill(); context.fill(CGRect(x: 90,y: 170,width: 100,height: 140)) }
    }
    try png.write(to: url); return url
  }
  static func pixel(_ uri: URL, time: Double, x: Int, y: Int) throws -> [Int] {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: uri)); generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1,timescale: 60); generator.requestedTimeToleranceAfter = CMTime(value: 1,timescale: 60)
    let image = try generator.copyCGImage(at: CMTime(seconds: time,preferredTimescale: 60000),actualTime: nil)
    try require(image.width==width && image.height==height,"The decoded memory frame has the wrong dimensions")
    var data = [UInt8](repeating:0,count:4)
    data.withUnsafeMutableBytes { bytes in
      StoryVideoPixels.context.render(CIImage(cgImage:image),toBitmap:bytes.baseAddress!,rowBytes:4,bounds:CGRect(x:CGFloat(x),y:CGFloat(height-y-1),width:1,height:1),format:.RGBA8,colorSpace:StoryVideoPixels.colorSpace)
    }
    return [Int(data[0]),Int(data[1]),Int(data[2])]
  }
  static func imagePixel(_ uri: URL, x: Int, y: Int) throws -> [Int] {
    guard let image = UIImage(contentsOfFile: uri.path)?.cgImage, x >= 0, y >= 0, x < image.width, y < image.height else { throw FixtureError.failed("The normalized image cannot be sampled") }
    var data = [UInt8](repeating: 0, count: 4)
    data.withUnsafeMutableBytes { bytes in
      StoryVideoPixels.context.render(CIImage(cgImage: image), toBitmap: bytes.baseAddress!, rowBytes: 4,
        bounds: CGRect(x: CGFloat(x), y: CGFloat(image.height-y-1), width: 1, height: 1), format: .RGBA8, colorSpace: StoryVideoPixels.colorSpace)
    }
    return data.map(Int.init)
  }
  static func frequencies(_ uri: URL, time: Double) async throws -> [String: Double] {
    let values = try await samples(uri,at: time)
    try require(values.count > 12000,"The final movie audio window is missing")
    var output: [String: Double] = ["time": time]
    for hz in [220,330,440,660,880,1100,1540,1760] {
      var real = 0.0, imaginary = 0.0
      for (index,value) in values.enumerated() { let phase = 2*Double.pi*Double(hz)*Double(index)/48000; real += Double(value)*cos(phase); imaginary += Double(value)*sin(phase) }
      output[String(hz)] = 2*sqrt(real*real+imaginary*imaginary)/Double(values.count)
    }
    output["rms"] = sqrt(values.reduce(0.0) { $0+Double($1)*Double($1) }/Double(values.count)); return output
  }
  static func rejected(_ request: [String: Any]) async throws {
    let before = Set(try files.contentsOfDirectory(atPath: cache.path))
    do { _ = try await MemoryMovieComposition.make(request); throw FixtureError.failed("An invalid memory movie was accepted") }
    catch let error as FixtureError { throw error }
    catch { try require(!files.fileExists(atPath: output(request).path),"A rejected movie retained its output") }
    let after = Set(try files.contentsOfDirectory(atPath: cache.path))
    try require(after.subtracting(before).filter { $0.hasPrefix("pc-story-export-") || $0.hasPrefix("pc-memory-export-") }.isEmpty,"A failed movie retained intermediate files")
  }
  static func run() async throws {
    let silent = cache.appendingPathComponent("fixture-video.mp4"), original = cache.appendingPathComponent("fixture-original.wav"), source = cache.appendingPathComponent("fixture-source.mp4"), music = cache.appendingPathComponent("fixture-music.wav"), pageAudio = cache.appendingPathComponent("fixture-page.wav")
    try wave(original,seconds: 6) { 0.4*sin($0*440*Double.pi*2) }
    try wave(music,seconds: 3) { time in let hz = time<1 ? 1540.0 : time<2 ? 660.0 : 1760.0; return 0.4*sin(time*hz*Double.pi*2) }
    try wave(pageAudio,seconds: 3) { 0.4*sin($0*880*Double.pi*2) }
    try await video(silent,seconds: 6); try await withOriginalAudio(video: silent,audio: original,destination: source)
    let red = try image("red",color: .red), blue = try image("blue",color: .blue), green = try image("green",color: .green,transparent: true)

    var first = scene(red,seconds: 1.5); first["audio"] = sound(pageAudio,volume: 0.25)
    let middle = scene(source,kind: "video",seconds: 1.75,speed: 2,start: 0.5,volume: 0.25), last = scene(blue,seconds: 1.25)
    var bookSound = sound(music); bookSound["gain"] = [["start": 0.0,"end": 1.5,"volume": 0.12],["start": 1.5,"end": 3.25,"volume": 0.12],["start": 3.25,"end": 4.5,"volume": 1.0]]
    let ordered = request("ordered",scenes: [first,middle,last],soundtrack: bookSound), orderedResult = try await MemoryMovieComposition.make(ordered), orderedFile = output(ordered)
    try retain(orderedFile)
    let a = try await frequencies(orderedFile,time: 0.3), b = try await frequencies(orderedFile,time: 1.8), c = try await frequencies(orderedFile,time: 3.6)
    try require(a["880"]! > 0.05 && a["440"]! < 0.015 && a["660"]! > 0.01 && a["660"]! < 0.04,"First page audio and book ducking are wrong: \(a)")
    try require(b["440"]! > 0.05 && b["440"]! < 0.15 && b["880"]! < 0.02 && b["660"]! > 0.01 && b["660"]! < 0.04,"Speed-adjusted original audio or page boundary is wrong: \(b)")
    try require(c["660"]! > 0.13 && c["660"]! < 0.27 && c["440"]! < 0.015 && c["880"]! < 0.015,"Continuous book music did not regain its volume: \(c)")
    for m in [a,b,c] { try require(m["1540"]! < 0.015 && m["1760"]! < 0.015,"Audio outside the selected book excerpt leaked") }
    let redPixel = try pixel(orderedFile,time: 0.4,x: 360,y: 640), bluePixel = try pixel(orderedFile,time: 3.8,x: 360,y: 640)
    try require(redPixel[0]>220 && redPixel[1]<30 && bluePixel[2]>220 && bluePixel[0]<30,"Memory scene order or picture was lost")
    let coverage = try await trackCoverage(orderedFile,mediaType: .video,expectedDuration: 4.5), audioCoverage = try await trackCoverage(orderedFile,mediaType: .audio,expectedDuration: 4.5)
    results.append(["name":"ordered scenes keep independent page audio and continuous ducked book music","reported":orderedResult,"windows":[a,b,c],"pixels":[redPixel,bluePixel],"video":coverage,"audio":audioCoverage])

    var slowSound = sound(music); slowSound["gain"] = [["start":0.0,"end":4.35,"volume":1.0]]
    let slow = request("slow-fractional",scenes:[scene(source,kind:"video",seconds:4.35,speed:0.5,start:0.25,volume:0.25)],soundtrack:slowSound)
    _ = try await MemoryMovieComposition.make(slow); try retain(output(slow));let slowEarly = try await frequencies(output(slow),time:0.4),slowLate = try await frequencies(output(slow),time:3.9)
    for measured in [slowEarly,slowLate] { try require(measured["440"]!>0.05 && measured["440"]!<0.15 && measured["220"]!<0.02 && measured["660"]!>0.13 && measured["330"]!<0.02,"Slowed original or fractional loop changed pitch: \(measured)") }
    let slowCoverage = try await trackCoverage(output(slow),mediaType:.video,expectedDuration:4.35), slowAudioCoverage = try await trackCoverage(output(slow),mediaType:.audio,expectedDuration:4.35)
    results.append(["name":"slow scenes preserve original pitch and fractional continuous loops","windows":[slowEarly,slowLate],"video":slowCoverage,"audio":slowAudioCoverage])

    let phaseMusic = cache.appendingPathComponent("fixture-phase-music.wav")
    try wave(phaseMusic,seconds:3) { time in let hz = time < 1 ? 1540.0 : time < 1.75 ? 660.0 : time < 2.5 ? 1100.0 : 1760.0; return 0.4*sin(time*hz*Double.pi*2) }
    var phaseSound = sound(phaseMusic); phaseSound["duration"] = 1.5
    phaseSound["gain"] = [["start":0.0,"end":1.1,"volume":0.12],["start":1.1,"end":3.2,"volume":1.0]]
    let phase = request("continuous-phase",scenes:[scene(red,seconds:1.1),scene(blue,seconds:2.1)],soundtrack:phaseSound)
    _ = try await MemoryMovieComposition.make(phase); try retain(output(phase))
    let phaseEarly = try await frequencies(output(phase),time:0.2), phaseBoundary = try await frequencies(output(phase),time:1.12), phaseRepeat = try await frequencies(output(phase),time:1.8), phaseLate = try await frequencies(output(phase),time:2.65)
    try require(phaseEarly["660"]! > 0.01 && phaseEarly["660"]! < 0.04 && phaseEarly["1100"]! < 0.015,"The initial soundtrack ducking is wrong")
    try require(phaseBoundary["1100"]! > 0.13 && phaseBoundary["1100"]! < 0.27 && phaseBoundary["660"]! < 0.015,"The soundtrack restarted at the page or gain boundary: \(phaseBoundary)")
    try require(phaseRepeat["660"]! > 0.13 && phaseRepeat["1100"]! < 0.015 && phaseLate["1100"]! > 0.13 && phaseLate["660"]! < 0.015,"The changing-tone excerpt lost its loop position")
    for measured in [phaseEarly,phaseBoundary,phaseRepeat,phaseLate] { try require(measured["1540"]! < 0.015 && measured["1760"]! < 0.015,"The continuous soundtrack exceeded its selected excerpt") }
    let phaseVideo = try await trackCoverage(output(phase),mediaType:.video,expectedDuration:3.2), phaseAudio = try await trackCoverage(output(phase),mediaType:.audio,expectedDuration:3.2)
    results.append(["name":"changing music preserves excerpt position across a page and duck boundary","windows":[phaseEarly,phaseBoundary,phaseRepeat,phaseLate],"video":phaseVideo,"audio":phaseAudio])

    var voiceScene = scene(red,seconds:3);voiceScene["audio"] = sound(pageAudio,volume:0.25,loop:false)
    let voice = request("voice-once",scenes:[voiceScene,scene(blue,seconds:1.2)])
    _ = try await MemoryMovieComposition.make(voice);try retain(output(voice));let voiceEarly = try await frequencies(output(voice),time:0.2),voiceLate = try await measurement(output(voice),at:1.5)
    try require(voiceEarly["880"]!>0.05 && voiceLate["rms"]!<0.003,"One-pass page voiceover repeated after its excerpt")
    try frame(output(voice),at:4.0);results.append(["name":"one-pass page voiceover leaves later scenes silent","early":voiceEarly,"late":voiceLate])

    var mutedSound = sound(music,volume:0);mutedSound["gain"] = [["start":0.0,"end":1.2,"volume":1.0]]
    let muted = request("muted",scenes:[scene(source,kind:"video",seconds:1.2,volume:0)],soundtrack:mutedSound)
    _ = try await MemoryMovieComposition.make(muted);try retain(output(muted));let silence = try await measurement(output(muted),at:0.4)
    try require(silence["rms"]!<0.003,"Muted source or zero-gain music became audible");results.append(["name":"muted original and zero-gain book music remain silent","audio":silence])

    var moving = scene(red,seconds:2,fade:0.35);moving["motion"] = ["fromScale":1.0,"toScale":1.05,"x":0.04,"y":0.04]
    moving["layers"] = [["uri":green.absoluteString,"start":0.3,"end":1.2]]
    let animated = request("motion",scenes:[moving,scene(blue,seconds:1.2)])
    _ = try await MemoryMovieComposition.make(animated);try retain(output(animated))
    let dark = try pixel(output(animated),time:0,x:360,y:640),bright = try pixel(output(animated),time:0.7,x:360,y:640),timed = try pixel(output(animated),time:0.7,x:130,y:160),gone = try pixel(output(animated),time:1.5,x:130,y:220)
    try require(dark.max()!<35 && bright[0]>220 && timed[1]>180 && timed[0]<60 && gone[0]>200 && gone[1]<60,"Output-time fade, movement or timed artwork is wrong: \([dark,bright,timed,gone])")
    results.append(["name":"full scene fade and motion preserve timed artwork","pixels":[dark,bright,timed,gone]])

    let large = cache.appendingPathComponent("large-oriented.jpg"),format = UIGraphicsImageRendererFormat();format.scale = 1
    let originalImage = UIGraphicsImageRenderer(size:CGSize(width:4000,height:3000),format:format).image { ctx in UIColor.red.setFill();ctx.fill(CGRect(x:0,y:0,width:4000,height:1500));UIColor.blue.setFill();ctx.fill(CGRect(x:0,y:1500,width:4000,height:1500)) }
    let writer = CGImageDestinationCreateWithURL(large as CFURL,UTType.jpeg.identifier as CFString,1,nil)!
    CGImageDestinationAddImage(writer,originalImage.cgImage!,[kCGImagePropertyOrientation:6] as CFDictionary);try require(CGImageDestinationFinalize(writer),"Large fixture image failed")
    let normalized = cache.appendingPathComponent("pc-memory-image-normalized.png")
    let normalizedResult = try await MemoryMovieComposition.prepareImage(["id":"normalize-fixture","inputUri":large.absoluteString,"outputUri":normalized.absoluteString])
    let nWidth = normalizedResult["width"] as! Int,nHeight = normalizedResult["height"] as! Int
    try require(nWidth==1440 && nHeight==1920,"EXIF orientation or bounded downsample was wrong: \(normalizedResult)")
    let transparent = cache.appendingPathComponent("pc-memory-image-transparent.png")
    _ = try await MemoryMovieComposition.prepareImage(["id":"transparent-fixture","inputUri":green.absoluteString,"outputUri":transparent.absoluteString])
    let left = try imagePixel(normalized,x:360,y:960), right = try imagePixel(normalized,x:1080,y:960)
    try require(left[2]>220 && left[0]<35 && right[0]>220 && right[2]<35,"EXIF rotation has the wrong orientation: \([left,right])")
    let clear = try imagePixel(transparent,x:350,y:600), opaque = try imagePixel(transparent,x:130,y:220)
    try require(clear[3]==0 && opaque[3]==255 && opaque[1]>240 && opaque[0]<10,"Normalized PNG alpha or artwork pixels changed: \([clear,opaque])")
    try retain(normalized); try retain(transparent)
    results.append(["name":"private photo normalization applies EXIF and preserves bounded transparent PNG","oriented":normalizedResult,"orientedPixels":[left,right],"alphaPixels":[clear,opaque],"transparentBytes":try files.attributesOfItem(atPath:transparent.path)[.size]!])

    for ext in ["gif","png","webp"] {
      guard let fixture = Bundle.main.url(forResource:"memory-animated",withExtension:ext) else { throw FixtureError.failed("The actual two-frame \(ext) fixture is missing") }
      let disguised = cache.appendingPathComponent("animation-labelled-photo-\(ext).jpg"), badImage = cache.appendingPathComponent("pc-memory-image-bad-\(ext).png")
      try files.copyItem(at:fixture,to:disguised)
      do { _ = try await MemoryMovieComposition.prepareImage(["id":"animated-fixture-\(ext)","inputUri":disguised.absoluteString,"outputUri":badImage.absoluteString]);throw FixtureError.failed("Animated photo bytes were accepted") }
      catch let error as FixtureError { throw error } catch {
        try require(error.localizedDescription.contains("Animated"),"The actual animated container was not recognized: \(error)")
        try require(!files.fileExists(atPath:badImage.path),"Rejected photo retained output")
      }
      try await rejected(request("animated-direct-\(ext)",scenes:[scene(disguised)]))
      var animatedBackground = scene(source,kind:"video"); animatedBackground["backgroundUri"] = disguised.absoluteString
      try await rejected(request("animated-background-\(ext)",scenes:[animatedBackground]))
      var animatedLayer = scene(red); animatedLayer["layers"] = [["uri":disguised.absoluteString,"start":0.0,"end":1.0]]
      try await rejected(request("animated-artwork-\(ext)",scenes:[animatedLayer]))
    }
    results.append(["name":"animated photo bytes are rejected without a partial normalized file","twoFrameContainers":["gif","png","webp"]])

    var bad = scene(red);bad["motion"] = ["fromScale":1.0,"toScale":2.0,"x":0.0,"y":0.0]
    try await rejected(request("bad-motion",scenes:[bad]));try await rejected(request("too-many",scenes:Array(repeating:scene(red),count:83)))
    var missing = scene(red); missing.removeValue(forKey:"transition"); try await rejected(request("missing-transition",scenes:[missing]))
    var badFit = scene(red); var badRecipe = badFit["recipe"] as! [String:Any]; badRecipe["fit"] = "unknown"; badFit["recipe"] = badRecipe; try await rejected(request("invalid-fit",scenes:[badFit]))
    var badIdentity = scene(red); badIdentity["id"] = "bad/id"; try await rejected(request("invalid-id",scenes:[badIdentity]))
    try await rejected(request("tiny-trim",scenes:[scene(source,kind:"video",seconds:0.02)]))
    var foreign = request("foreign-output",scenes:[scene(red)]);foreign["outputUri"] = "file:///tmp/pc-memory-export-escape.mp4";try await rejected(foreign)
    results.append(["name":"invalid bounds and foreign output paths fail without partial movies"])

    let before = Set(try files.contentsOfDirectory(atPath:cache.path)),cancellation = request("cancel",scenes:[scene(red,seconds:30),scene(blue,seconds:30)])
    let work = Task { try await MemoryMovieComposition.make(cancellation) };try await Task.sleep(nanoseconds:30_000_000)
    var contender = scene(source,kind:"video");contender["outputUri"] = cache.appendingPathComponent("pc-story-export-contender.mp4").absoluteString
    contender.removeValue(forKey:"motion"); contender.removeValue(forKey:"transition")
    do { _ = try await StoryVideoComposition.make(contender);throw FixtureError.failed("Concurrent story entered a reserved book encoder") }
    catch let error as FixtureError { throw error } catch { try require(error.localizedDescription == "Another video is still exporting or was cancelled.","Concurrent story failed for a reason other than the encoder reservation: \(error)") }
    MemoryMovieComposition.cancel(cancellation["id"] as! String)
    do { _ = try await work.value;throw FixtureError.failed("Cancelled memory movie unexpectedly completed") }
    catch let error as FixtureError { throw error } catch { try require(!files.fileExists(atPath:output(cancellation).path),"Cancelled movie retained output") }
    let after = Set(try files.contentsOfDirectory(atPath:cache.path))
    try require(after.subtracting(before).filter{$0.hasPrefix("pc-story-export-")||$0.hasPrefix("pc-memory-export-")}.isEmpty,"Cancellation retained intermediate movies")
    var retry = request("retry",scenes:[scene(blue)]);retry["id"] = cancellation["id"]
    _ = try await MemoryMovieComposition.make(retry);try retain(output(retry))
    results.append(["name":"cancellation excludes concurrent story work cleans files and permits same-ID retry"])

    let broken = cache.appendingPathComponent("broken-video.mp4");try Data("not a video".utf8).write(to:broken)
    try await rejected(request("broken",scenes:[scene(red),scene(broken,kind:"video")]))
    results.append(["name":"an unreadable source cannot produce a partial book movie"])
  }
  static func finish(error: Error?) {
    let receipt: [String: Any] = ["passed":error == nil,"cases":results,"diagnostics":diagnostics,"error":error?.localizedDescription as Any? ?? NSNull(),"physicalDevice":false,"photosWritten":false,"networkUsed":false]
    do { try files.createDirectory(at:documents,withIntermediateDirectories:true);try JSONSerialization.data(withJSONObject:receipt,options:[.prettyPrinted,.sortedKeys]).write(to:documents.appendingPathComponent("memory-movie-receipt.json"),options:.atomic) }
    catch { print("Could not save memory movie receipt: \(error)");exit(2) }
    print(error == nil ? "MEMORY_MOVIE_EXPORT_PASSED \(results.count)" : "MEMORY_MOVIE_EXPORT_FAILED \(error!.localizedDescription)");exit(error == nil ? 0 : 1)
  }
}
@MainActor
private final class MemoryMovieHarnessDelegate: UIResponder,UIApplicationDelegate {
  var window:UIWindow?
  func application(_ application:UIApplication,didFinishLaunchingWithOptions options:[UIApplication.LaunchOptionsKey:Any]?) -> Bool {
    window = UIWindow(frame:UIScreen.main.bounds);window?.rootViewController = UIViewController();window?.makeKeyAndVisible()
    Task { do { try await MemoryMovieFixture.run();MemoryMovieFixture.finish(error:nil) } catch { MemoryMovieFixture.finish(error:error) } };return true
  }
}
@main
private struct MemoryMovieHarnessMain {
  @MainActor static func main() { UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(MemoryMovieHarnessDelegate.self)) }
}
