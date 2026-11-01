package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.DefaultVideoFrameProcessor
import androidx.media3.effect.FrameDropEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

internal data class ReactRect(val x: Float, val y: Float, val width: Float, val height: Float)
internal data class ReactSegment(val start: Double, val end: Double, val sourceStart: Double, val playing: Boolean, val volume: Float) {
  val duration: Double get() = end - start
}

/** Two actual moving tracks. Camera/mic never pause when the source is held or replayed. */
@UnstableApi
object ReactVideoComposition {
  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()
  private var active: Job? = null
  private const val MAX_BYTES = 512L * 1024 * 1024
  private class Job(val id: String, val callback: (Result<Map<String, Any>>) -> Unit) {
    val thread = HandlerThread("PlatinumReactExport")
    lateinit var handler: Handler
    val cancelled = AtomicBoolean(false)
    val settled = AtomicBoolean(false)
    @Volatile var reason = "Reaction export was cancelled."
    @Volatile var output: File? = null
    val temporary = mutableListOf<File>()
    var transformer: Transformer? = null
    var timeout: Runnable? = null
    var watch: Runnable? = null
    fun check() { check(!cancelled.get()) { reason } }
  }

  fun compose(context: Context, request: Map<String, Any?>, callback: (Result<Map<String, Any>>) -> Unit) {
    val id = request["id"] as? String
    if (id == null || !Regex("[A-Za-z0-9_-]{8,120}").matches(id)) {
      callback(Result.failure(IllegalArgumentException("The reaction export request is invalid."))); return
    }
    val job = Job(id, callback)
    synchronized(lock) {
      if (active != null || !StoryVideoComposition.reserveMemory(id)) {
        callback(Result.failure(IllegalStateException("Another video is still exporting."))); return
      }
      active = job
      job.thread.start(); job.handler = Handler(job.thread.looper)
      job.timeout = Runnable { cancelJob(job, "Reaction export took too long. Trim the take and try again.") }
        .also { main.postDelayed(it, 15 * 60_000L) }
      job.watch = object : Runnable {
        override fun run() {
          if (synchronized(lock) { active !== job }) return
          if ((job.output?.length() ?: 0L) > MAX_BYTES) cancelJob(job, "The reaction exceeds 512 MiB. Trim the take.")
          else if (context.cacheDir.usableSpace < 16L * 1024 * 1024) cancelJob(job, "There is not enough temporary storage for this reaction.")
          synchronized(lock) { if (active === job && !job.cancelled.get()) main.postDelayed(this, 250) }
        }
      }.also { main.postDelayed(it, 250) }
      job.handler.post { try { job.check(); prepare(context.applicationContext, request, job) } catch (error: Exception) { finish(job, Result.failure(error)) } }
    }
  }

  fun cancel(id: String) { synchronized(lock) { active?.takeIf { it.id == id } }?.let { cancelJob(it) } }
  fun cancelAll() { synchronized(lock) { active }?.let { cancelJob(it) } }
  private fun cancelJob(job: Job, reason: String = "Reaction export was cancelled.") {
    synchronized(lock) {
      if (active !== job) return
      if (job.cancelled.compareAndSet(false, true)) job.reason = reason
    }
    // The worker owns Media3; release the reservation only after its writer stops.
    job.handler.post { finish(job, Result.failure(IllegalStateException(job.reason))) }
  }
  private fun finish(job: Job, initial: Result<Map<String, Any>>) {
    if (synchronized(lock) { active !== job }) return
    var result = initial
    try { job.transformer?.cancel() } catch (error: Exception) { result = Result.failure(error) }
    job.transformer = null
    job.temporary.forEach { it.delete() }; job.temporary.clear()
    job.timeout?.let(main::removeCallbacks); job.watch?.let(main::removeCallbacks)
    synchronized(lock) {
      if (active !== job) return
      if (job.cancelled.get()) result = Result.failure(IllegalStateException(job.reason))
      if (result.isFailure) job.output?.delete()
      active = null; StoryVideoComposition.releaseMemory(job.id)
      if (job.settled.compareAndSet(false, true)) main.post { job.callback(result) }
    }
    job.thread.quitSafely()
  }

