package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

/** Actual encoded tracks and decoded pixels/PCM. No provider or user data. */
@RunWith(AndroidJUnit4::class)
@UnstableApi
class ReactVideoExportTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val fixtures: File get() = File(context.filesDir, "react-fixtures").apply { mkdirs() }
  private val evidence: File get() = File(context.filesDir, "evidence").apply { mkdirs() }
  private val audio = StoryAudioExportTest()
  private val identity = listOf(1.0,0.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0,0.0, 0.0,0.0,1.0,0.0,0.0, 0.0,0.0,0.0,1.0,0.0)
  private fun uri(file: File) = Uri.fromFile(file).toString()
  private class Pending {
    val latch = CountDownLatch(1); val calls = AtomicInteger(); val result = AtomicReference<Result<Map<String, Any>>?>()
    fun accept(value: Result<Map<String, Any>>) { calls.incrementAndGet(); result.set(value); latch.countDown() }
    fun await(): Result<Map<String, Any>> {
      assertTrue("Reaction export did not settle", latch.await(180, TimeUnit.SECONDS))
      assertEquals(1, calls.get()); return result.get()!!
    }
  }
  private fun image(name: String, color: Int, width: Int = 320, height: Int = 480, overlay: Boolean = false): File {
    val file = File(fixtures, "$name.png")
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      bitmap.eraseColor(if (overlay) Color.TRANSPARENT else color)
      if (overlay) Canvas(bitmap).drawRect(0f, 0f, width.toFloat(), 70f, Paint().apply { this.color = color })
      file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
    } finally { bitmap.recycle() }
    return file
  }
  private fun movie(name: String, colors: List<Int>, frequency: Int): File {
    val cached = File(fixtures, "$name.mp4"); if (cached.isFile) return cached
    val output = File(context.cacheDir, "pc-story-export-react-$name-${ids.incrementAndGet()}.mp4")
    val frames = colors.mapIndexed { index, color -> image("$name-$index", color) }
    val request = mapOf<String, Any?>("id" to "react-fixture-${ids.incrementAndGet()}", "inputUri" to uri(frames[0]), "inputKind" to "image", "outputUri" to uri(output),
      "recipe" to mapOf("width" to 320, "height" to 480, "trimStart" to 0.0, "trimEnd" to 4.0, "speed" to 1.0, "volume" to 0.0, "fit" to "cover", "scale" to 1.0, "x" to 0.0, "y" to 0.0, "matrix" to identity),
      "layers" to frames.mapIndexed { index, file -> mapOf("uri" to uri(file), "start" to index.toDouble(), "end" to index + 1.0) },
      "audio" to mapOf("uri" to uri(audio.wav("react-$frequency", frequency = frequency)), "start" to 0.0, "duration" to 4.0, "volume" to 1.0, "loop" to false))
    val pending = Pending(); StoryVideoComposition.compose(context, request, pending::accept); pending.await().getOrThrow()
    return output.copyTo(cached, overwrite = true).also { output.delete() }
  }
  private fun camera() = movie("camera", listOf(Color.CYAN, Color.MAGENTA, Color.WHITE, Color.BLACK), 220)
  private fun source() = movie("source", listOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW), 880)
  private fun segment(start: Double, end: Double, sourceStart: Double, playing: Boolean, volume: Double = .25) = mapOf("start" to start, "end" to end, "sourceStart" to sourceStart, "playing" to playing, "volume" to if (playing) volume else 0.0)
  private fun request(name: String): MutableMap<String, Any?> = mutableMapOf(
    "id" to "react-$name-${ids.incrementAndGet()}", "sourceUri" to uri(source()), "sourceKind" to "video", "cameraUri" to uri(camera()),
    "outputUri" to uri(File(context.cacheDir, "pc-react-export-$name-${ids.incrementAndGet()}.mp4")),
    "width" to 720, "height" to 1280, "cameraStart" to 0.0, "duration" to 3.0,
    "sourceRect" to mapOf("x" to 0.0, "y" to 0.0, "width" to .5, "height" to 1.0),
    "faceRect" to mapOf("x" to .5, "y" to 0.0, "width" to .5, "height" to 1.0),
    "voiceVolume" to .5, "sourceZoom" to 1.0, "cutout" to false,
    "segments" to listOf(segment(0.0, 1.0, 0.0, true), segment(1.0, 2.0, .6, false), segment(2.0, 3.0, 1.0, true)))
  private fun output(request: Map<String, Any?>) = File(Uri.parse(request["outputUri"] as String).path!!)
  private fun begin(request: Map<String, Any?>) = Pending().also { ReactVideoComposition.compose(context, request, it::accept) }
  private fun export(request: Map<String, Any?>, name: String): File {
    val result = begin(request).await().getOrThrow(); val file = output(request)
    assertEquals(request["outputUri"], result["uri"]); assertEquals(720, result["width"]); assertEquals(1280, result["height"])
    assertEquals((request["segments"] as List<*>).size, result["segmentCount"])
    assertEquals((request["voiceVolume"] as Number).toDouble() > 0, result["voiceMixed"])
    assertEquals((request["duration"] as Number).toDouble(), audio.duration(file), .2)
    return file.copyTo(File(evidence, "$name.mp4"), overwrite = true).also { file.delete() }
  }
  private fun pixel(file: File, seconds: Double, x: Int, y: Int): Int {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val frame = retriever.getFrameAtTime((seconds * 1_000_000).toLong(), MediaMetadataRetriever.OPTION_CLOSEST) ?: error("No encoded reaction frame")
      try { assertEquals(720, frame.width); assertEquals(1280, frame.height); return frame.getPixel(x, y) } finally { frame.recycle() }
    } finally { retriever.release() }
  }
  private fun color(expected: Int, actual: Int) {
    for (shift in listOf(16, 8, 0)) assertTrue("Unexpected reaction pixel", abs((expected shr shift and 255) - (actual shr shift and 255)) < 40)
  }
  private fun record(name: String) { synchronized(records) { records.put(JSONObject().put("case", name).put("passed", true)) } }

  @Test fun sourcePauseAndReplayDoNotPauseTheCamera() {
    val file = export(request("holds"), "react-source-hold-replay")
    color(Color.RED, pixel(file, .4, 180, 640)); color(Color.CYAN, pixel(file, .4, 540, 640))
    color(Color.RED, pixel(file, 1.4, 180, 640)); color(Color.MAGENTA, pixel(file, 1.4, 540, 640))
    color(Color.GREEN, pixel(file, 2.4, 180, 640)); color(Color.WHITE, pixel(file, 2.4, 540, 640))
    record("sourcePauseAndReplayDoNotPauseTheCamera")
  }
  @Test fun cameraAndSourceAudioMixIndependentlyAcrossHolds() {
    val file = export(request("audio"), "react-independent-audio")
    val samples = audio.decodeAudio(file)
    for (from in listOf(.2, 1.2, 2.2)) assertTrue(samples.amplitude(220, from, from + .6) in .06.. .14)
    assertTrue(samples.amplitude(880, .2, .8) in .025.. .075)
    assertTrue(samples.amplitude(880, 1.2, 1.8) < .01)
    assertTrue(samples.amplitude(880, 2.2, 2.8) in .025.. .075)
    record("cameraAndSourceAudioMixIndependentlyAcrossHolds")
  }
  @Test fun microphoneMuteDoesNotMutePlayingSourceOrLeakDuringHolds() {
    val request = request("mute"); request["voiceVolume"] = 0.0
    val file = export(request, "react-muted-microphone"); val samples = audio.decodeAudio(file)
    assertTrue(samples.amplitude(220, .2, 2.8) < .01)
    assertTrue(samples.amplitude(880, .2, .8) > .025); assertTrue(samples.rms(1.2, 1.8) < .01)
    record("microphoneMuteDoesNotMutePlayingSourceOrLeakDuringHolds")
  }
  @Test fun aPhotoSourceKeepsTheCameraMovingAndArtworkAboveBothTracks() {
    val request = request("photo"); request["sourceKind"] = "image"; request["sourceUri"] = uri(image("photo", Color.YELLOW))
    request["segments"] = listOf(segment(0.0, 3.0, 0.0, false))
    request["overlayUri"] = uri(image("credit", Color.BLUE, 720, 1280, true))
    val file = export(request, "react-photo-and-attribution")
    color(Color.YELLOW, pixel(file, .5, 180, 640)); color(Color.YELLOW, pixel(file, 1.5, 180, 640))
    color(Color.CYAN, pixel(file, .5, 540, 640)); color(Color.MAGENTA, pixel(file, 1.5, 540, 640))
    color(Color.BLACK, pixel(file, .5, 180, 200)); color(Color.CYAN, pixel(file, .5, 540, 200))
    color(Color.BLUE, pixel(file, 1.5, 100, 25)); color(Color.BLUE, pixel(file, 1.5, 600, 25))
    record("aPhotoSourceKeepsTheCameraMovingAndArtworkAboveBothTracks")
  }
  @Test fun trimmingAdvancesTheCameraAndSourceOnTheirOwnClocks() {
    val request = request("trim"); request["cameraStart"] = 1.0; request["duration"] = 2.0
    request["segments"] = listOf(segment(0.0, 2.0, 0.0, true))
    val file = export(request, "react-trimmed-clocks")
    color(Color.RED, pixel(file, .4, 180, 640)); color(Color.MAGENTA, pixel(file, .4, 540, 640))
    color(Color.GREEN, pixel(file, 1.4, 180, 640)); color(Color.WHITE, pixel(file, 1.4, 540, 640))
    record("trimmingAdvancesTheCameraAndSourceOnTheirOwnClocks")
  }
  @Test fun cutoutRemovesAnEmptyCameraBackground() {
    val request = request("cutout"); request["cutout"] = true; request["duration"] = 1.0
    request["segments"] = listOf(segment(0.0, 1.0, 0.0, true))
    request["sourceRect"] = mapOf("x" to 0.0, "y" to 0.0, "width" to 1.0, "height" to 1.0)
    request["faceRect"] = mapOf("x" to .6, "y" to .5, "width" to .3, "height" to .4)
    val file = export(request, "react-cutout-empty-background")
    color(Color.RED, pixel(file, .5, 540, 900))
    record("cutoutRemovesAnEmptyCameraBackground")
  }
  @Test fun malformedTimelineNeverCreatesAnOutput() {
    val request = request("invalid"); request["segments"] = listOf(segment(.1, 3.0, 0.0, true))
    assertTrue(begin(request).await().isFailure); assertFalse(output(request).exists())
    request["segments"] = List(161) { segment(0.0, 3.0, 0.0, true) }
    assertTrue(begin(request).await().isFailure); assertFalse(output(request).exists())
    record("malformedTimelineNeverCreatesAnOutput")
  }
  @Test fun cancellationCleansOwnedFilesAndAllowsANewExport() {
    val request = request("cancel"); val pending = begin(request)
    ReactVideoComposition.cancel(request["id"] as String)
    assertTrue(pending.await().isFailure); assertFalse(output(request).exists())
    assertTrue(context.cacheDir.listFiles().orEmpty().none { it.name.startsWith("pc-react-hold-") })
    export(request("retry"), "react-cancel-retry")
    assertEquals(1, pending.calls.get()); record("cancellationCleansOwnedFilesAndAllowsANewExport")
  }
  @After fun cleanup() { ReactVideoComposition.cancelAll() }
  companion object {
    private val ids = AtomicInteger(); private val records = JSONArray()
    @JvmStatic @AfterClass fun saveReceipt() {
      val context = InstrumentationRegistry.getInstrumentation().targetContext
      val directory = File(context.filesDir, "evidence").apply { mkdirs() }
      File(directory, "react-receipt.json").writeText(JSONObject().put("sdk", Build.VERSION.SDK_INT).put("media3Version", "1.11.1")
        .put("renderer", "Production ReactVideoComposition.kt and ReactVideoEffects.kt").put("cases", records).put("physicalDeviceAcceptance", false).toString(2) + "\n")
    }
  }
}
