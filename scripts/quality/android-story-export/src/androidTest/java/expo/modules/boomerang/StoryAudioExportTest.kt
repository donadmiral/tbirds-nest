package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Executes the actual production renderer and measures encoded PCM and pixels. */
@RunWith(AndroidJUnit4::class)
@UnstableApi
class StoryAudioExportTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val evidence: File get() = File(context.filesDir, "evidence").apply { mkdirs() }
  private val fixtures: File get() = File(context.filesDir, "fixtures").apply { mkdirs() }
  private val identity = listOf(1.0,0.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0,0.0, 0.0,0.0,1.0,0.0,0.0, 0.0,0.0,0.0,1.0,0.0)

  private fun still(name: String = "split"): File {
    val file = File(fixtures, "$name.png")
    val bitmap = Bitmap.createBitmap(320, 240, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap); val paint = Paint()
    paint.color = Color.RED; canvas.drawRect(0f, 0f, 160f, 240f, paint)
    paint.color = Color.BLUE; canvas.drawRect(160f, 0f, 320f, 240f, paint)
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    return file
  }

  private fun artwork(name: String, color: Int, strip: Boolean = false): File {
    val file = File(fixtures, "$name.png")
    val bitmap = Bitmap.createBitmap(320, 480, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(if (strip) Color.TRANSPARENT else color)
    if (strip) Canvas(bitmap).drawRect(0f, 0f, 320f, 50f, Paint().apply { this.color = color })
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    return file
  }

  private fun quadrants(): File {
    val file = File(fixtures, "asymmetric-quadrants.png")
    val bitmap = Bitmap.createBitmap(320, 240, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap); val paint = Paint()
    for ((index, color) in listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW).withIndex()) {
      paint.color = color
      val x = (index % 2) * 160f; val y = (index / 2) * 120f
      canvas.drawRect(x, y, x + 160, y + 120, paint)
    }
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
    return file
  }

  internal fun wav(name: String = "excerpt", duration: Int = 4, channels: Int = 1, frequency: Int? = null): File {
    val file = File(fixtures, "$name.wav")
    val sampleRate = 48_000; val frames = sampleRate * duration; val dataBytes = frames * channels * 2
    val buffer = ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put("RIFF".toByteArray()).putInt(36 + dataBytes).put("WAVEfmt ".toByteArray()).putInt(16)
      .putShort(1).putShort(channels.toShort()).putInt(sampleRate).putInt(sampleRate * channels * 2)
      .putShort((channels * 2).toShort()).putShort(16).put("data".toByteArray()).putInt(dataBytes)
    for (frame in 0 until frames) {
      val hz = frequency ?: intArrayOf(220, 440, 880, 1760)[minOf(3, frame / sampleRate)]
      val sample = (0.2 * 32767 * sin(2 * PI * hz * frame / sampleRate)).toInt().toShort()
      repeat(channels) { buffer.putShort(sample) }
    }
    file.writeBytes(buffer.array()); return file
  }

  private fun request(name: String, duration: Double = 3.0): MutableMap<String, Any?> = mutableMapOf(
    "id" to "android-$name-${sequence.incrementAndGet()}", "inputUri" to Uri.fromFile(still(name)).toString(), "inputKind" to "image",
    "outputUri" to Uri.fromFile(File(context.cacheDir, "pc-story-export-$name-${sequence.incrementAndGet()}.mp4")).toString(),
    "recipe" to mutableMapOf<String, Any?>("width" to 320, "height" to 480, "trimStart" to 0.0, "trimEnd" to duration,
      "speed" to 1.0, "volume" to 0.0, "fit" to "contain", "scale" to 1.0, "x" to 0.0, "y" to 0.0, "matrix" to identity),
    "layers" to emptyList<Map<String, Any?>>(),
  )

  @Suppress("UNCHECKED_CAST")
  private fun recipe(request: Map<String, Any?>) = request["recipe"] as MutableMap<String, Any?>
  private fun sound(file: File, start: Double = 1.0, duration: Double = 1.0, volume: Double = 1.0, loop: Boolean = true) =
    mapOf("uri" to Uri.fromFile(file).toString(), "start" to start, "duration" to duration, "volume" to volume, "loop" to loop)
  private fun output(request: Map<String, Any?>) = File(Uri.parse(request["outputUri"] as String).path!!)

  private class Pending {
    val latch = CountDownLatch(1)
    val calls = AtomicInteger()
    val value = AtomicReference<Result<Map<String, Any>>?>()
    fun accept(result: Result<Map<String, Any>>) { calls.incrementAndGet(); value.set(result); latch.countDown() }
    fun await(): Result<Map<String, Any>> {
      assertTrue("Renderer did not settle within 100 seconds", latch.await(100, TimeUnit.SECONDS))
      assertEquals("A native request settled twice", 1, calls.get())
      return value.get()!!
    }
  }
  private fun begin(request: Map<String, Any?>): Pending = Pending().also { pending -> StoryVideoComposition.compose(context, request, pending::accept) }
  private fun awaitWriterRelease() {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
    while (System.nanoTime() < deadline) {
      val probe = mapOf<String, Any?>("id" to "idle-probe-${sequence.incrementAndGet()}", "inputUri" to "https://example.invalid/probe")
      val error = begin(probe).await().exceptionOrNull() ?: error("A deliberately invalid probe succeeded")
      if (!error.message.orEmpty().contains("Another video")) return
      Thread.sleep(20)
    }
    error("The cancelled writer did not release its reservation.")
  }
  private fun export(request: Map<String, Any?>, name: String): File {
    val result = begin(request).await().getOrThrow()
    val file = output(request)
    assertEquals(request["outputUri"], result["uri"])
    assertEquals(file.length(), (result["bytes"] as Number).toLong())
    assertEquals(recipe(request)["width"], result["width"]); assertEquals(recipe(request)["height"], result["height"])
    if (request["audio"] != null) assertEquals(true, result["soundtrackMixed"])
    assertTrue(file.length() > 1024)
    return file.copyTo(File(evidence, "$name.mp4"), overwrite = true).also { file.delete() }
  }

  internal data class Audio(val rate: Int, val samples: FloatArray) {
    fun amplitude(hz: Int, from: Double, to: Double): Double {
      val first = (from * rate).toInt().coerceIn(0, samples.size)
      val end = (to * rate).toInt().coerceIn(first, samples.size)
      if (end == first) return 0.0
      var sine = 0.0; var cosine = 0.0
      for (i in first until end) {
        sine += samples[i] * sin(2 * PI * hz * i / rate)
        cosine += samples[i] * cos(2 * PI * hz * i / rate)
      }
      return 2 * sqrt(sine * sine + cosine * cosine) / (end - first)
    }
    fun rms(from: Double, to: Double): Double {
      val first = (from * rate).toInt().coerceIn(0, samples.size)
      val end = (to * rate).toInt().coerceIn(first, samples.size)
      if (end == first) return 0.0
      var sum = 0.0; for (i in first until end) sum += samples[i] * samples[i]
      return sqrt(sum / (end - first))
    }
  }

  internal fun decodeAudio(file: File): Audio {
    val extractor = MediaExtractor(); var decoder: MediaCodec? = null
    try {
      extractor.setDataSource(file.path)
      val track = (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
        ?: error("Exported file has no audio track: ${file.name}")
      val inputFormat = extractor.getTrackFormat(track); extractor.selectTrack(track)
      val codec = MediaCodec.createDecoderByType(inputFormat.getString(MediaFormat.KEY_MIME)!!); decoder = codec
      codec.configure(inputFormat, null, null, 0); codec.start()
      var rate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = C.ENCODING_PCM_16BIT
      val samples = ArrayList<Float>(); val info = MediaCodec.BufferInfo()
      var inputEnded = false; var ended = false; val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
      while (!ended) {
        check(System.nanoTime() < deadline) { "Output audio decoding timed out." }
        if (!inputEnded) {
          val index = codec.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = codec.getInputBuffer(index)!!; buffer.clear()
            val count = extractor.readSampleData(buffer, 0)
            if (count < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputEnded = true }
            else { codec.queueInputBuffer(index, 0, count, extractor.sampleTime, 0); extractor.advance() }
          }
        }
        val index = codec.dequeueOutputBuffer(info, 10_000)
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val format = codec.outputFormat; rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          encoding = if (format.containsKey(MediaFormat.KEY_PCM_ENCODING)) format.getInteger(MediaFormat.KEY_PCM_ENCODING) else C.ENCODING_PCM_16BIT
        } else if (index >= 0) {
          val buffer = codec.getOutputBuffer(index)!!.duplicate().order(ByteOrder.LITTLE_ENDIAN)
          buffer.position(info.offset); buffer.limit(info.offset + info.size)
          val bytes = if (encoding == C.ENCODING_PCM_FLOAT) 4 else 2
          require(encoding == C.ENCODING_PCM_FLOAT || encoding == C.ENCODING_PCM_16BIT) { "Unexpected decoded PCM format" }
          while (buffer.remaining() >= channels * bytes) {
            samples.add(if (encoding == C.ENCODING_PCM_FLOAT) buffer.float else buffer.short / 32768f)
            repeat(channels - 1) { buffer.position(buffer.position() + bytes) }
          }
          ended = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(index, false)
        }
      }
      assertTrue("The encoded audio has no decoded frames", samples.isNotEmpty())
      return Audio(rate, samples.toFloatArray())
    } finally { try { decoder?.stop() } catch (_: Exception) {} ; decoder?.release(); extractor.release() }
  }

  internal fun duration(file: File): Double {
    val retriever = MediaMetadataRetriever()
    try { retriever.setDataSource(file.path); return retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toDouble() / 1000 }
    finally { retriever.release() }
  }
  internal fun videoFrames(file: File): Int {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      val index = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
      extractor.selectTrack(index)
      var frames = 0
      while (extractor.sampleTime >= 0) { frames++; if (!extractor.advance()) break }
      return frames
    } finally { extractor.release() }
  }
  private fun pixel(file: File, time: Double, x: Int, y: Int): Int {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val frame = retriever.getFrameAtTime((time * 1_000_000).toLong(), MediaMetadataRetriever.OPTION_CLOSEST) ?: error("The encoded frame cannot be decoded.")
      try { assertEquals(320, frame.width); assertEquals(480, frame.height); return frame.getPixel(x, y) }
      finally { frame.recycle() }
    } finally { retriever.release() }
  }
  private fun nearColor(expected: Int, actual: Int) {
    for (shift in listOf(16, 8, 0)) assertTrue("Expected color ${Integer.toHexString(expected)}, got ${Integer.toHexString(actual)}", abs((expected shr shift and 255) - (actual shr shift and 255)) <= 30)
  }
  private fun record(name: String, values: Map<String, Any>) {
    synchronized(records) { records.put(JSONObject(values + mapOf("case" to name, "passed" to true))) }
  }

  @Test fun selectedExcerptLoopsThroughActualStillMovie() {
    val request = request("loop"); request["audio"] = sound(wav())
    val file = export(request, "selected-excerpt-loop"); val audio = decodeAudio(file)
    val measured = listOf(.25, 1.25, 2.25).map { audio.amplitude(440, it, it + .5) }
    measured.forEach { assertTrue("The selected excerpt did not fill a loop", it > .1) }
    assertTrue(audio.amplitude(220, .25, 2.75) < .01)
    assertTrue(audio.amplitude(880, .25, 2.75) < .01)
    assertEquals(3.0, duration(file), .15)
    record("selected excerpt and repeated loops", mapOf("amplitudes440Hz" to measured, "duration" to duration(file)))
  }

  @Test fun onePassVoiceoverEndsInSilenceWithoutShorteningVideo() {
    val request = request("voiceover"); request["audio"] = sound(wav(), loop = false)
    val file = export(request, "one-pass-voiceover"); val audio = decodeAudio(file)
    assertTrue(audio.amplitude(440, .2, .8) > .1)
    assertTrue("Voiceover repeated after its excerpt", audio.rms(1.5, 2.8) < .005)
    assertEquals(3.0, duration(file), .15)
    record("one-pass voiceover", mapOf("firstRms" to audio.rms(.2, .8), "tailRms" to audio.rms(1.5, 2.8)))
  }

  @Test fun longVoiceoverIsClippedToTheOutputMovie() {
    val request = request("short-movie", 1.5); request["audio"] = sound(wav(), start = 0.0, duration = 4.0, loop = false)
    val file = export(request, "voiceover-clipped-to-movie")
    assertEquals(1.5, duration(file), .15)
    val audio = decodeAudio(file); assertTrue(audio.amplitude(220, .2, .8) > .1)
    record("voiceover cannot extend video", mapOf("duration" to duration(file)))
  }

  @Test fun soundtrackVolumeAndZeroGainAreEncoded() {
    val request = request("volume", 2.0); request["audio"] = sound(wav(), volume = .25)
    val file = export(request, "quarter-volume"); val audio = decodeAudio(file)
    val amplitude = audio.amplitude(440, .2, 1.8)
    assertTrue("Volume differs from the editor's quarter-gain scale: $amplitude", amplitude in .04.. .06)
    val silent = request("zero-gain", 2.0); silent["audio"] = sound(wav(), volume = 0.0)
    val silentFile = export(silent, "zero-volume"); val silentAudio = decodeAudio(silentFile)
    assertTrue("Zero gain produced audible PCM", silentAudio.rms(.2, 1.8) < .002)
    record("soundtrack gain", mapOf("quarterAmplitude" to amplitude, "zeroRms" to silentAudio.rms(.2, 1.8)))
  }

  internal fun sourceMovie(name: String = "source"): File {
    val request = request(name, 4.0); request["audio"] = sound(wav("original-tone", frequency = 330), 0.0, 4.0)
    return export(request, "$name-original-330hz")
  }

  @Test fun videoTrimSpeedAndOriginalMixStayAlignedWithIndependentSoundtrack() {
    val source = sourceMovie()
    val request = request("video-mix", 4.0)
    request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    recipe(request).putAll(mapOf("trimStart" to 1.0, "trimEnd" to 3.0, "speed" to 2.0, "volume" to .5))
    request["audio"] = sound(wav(), volume = .25)
    val file = export(request, "trim-speed-original-mix"); val audio = decodeAudio(file)
    assertEquals(1.0, duration(file), .15)
    assertTrue("The speed change bypassed the actual output frame-rate bound", videoFrames(file) in 20..33)
    val original = audio.amplitude(330, .2, .8); val soundtrack = audio.amplitude(440, .2, .8)
    assertTrue("Original audio gain or pitch failed: $original", original in .05.. .15)
    assertTrue("Added audio gain or independent speed failed: $soundtrack", soundtrack in .02.. .08)
    assertTrue("Original pitch changed with video speed", audio.amplitude(660, .2, .8) < .02)
    record("trim speed and independent mix", mapOf("duration" to duration(file), "videoFrames" to videoFrames(file), "original330Hz" to original, "soundtrack440Hz" to soundtrack))
  }

  @Test fun mutedOriginalDoesNotLeakIntoTheMovie() {
    val source = sourceMovie("mute-source")
    val request = request("mute-original", 2.0); request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    request["audio"] = sound(wav(), volume = .5)
    val file = export(request, "muted-original"); val audio = decodeAudio(file)
    assertTrue(audio.amplitude(330, .2, 1.8) < .01)
    assertTrue(audio.amplitude(440, .2, 1.8) > .05)
    record("original mute", mapOf("original330Hz" to audio.amplitude(330, .2, 1.8), "soundtrack440Hz" to audio.amplitude(440, .2, 1.8)))
  }

  @Test fun slowedVideoRepeatsOnlyTheSelectedExcerptThroughItsPartialFinalLoop() {
    val source = sourceMovie("slow-mix-source")
    val request = request("slow-video-mix", 3.0)
    request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    recipe(request).putAll(mapOf("trimStart" to 1.0, "trimEnd" to 3.175, "speed" to .5, "volume" to .25))
    request["audio"] = sound(wav(), start = 1.0, duration = 1.5, volume = .5)
    val file = export(request, "slow-video-fractional-soundtrack-loop"); val audio = decodeAudio(file)
    assertEquals(4.35, duration(file), .15)
    assertTrue("The slowed output exceeded its frame bound", videoFrames(file) in 60..142)
    val first = audio.amplitude(440, .2, .8)
    val selectedTail = audio.amplitude(880, 1.1, 1.35)
    val repeated = audio.amplitude(440, 1.8, 2.3)
    val finalPartial = audio.amplitude(440, 3.2, 3.8)
    val finalTail = audio.amplitude(880, 4.1, 4.25)
    listOf(first, selectedTail, repeated, finalPartial, finalTail).forEach { assertTrue("The selected excerpt did not fill the edited timeline: $it", it in .07.. .13) }
    assertTrue("Original slow-motion pitch or volume changed", audio.amplitude(330, 2.2, 3.7) in .03.. .07)
    assertTrue("Audio before the selected excerpt leaked", audio.amplitude(220, .2, 4.25) < .01)
    assertTrue("Audio after the selected excerpt leaked", audio.amplitude(1760, .2, 4.25) < .01)
    record("slowed video and final partial soundtrack loop", mapOf("duration" to duration(file),
      "videoFrames" to videoFrames(file), "first440Hz" to first, "selected880Hz" to selectedTail,
      "repeated440Hz" to repeated, "finalPartial440Hz" to finalPartial, "finalTail880Hz" to finalTail))
  }

  @Test fun originalOnlyAudioIsPreservedAndMeasured() {
    val source = sourceMovie("original-only-source")
    val request = request("original-only", 2.0); request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    recipe(request)["volume"] = .4
    val file = export(request, "original-only-mix"); val audio = decodeAudio(file)
    val amplitude = audio.amplitude(330, .2, 1.8)
    assertTrue("Original-only audio was dropped or its gain changed: $amplitude", amplitude in .06.. .10)
    record("original-only audio", mapOf("amplitude330Hz" to amplitude))
  }

  @Test fun trimmingPastShortOriginalAudioProducesAValidSilentMovie() {
    val sourceRequest = request("short-source-audio", 3.0)
    sourceRequest["audio"] = sound(wav(), loop = false)
    val source = export(sourceRequest, "source-with-short-audio")
    val request = request("silent-trim", 2.5); request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    recipe(request).putAll(mapOf("trimStart" to 1.5, "trimEnd" to 2.5, "volume" to 1.0))
    val file = export(request, "trim-after-original-audio")
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      assertFalse((0 until extractor.trackCount).any { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true })
    } finally { extractor.release() }
    assertEquals(1.0, duration(file), .15)
    record("no-overlap original audio", mapOf("duration" to duration(file), "silentTrim" to true))
  }

  @Test fun canvasBackgroundAndTimedArtworkMatchDecodedPixels() {
    val request = request("artwork", 2.0)
    request["backgroundUri"] = Uri.fromFile(artwork("yellow-background", Color.YELLOW)).toString()
    request["layers"] = listOf(mapOf("uri" to Uri.fromFile(artwork("green-strip", Color.GREEN, strip = true)).toString(), "start" to .5, "end" to 1.25))
    val file = export(request, "canvas-and-timed-artwork")
    nearColor(Color.YELLOW, pixel(file, .2, 10, 10))
    nearColor(Color.GREEN, pixel(file, .8, 10, 10))
    nearColor(Color.YELLOW, pixel(file, 1.6, 10, 10))
    nearColor(Color.RED, pixel(file, .8, 40, 240)); nearColor(Color.BLUE, pixel(file, .8, 280, 240))
    record("background framing and timed layers", mapOf("before" to pixel(file, .2, 10, 10), "during" to pixel(file, .8, 10, 10), "after" to pixel(file, 1.6, 10, 10)))
  }

  @Test fun fullColorMatrixScaleAndTranslationMatchPixels() {
    val request = request("matrix", 2.0)
    val matrix = identity.toMutableList(); matrix[0] = 0.0; matrix[2] = 1.0; matrix[10] = 1.0; matrix[12] = 0.0
    recipe(request).putAll(mapOf("matrix" to matrix, "scale" to .5, "x" to .25))
    request["backgroundUri"] = Uri.fromFile(artwork("matrix-background", Color.YELLOW)).toString()
    val file = export(request, "matrix-scale-translation")
    nearColor(Color.YELLOW, pixel(file, .5, 80, 240))
    nearColor(Color.BLUE, pixel(file, .5, 180, 240)); nearColor(Color.RED, pixel(file, .5, 280, 240))
    record("color matrix and geometry", mapOf("background" to pixel(file, .5, 80, 240), "left" to pixel(file, .5, 180, 240), "right" to pixel(file, .5, 280, 240)))
  }

  @Test fun matrixAlphaAndBiasAreNotDroppedByAFourByFourShortcut() {
    val request = request("alpha", 2.0)
    val matrix = identity.toMutableList(); matrix[18] = .5; matrix[9] = .1
    recipe(request)["matrix"] = matrix
    request["backgroundUri"] = Uri.fromFile(artwork("alpha-background", Color.YELLOW)).toString()
    val file = export(request, "matrix-alpha-bias")
    nearColor(Color.rgb(255, 140, 0), pixel(file, .5, 40, 240))
    nearColor(Color.rgb(128, 140, 128), pixel(file, .5, 280, 240))
    record("matrix alpha and fifth-column bias", mapOf("left" to pixel(file, .5, 40, 240), "right" to pixel(file, .5, 280, 240)))
  }

  @Test fun verticalTextureOrientationAndBothTranslationDirectionsMatchTheCanvas() {
    val image = quadrants(); val background = artwork("vertical-background", Color.MAGENTA)
    val positive = request("positive-y", 2.0); positive["inputUri"] = Uri.fromFile(image).toString()
    positive["backgroundUri"] = Uri.fromFile(background).toString(); recipe(positive)["y"] = .25
    val down = export(positive, "positive-y-orientation")
    nearColor(Color.MAGENTA, pixel(down, .5, 40, 180))
    nearColor(Color.RED, pixel(down, .5, 40, 270)); nearColor(Color.GREEN, pixel(down, .5, 280, 270))
    nearColor(Color.BLUE, pixel(down, .5, 40, 450)); nearColor(Color.YELLOW, pixel(down, .5, 280, 450))
    val negative = request("negative-y", 2.0); negative["inputUri"] = Uri.fromFile(image).toString()
    negative["backgroundUri"] = Uri.fromFile(background).toString(); recipe(negative)["y"] = -.25
    val up = export(negative, "negative-y-orientation")
    nearColor(Color.RED, pixel(up, .5, 40, 30)); nearColor(Color.BLUE, pixel(up, .5, 40, 210))
    nearColor(Color.MAGENTA, pixel(up, .5, 40, 330))
    record("vertical orientation and signed y translation", mapOf("positiveTop" to pixel(down, .5, 40, 270), "positiveBottom" to pixel(down, .5, 40, 450), "negativeTop" to pixel(up, .5, 40, 30)))
  }

  @Test fun trimmedAndAcceleratedVideoUsesOutputTimeForArtwork() {
    val source = sourceMovie("timed-video-source")
    val request = request("timed-video", 3.0); request["inputKind"] = "video"; request["inputUri"] = Uri.fromFile(source).toString()
    recipe(request).putAll(mapOf("trimStart" to 1.0, "trimEnd" to 3.0, "speed" to 2.0, "volume" to .5))
    request["layers"] = listOf(mapOf("uri" to Uri.fromFile(artwork("video-green-strip", Color.GREEN, strip = true)).toString(), "start" to .25, "end" to .6))
    val file = export(request, "video-output-time-artwork")
    nearColor(Color.BLACK, pixel(file, .1, 10, 10))
    nearColor(Color.GREEN, pixel(file, .4, 10, 10))
    nearColor(Color.BLACK, pixel(file, .85, 10, 10))
    record("output-time artwork after trim and speed", mapOf("before" to pixel(file, .1, 10, 10), "during" to pixel(file, .4, 10, 10), "after" to pixel(file, .85, 10, 10)))
  }

  @Test fun invalidInputsCannotOverwriteOrEscapeTheCache() {
    val overwrite = request("overwrite"); val original = byteArrayOf(1,2,3,4); output(overwrite).writeBytes(original)
    assertTrue(begin(overwrite).await().isFailure); assertArrayEquals(original, output(overwrite).readBytes())
    val remote = request("remote"); remote["inputUri"] = "https://example.invalid/media.mp4"
    assertTrue(begin(remote).await().isFailure); assertFalse(output(remote).exists())
    val escaped = request("escape"); escaped["outputUri"] = Uri.fromFile(File(context.filesDir, "pc-story-export-escape.mp4")).toString()
    assertTrue(begin(escaped).await().isFailure); assertFalse(output(escaped).exists())
    val invalid = request("invalid"); recipe(invalid)["speed"] = Double.NaN
    assertTrue(begin(invalid).await().isFailure); assertFalse(output(invalid).exists())
    val badAudio = request("bad-audio"); badAudio["audio"] = sound(wav(), start = 3.5, duration = 2.0)
    assertTrue(begin(badAudio).await().isFailure); assertFalse(output(badAudio).exists())
    record("bounded local inputs and no overwrite", mapOf("rejected" to 5))
  }

  @Test fun cancellationStopsTheWriterCleansThePartialAndAllowsRetry() {
    val request = request("cancel", 30.0); request["audio"] = sound(wav())
    val pending = begin(request)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
    while (output(request).length() <= 1024 && pending.latch.count > 0 && System.nanoTime() < deadline) Thread.sleep(10)
    assertTrue("Expected an active encoder before cancelling", pending.latch.count > 0)
    assertTrue("Cancellation did not reach a real partial movie", output(request).length() > 1024)
    val duplicate = request("duplicate", 2.0)
    assertTrue(begin(duplicate).await().exceptionOrNull()?.message?.contains("Another video") == true)
    StoryVideoComposition.cancel(request["id"] as String)
    assertTrue(pending.await().isFailure)
    awaitWriterRelease()
    assertFalse("The cancelled partial movie survived", output(request).exists())
    val retry = request("retry", 1.0); val file = export(retry, "retry-after-cancel")
    assertEquals(1.0, duration(file), .15); assertEquals(1, pending.calls.get())
    record("real cancellation cleanup and retry", mapOf("partialRemoved" to true, "singleJobEnforced" to true, "retryDuration" to duration(file)))
  }

  @Test fun backgroundCancellationSettlesOnceAndPreservesTheDraftInputs() {
    val request = request("background", 20.0)
    val input = File(Uri.parse(request["inputUri"] as String).path!!)
    val before = input.readBytes()
    val pending = begin(request); StoryVideoComposition.cancelAll()
    assertTrue(pending.await().isFailure)
    awaitWriterRelease()
    assertFalse(output(request).exists()); assertArrayEquals(before, input.readBytes()); assertEquals(1, pending.calls.get())
    record("background cancellation", mapOf("inputPreserved" to true, "partialRemoved" to true))
  }

  @Test fun fullPortraitResolutionProducesActualVideoAndSoundtrack() {
    val request = request("full-portrait", 1.0); recipe(request).putAll(mapOf("width" to 1080, "height" to 1920))
    request["audio"] = sound(wav())
    val file = export(request, "full-1080x1920-portrait"); val audio = decodeAudio(file)
    assertTrue(audio.amplitude(440, .2, .8) in .17.. .23)
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val frame = retriever.getFrameAtTime(500_000, MediaMetadataRetriever.OPTION_CLOSEST)!!
      try { assertEquals(1080, frame.width); assertEquals(1920, frame.height) } finally { frame.recycle() }
    } finally { retriever.release() }
    record("full portrait encode", mapOf("width" to 1080, "height" to 1920, "amplitude440Hz" to audio.amplitude(440, .2, .8)))
  }

  @Test fun cancellationAtTheCompletionBoundaryCannotLeaveARejectedOutput() {
    var rejected = 0; var completed = 0
    repeat(4) { attempt ->
      val request = request("completion-race-$attempt", 1.0); request["audio"] = sound(wav())
      val pending = begin(request); val file = output(request)
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
      while (pending.latch.count > 0 && System.nanoTime() < deadline) {
        if (file.length() > 1024) {
          val tail = try {
            RandomAccessFile(file, "r").use { input ->
              val length = minOf(128_000L, input.length()).toInt()
              input.seek(input.length() - length); ByteArray(length).also(input::readFully)
            }
          } catch (_: Exception) { ByteArray(0) }
          if (String(tail, Charsets.ISO_8859_1).contains("moov")) break
        }
        Thread.sleep(1)
      }
      StoryVideoComposition.cancel(request["id"] as String)
      val result = pending.await(); awaitWriterRelease()
      if (result.isFailure) { rejected++; assertFalse("Cancelled terminal output was retained", file.exists()) }
      else { completed++; assertTrue(file.length() > 1024); file.delete() }
      assertEquals(1, pending.calls.get())
    }
    record("completion cancellation race", mapOf("attempts" to 4, "rejectedAndCleaned" to rejected, "completedBeforeCancellation" to completed))
  }

  private fun stagingFiles() = context.cacheDir.listFiles()?.filter { it.name.startsWith("pc-story-input-") } ?: emptyList()

  @Test fun unknownLengthContentAndReadableExternalVideoAreStagedAndRemoved() {
    val source = sourceMovie("provider-source")
    val request = request("provider-input", 2.0); request["inputKind"] = "video"
    request["inputUri"] = "content://app.platinumcircles.storyexporttest.media/file/${source.name}"
    recipe(request)["volume"] = .5
    val file = export(request, "unknown-length-provider-input")
    assertTrue(decodeAudio(file).amplitude(330, .2, 1.8) in .08.. .12)
    assertTrue("Content source temp was retained", stagingFiles().isEmpty())
    assertTrue(source.exists())
    val external = File(context.externalCacheDir!!, "external-video-fixture.mp4")
    source.copyTo(external, overwrite = true)
    val other = request("external-input", 1.0); other["inputKind"] = "video"; other["inputUri"] = Uri.fromFile(external).toString()
    export(other, "readable-external-input"); assertTrue(external.exists()); external.delete()
    assertTrue(stagingFiles().isEmpty())
    record("bounded source staging", mapOf("unknownLengthProvider" to true, "externalSourcePreserved" to true, "temporaryFilesRemoved" to true))
  }

  @Test fun oversizedUnknownLengthProviderCannotConsumeUnboundedDisk() {
    val id = "oversize-${sequence.incrementAndGet()}"
    val request = request("oversize-provider", 2.0); request["inputKind"] = "video"
    request["inputUri"] = "content://app.platinumcircles.storyexporttest.media/oversize/$id"
    val pending = begin(request)
    var peak = 0L
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90)
    while (pending.latch.count > 0 && System.nanoTime() < deadline) {
      peak = maxOf(peak, stagingFiles().sumOf { it.length() }); Thread.sleep(10)
    }
    val result = pending.await(); awaitWriterRelease()
    assertTrue("Expected the real byte ceiling, got ${result.exceptionOrNull()}", result.exceptionOrNull()?.message?.contains("512 MiB") == true)
    assertTrue(peak <= 512L * 1024 * 1024)
    assertTrue(stagingFiles().isEmpty()); assertFalse(output(request).exists())
    record("unknown-size byte ceiling", mapOf("peakTemporaryBytes" to peak, "providerWrittenBytes" to FixtureMediaProvider.written(id), "limitBytes" to 512L * 1024 * 1024))
  }

  @Test fun knownLengthProviderDoesNotNeedEofAndCannotHideAnEarlyEnd() {
    val source = sourceMovie("known-provider-source")
    val request = request("known-provider", 1.0); request["inputKind"] = "video"
    request["inputUri"] = "content://app.platinumcircles.storyexporttest.media/known/${source.name}"
    val file = export(request, "known-length-open-provider")
    assertTrue("The fixture unexpectedly closed its pipe", FixtureMediaProvider.isOpen(source.name))
    assertTrue(stagingFiles().isEmpty()); assertEquals(1.0, duration(file), .15)
    FixtureMediaProvider.closeAll()
    val truncated = request("truncated-provider", 1.0); truncated["inputKind"] = "video"
    truncated["inputUri"] = "content://app.platinumcircles.storyexporttest.media/truncated/${source.name}"
    val result = begin(truncated).await(); awaitWriterRelease()
    assertTrue(result.exceptionOrNull()?.message?.contains("declared size") == true)
    assertTrue(stagingFiles().isEmpty()); assertFalse(output(truncated).exists())
    val range = request("range-provider", 1.0); range["inputKind"] = "video"
    range["inputUri"] = "content://app.platinumcircles.storyexporttest.media/range/${source.name}"
    assertEquals(1.0, duration(export(range, "seekable-provider-range")), .15)
    File(context.cacheDir, "provider-range-${source.name}").delete()
    val offsetId = "offset-${sequence.incrementAndGet()}"
    val offset = request("offset-provider", 1.0); offset["inputKind"] = "video"
    offset["inputUri"] = "content://app.platinumcircles.storyexporttest.media/offset/$offsetId"
    val began = System.nanoTime(); val offsetResult = begin(offset).await(); awaitWriterRelease()
    val elapsed = (System.nanoTime() - began) / 1_000_000
    assertTrue(offsetResult.exceptionOrNull()?.message?.contains("streamed video range") == true)
    assertTrue("A pipe constructor consumed its huge offset", elapsed < 3000)
    assertEquals(0L, FixtureMediaProvider.written(offsetId)); assertTrue(FixtureMediaProvider.isOpen(offsetId))
    assertTrue(stagingFiles().isEmpty()); assertFalse(output(offset).exists())
    record("declared-length provider boundary", mapOf("succeededWithoutEof" to true, "earlyEndRejected" to true,
      "seekableOffsetAccepted" to true, "streamedOffsetRejectedMilliseconds" to elapsed, "temporaryFilesRemoved" to true))
  }

  @Test fun blockedContentProviderCanBeCancelledWithoutWaitingForAnotherChunk() {
    val id = "blocked-${sequence.incrementAndGet()}"
    val request = request("blocked-provider", 2.0); request["inputKind"] = "video"
    request["inputUri"] = "content://app.platinumcircles.storyexporttest.media/blocked/$id"
    val pending = begin(request)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
    while (FixtureMediaProvider.written(id) == 0L && System.nanoTime() < deadline) Thread.sleep(10)
    assertEquals(64L * 1024, FixtureMediaProvider.written(id)); assertTrue(FixtureMediaProvider.isOpen(id))
    val cancelledAt = System.nanoTime(); StoryVideoComposition.cancel(request["id"] as String)
    assertTrue(pending.await().isFailure); awaitWriterRelease()
    val elapsed = (System.nanoTime() - cancelledAt) / 1_000_000
    assertTrue("A blocked read delayed cancellation: ${elapsed}ms", elapsed < 3000)
    assertTrue("Provider unexpectedly supplied EOF before our check", FixtureMediaProvider.isOpen(id))
    assertTrue(stagingFiles().isEmpty()); assertFalse(output(request).exists())
    val retry = request("provider-retry", 1.0); export(retry, "retry-after-blocked-provider")
    record("blocked provider cancellation", mapOf("milliseconds" to elapsed, "providerStillOpen" to true, "temporaryFilesRemoved" to true, "retryPassed" to true))
  }

  @After fun stopAnyFailedJob() { StoryVideoComposition.cancelAll(); awaitWriterRelease(); FixtureMediaProvider.closeAll() }

  companion object {
    private val sequence = AtomicInteger()
    private val records = JSONArray()
    @JvmStatic @AfterClass fun saveReceipt() {
      val context = InstrumentationRegistry.getInstrumentation().targetContext
      val directory = File(context.filesDir, "evidence").apply { mkdirs() }
      File(directory, "receipt.json").writeText(JSONObject().put("sdk", Build.VERSION.SDK_INT)
        .put("model", Build.MODEL).put("abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
        .put("renderer", "Actual production StoryVideoComposition.kt and StoryVideoEffects.kt")
        .put("media3Version", "1.11.1").put("cases", records)
        .put("physicalDeviceAcceptance", false).toString(2) + "\n")
    }
  }
}