  private fun number(map: Map<*, *>, key: String, min: Double, max: Double) = StoryVideoComposition.number(map, key, min, max)
  private fun rect(raw: Any?): ReactRect {
    val map = raw as? Map<*, *> ?: error("The reaction layout is missing.")
    val x = number(map, "x", 0.0, 1.0); val y = number(map, "y", 0.0, 1.0)
    val width = number(map, "width", .1, 1.0); val height = number(map, "height", .1, 1.0)
    require(x + width <= 1.001 && y + height <= 1.001) { "The reaction layout is outside the canvas." }
    return ReactRect(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
  }
  internal fun timeline(raw: Any?, duration: Double, image: Boolean): List<ReactSegment> {
    val entries = raw as? List<*> ?: error("The reaction source timeline is missing.")
    require(entries.size in 1..160) { "The reaction has too many playback changes." }
    var cursor = 0.0
    val result = entries.map { rawSegment ->
      val map = rawSegment as? Map<*, *> ?: error("A reaction segment is invalid.")
      val start = number(map, "start", 0.0, duration); val end = number(map, "end", 0.0, duration + .002)
      val sourceStart = number(map, "sourceStart", 0.0, 86400.0)
      val volume = number(map, "volume", 0.0, 1.0)
      val playing = map["playing"] as? Boolean ?: error("The source playback state is invalid.")
      require(abs(start - cursor) <= .002 && end - start >= .00001 && (!image || !playing) && (playing || volume == 0.0)) { "The reaction source has a gap or an invalid hold." }
      cursor = end
      ReactSegment(start, end, sourceStart, playing, volume.toFloat())
    }
    require(abs(cursor - duration) <= .002) { "The reaction source does not cover the camera take." }
    return result
  }
  private fun output(context: Context, raw: Any?): File {
    val uri = Uri.parse(raw as? String ?: error("The reaction output is missing."))
    require(uri.scheme == "file" && uri.host.isNullOrEmpty() && uri.query == null && uri.fragment == null) { "The reaction output must be a local file." }
    val file = File(uri.path ?: error("The output path is invalid.")).canonicalFile
    require(file.parentFile == context.cacheDir.canonicalFile && file.name.startsWith("pc-react-export-") && file.extension == "mp4" && !file.exists()) { "Choose a new reaction output in the app cache." }
    require(context.cacheDir.usableSpace > 64L * 1024 * 1024 && file.createNewFile()) { "There is not enough temporary storage for the reaction." }
    return file
  }
  private fun frame(context: Context, source: File, seconds: Double, job: Job): File {
    job.check()
    val retriever = MediaMetadataRetriever()
    var frame: Bitmap? = null
    try {
      retriever.setDataSource(source.path)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      require(width > 0 && height > 0) { "A held source frame could not be read." }
      val scale = minOf(1.0, 1280.0 / maxOf(width, height))
      frame = if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime((seconds * 1_000_000).roundToLong(), MediaMetadataRetriever.OPTION_CLOSEST, maxOf(1, (width * scale).roundToInt()), maxOf(1, (height * scale).roundToInt()))
        else retriever.getFrameAtTime((seconds * 1_000_000).roundToLong(), MediaMetadataRetriever.OPTION_CLOSEST)
      val bitmap = frame ?: error("The held source frame could not be decoded.")
      job.check()
      require(context.cacheDir.usableSpace > 16L * 1024 * 1024) { "There is not enough storage for a held frame." }
      val file = File.createTempFile("pc-react-hold-", ".png", context.cacheDir)
      job.temporary.add(file)
      file.outputStream().use { require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) { "The held source frame could not be saved." } }
      job.check(); return file
    } finally { frame?.recycle(); retriever.release() }
  }
  private val identity = floatArrayOf(1f,0f,0f,0f,0f, 0f,1f,0f,0f,0f, 0f,0f,1f,0f,0f, 0f,0f,0f,1f,0f)

  private fun prepare(context: Context, raw: Map<String, Any?>, job: Job) {
    require(raw["sourceKind"] == "video" || raw["sourceKind"] == "image") { "The source type is invalid." }
    require(number(raw, "width", 720.0, 720.0) == 720.0 && number(raw, "height", 1280.0, 1280.0) == 1280.0) { "The reaction canvas is invalid." }
    val duration = number(raw, "duration", .1, 120.0); val cameraStart = number(raw, "cameraStart", 0.0, 120.0)
    require(cameraStart + duration <= 120.01) { "Trim this reaction to two minutes or less." }
    val voice = number(raw, "voiceVolume", 0.0, 1.0).toFloat(); val zoom = number(raw, "sourceZoom", 1.0, 3.0).toFloat()
    val cutout = raw["cutout"] as? Boolean ?: error("The camera cutout setting is invalid.")
    val sourceRect = rect(raw["sourceRect"]); val faceRect = rect(raw["faceRect"])
    val image = raw["sourceKind"] == "image"
    val segments = timeline(raw["segments"], duration, image)
    val source = StoryVideoComposition.local(context, raw["sourceUri"])
    val camera = StoryVideoComposition.local(context, raw["cameraUri"])
    val cameraInfo = StoryVideoComposition.media(camera)
    require(cameraInfo.hasVideo && cameraStart + duration <= cameraInfo.duration + .02) { "The camera take is shorter than the selected trim." }
    require(voice <= 0f || cameraInfo.hasAudio && cameraInfo.audioEnd >= cameraStart + duration - .15 && cameraInfo.audioStart <= cameraStart + .15) { "The camera microphone track is missing or incomplete. Record the take again." }
    val sourceInfo = if (image) { StoryVideoComposition.image(source); null } else StoryVideoComposition.media(source).also { require(it.hasVideo) { "The selected source has no video." } }
    segments.forEach { segment ->
      if (!image) require(segment.sourceStart < sourceInfo!!.duration && (!segment.playing || segment.sourceStart + segment.duration <= sourceInfo.duration + .02)) { "The source playback exceeds the selected video." }
    }
    val overlay = raw["overlayUri"]?.let { StoryVideoComposition.local(context, it).also { file ->
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(file.path, bounds)
      require(bounds.outWidth == 720 && bounds.outHeight == 1280) { "The reaction artwork must match the full canvas." }
    } }
    val output = output(context, raw["outputUri"]); job.output = output
    val cameraEffects = listOf<Effect>(FrameDropEffect.createDefaultFrameDropEffect(30f), ReactLayerEffect(faceRect, 1f, true, cutout, job::check))
    val cameraItem = EditedMediaItem.Builder(StoryVideoComposition.clipped(camera, cameraStart, minOf(cameraStart + duration, cameraInfo.duration)))
      .setRemoveAudio(voice <= 0f).setFrameRate(30)
      .setEffects(Effects(if (voice > 0f) StoryVideoComposition.processors(voice) else emptyList(), cameraEffects)).build()
    val heldFrames = mutableMapOf<Long, File>()
    val sourceHasAudio = sourceInfo?.hasAudio == true && segments.any { it.playing && it.volume > 0f }
    val sourceItems = segments.map { segment ->
      job.check()
      val input = if (segment.playing) StoryVideoComposition.clipped(source, segment.sourceStart, minOf(segment.sourceStart + segment.duration, sourceInfo!!.duration))
      else {
        val file = if (image) source else heldFrames.getOrPut((segment.sourceStart * 1_000_000).roundToLong()) { frame(context, source, segment.sourceStart, job) }
        MediaItem.Builder().setUri(Uri.fromFile(file)).setImageDurationMs(maxOf(1, (segment.duration * 1000).roundToLong())).build()
      }
      val audio = sourceHasAudio && segment.playing && segment.volume > 0f
      EditedMediaItem.Builder(input).setRemoveAudio(!audio).setFrameRate(30)
        .setEffects(Effects(if (audio) StoryVideoComposition.processors(segment.volume) else emptyList(),
          listOf(FrameDropEffect.createDefaultFrameDropEffect(30f), ReactLayerEffect(sourceRect, zoom, false, false, job::check)))).build()
    }
    // The first sequence supplies the continuous output clock and top layer.
    // Every input effect produces the same 720×1280 texture, preventing geometry
    // changes when a source sequence alternates between video and held frames.
    val cameraTracks = if (voice > 0f) setOf(C.TRACK_TYPE_VIDEO, C.TRACK_TYPE_AUDIO) else setOf(C.TRACK_TYPE_VIDEO)
    val sourceTracks = if (sourceHasAudio) setOf(C.TRACK_TYPE_VIDEO, C.TRACK_TYPE_AUDIO) else setOf(C.TRACK_TYPE_VIDEO)
    val sequences = listOf(EditedMediaItemSequence.Builder(cameraTracks).addItems(cameraItem).build(), EditedMediaItemSequence.Builder(sourceTracks).addItems(sourceItems).build())
    val recipe = StoryRecipe(720, 1280, 0.0, duration, 1f, 1f, true, 1f, 0f, 0f, identity)
    val finalEffects = if (overlay == null) emptyList() else listOf<Effect>(StoryCanvasEffect(recipe, null, listOf(StoryArtwork(overlay, 0.0, duration)), job::check))
    val composition = Composition.Builder(sequences).setEffects(Effects(emptyList(), finalEffects))
      .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build()
    val transformer = Transformer.Builder(context).setLooper(job.handler.looper)
      .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(DefaultEncoderFactory.Builder(context).setEnableFallback(false).build())
      .setVideoFrameProcessorFactory(DefaultVideoFrameProcessor.Factory.Builder()
        .setSdrWorkingColorSpace(DefaultVideoFrameProcessor.WORKING_COLOR_SPACE_DEFAULT).build())
      .setMaxDelayBetweenMuxerSamplesMs(30_000)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          try {
            job.check()
            require(output.length() in 1025..MAX_BYTES) { "The exported reaction is empty or too large." }
            val verified = StoryVideoComposition.verify(output, raw["outputUri"] as String, recipe, false, voice > 0f || sourceHasAudio, job::check)
            job.check(); finish(job, Result.success(verified.filterKeys { it != "soundtrackMixed" } + mapOf("segmentCount" to segments.size, "voiceMixed" to (voice > 0f))))
          } catch (error: Exception) { finish(job, Result.failure(error)) }
        }
        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) { finish(job, Result.failure(exportException)) }
      }).build()
    job.transformer = transformer
    job.check(); transformer.start(composition, output.path)
  }
}
