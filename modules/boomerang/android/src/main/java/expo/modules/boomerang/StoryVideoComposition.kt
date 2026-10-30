package expo.modules.boomerang

import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Build
import android.os.CancellationSignal
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.audio.ToInt16PcmAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.DefaultVideoFrameProcessor
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.FileDescriptor
import java.io.Closeable
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.roundToLong

internal data class StoryRecipe(
  val width: Int, val height: Int, val start: Double, val end: Double,
  val speed: Float, val volume: Float, val cover: Boolean,
  val scale: Float, val x: Float, val y: Float, val matrix: FloatArray,
) { val duration: Double get() = (end - start) / speed }

/** Local Media3 renderer shared by the Expo bridge and the executable harness. */
@UnstableApi
object StoryVideoComposition {
  private const val TIMEOUT_MS = 180_000L
  private const val MAX_SOURCE_BYTES = 512L * 1024 * 1024
  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()
  private var active: Job? = null

  private class Job(val id: String, val callback: (Result<Map<String, Any>>) -> Unit) {
    val thread = HandlerThread("PlatinumStoryExport")
    lateinit var handler: Handler
    val cancelled = AtomicBoolean(false)
    val settled = AtomicBoolean(false)
    var transformer: Transformer? = null
    var output: File? = null
    var stagedInput: File? = null
    val sourceOpenCancellation = CancellationSignal()
    val sourceResource = AtomicReference<Closeable?>()
    var timeout: Runnable? = null
    fun check() { kotlin.check(!cancelled.get()) { "Video export was cancelled." } }
    fun settle(result: Result<Map<String, Any>>) {
      if (settled.compareAndSet(false, true)) main.post { callback(result) }
    }
  }

  fun compose(context: Context, request: Map<String, Any?>, callback: (Result<Map<String, Any>>) -> Unit) {
    val id = request["id"] as? String
    if (id == null || id.length !in 8..120) {
      callback(Result.failure(IllegalArgumentException("The export request is incomplete."))); return
    }
    val job = Job(id, callback)
    synchronized(lock) {
      if (active != null) {
        callback(Result.failure(IllegalStateException("Another video is still exporting."))); return
      }
      active = job
      job.thread.start()
      job.handler = Handler(job.thread.looper)
    }
    val timeout = Runnable { cancelJob(job) }; job.timeout = timeout
    main.postDelayed(timeout, TIMEOUT_MS)
    job.handler.post {
      try { job.check(); prepare(context.applicationContext, request, job) }
      catch (error: Exception) { finish(job, Result.failure(error)) }
    }
  }

  fun cancel(id: String) {
    val job = synchronized(lock) { active?.takeIf { it.id == id } } ?: return
    cancelJob(job)
  }

  private fun cancelJob(job: Job) {
    val interruptRead = synchronized(lock) {
      val current = active?.takeIf { it === job } ?: return
      val firstCancellation = current.cancelled.compareAndSet(false, true)
      current.settle(Result.failure(IllegalStateException("Video export was cancelled.")))
      firstCancellation
    }
    if (interruptRead) Thread({
      // A provider may be blocked inside read() or opening a descriptor. Close
      // it from outside the copy/Transformer thread so cancellation can proceed.
      try { job.sourceOpenCancellation.cancel() } catch (_: Exception) {}
      try { job.sourceResource.getAndSet(null)?.close() } catch (_: Exception) {}
    }, "PlatinumStoryInputCancel").apply { isDaemon = true }.start()
    // Transformer is thread-confined. Keep the reservation until its writer
    // actually stops, and delete only after cancel() returns on that thread.
    job.handler.post { finish(job, Result.failure(IllegalStateException("Video export was cancelled."))) }
  }

  fun cancelAll() { synchronized(lock) { active }?.let(::cancelJob) }

  private fun finish(job: Job, result: Result<Map<String, Any>>) {
    if (synchronized(lock) { active !== job }) return
    var finalResult = result
    try { job.transformer?.cancel() }
    catch (error: Exception) { if (result.isSuccess) finalResult = Result.failure(error) }
    job.transformer = null
    try { job.sourceResource.getAndSet(null)?.close() } catch (_: Exception) {}
    job.stagedInput?.delete()
    job.timeout?.let(main::removeCallbacks)
    synchronized(lock) {
      if (active !== job) return
      // Cancellation and this terminal decision share one lock. A cancellation
      // cannot reject a request after this decision has kept its output file.
      if (job.cancelled.get()) finalResult = Result.failure(IllegalStateException("Video export was cancelled."))
      if (finalResult.isFailure) job.output?.delete()
      active = null
      job.settle(finalResult)
    }
    job.thread.quitSafely()
  }

  private data class MediaInfo(val duration: Double, val hasVideo: Boolean, val hasAudio: Boolean,
    val audioStart: Double = 0.0, val audioEnd: Double = 0.0)

  private fun media(file: File): MediaInfo {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      var videoDuration = Double.POSITIVE_INFINITY; var audioDuration = 0.0
      var video = false; var audio = false; var audioStart = Double.POSITIVE_INFINITY; var audioEnd = 0.0
      for (index in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(index)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
        val duration = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) / 1_000_000.0 else 0.0
        if (mime.startsWith("video/")) {
          val width = format.getInteger(MediaFormat.KEY_WIDTH); val height = format.getInteger(MediaFormat.KEY_HEIGHT)
          require(width in 1..4096 && height in 1..4096 && width.toLong() * height <= 4096L * 2160) { "Choose a video of 4K resolution or lower before exporting." }
          require(duration.isFinite() && duration > 0) { "The selected video duration could not be read." }
          video = true; videoDuration = minOf(videoDuration, duration)
        }
        if (mime.startsWith("audio/")) {
          require(duration.isFinite() && duration > 0) { "The selected audio duration could not be read." }
          audio = true; audioDuration = maxOf(audioDuration, duration)
          extractor.selectTrack(index); extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
          val first = extractor.sampleTime
          extractor.seekTo((maxOf(0.0, duration - .05) * 1_000_000).toLong(), MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
          var last = extractor.sampleTime; var packets = 0
          while (extractor.advance()) {
            last = maxOf(last, extractor.sampleTime)
            require(++packets < 100_000) { "The audio timeline is too large." }
          }
          if (first >= 0 && last >= first) {
            val sampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 48_000
            val packetDuration = when {
              mime == "audio/mp4a-latm" -> 1024.0 / sampleRate
              mime == "audio/mpeg" -> 1152.0 / sampleRate
              else -> .05
            }
            audioStart = minOf(audioStart, first / 1_000_000.0)
            audioEnd = maxOf(audioEnd, last / 1_000_000.0 + packetDuration)
          }
          extractor.unselectTrack(index)
        }
      }
      val duration = if (video) videoDuration else audioDuration
      require(duration.isFinite() && duration > 0) { "The selected media duration could not be read." }
      return MediaInfo(duration, video, audio && audioEnd > audioStart,
        if (audioStart.isFinite()) audioStart else 0.0, audioEnd)
    } finally { extractor.release() }
  }

  private fun local(context: Context, raw: Any?, output: Boolean = false): File {
    val text = raw as? String ?: error("The export file is missing.")
    val uri = Uri.parse(text)
    require(uri.scheme == "file" && uri.host.isNullOrEmpty() && uri.query == null && uri.fragment == null) { "Export requires local media files." }
    val file = File(uri.path ?: error("The export file is invalid.")).canonicalFile
    require(isPrivate(context, file)) { "The export file is outside this app." }
    if (output) {
      require(file.path.startsWith(context.cacheDir.canonicalFile.path + File.separator)
        && file.parentFile == context.cacheDir.canonicalFile && file.name.startsWith("pc-story-export-")
        && file.extension == "mp4" && !file.exists()) { "Choose a new export file in the app cache." }
    } else require(file.isFile && file.length() in 1..MAX_SOURCE_BYTES) { "An export source is missing, empty or too large." }
    return file
  }

  private fun isPrivate(context: Context, file: File): Boolean =
    listOf(context.filesDir, context.cacheDir, context.noBackupFilesDir)
      .any { file.path.startsWith(it.canonicalFile.path + File.separator) }

  private fun source(context: Context, raw: Any?, still: Boolean, job: Job): File {
    val text = raw as? String ?: error("The export source is missing.")
    val uri = Uri.parse(text)
    if (still) return local(context, raw)
    val file = if (uri.scheme == "file" && uri.host.isNullOrEmpty() && uri.query == null && uri.fragment == null)
      File(uri.path ?: error("The export source is invalid.")).canonicalFile else null
    if (file != null && isPrivate(context, file)) return local(context, raw)
    require(uri.scheme == "content" && !uri.authority.isNullOrEmpty() && uri.fragment == null || file != null) { "Choose a local video from this device." }
    if (file != null) {
      val externalRoots = listOfNotNull(Environment.getExternalStorageDirectory(), *context.getExternalFilesDirs(null), *context.externalCacheDirs)
      require(externalRoots.any { file.path.startsWith(it.canonicalFile.path + File.separator) }
        && file.isFile && file.length() in 1..MAX_SOURCE_BYTES) { "The selected video is not readable device media or is too large." }
    }
    job.check()
    val destination = File.createTempFile("pc-story-input-", ".mp4", context.cacheDir)
    job.stagedInput = destination
    fun copy(stream: InputStream, declaredLength: Long, descriptor: FileDescriptor) {
      require(declaredLength <= MAX_SOURCE_BYTES) { "Choose a video smaller than 512 MiB." }
      require(context.cacheDir.usableSpace >= 32L * 1024 * 1024 + maxOf(0L, declaredLength)) { "There is not enough temporary storage for this video." }
      job.sourceResource.set(stream)
      try {
        job.check()
        // Provider pipes must never trap the encoder thread in a blocking read.
        // Polling also gives cancellation a bounded wake-up without waiting for
        // the provider to deliver its next chunk or observe a closed descriptor.
        val flags = Os.fcntlInt(descriptor, OsConstants.F_GETFL, 0)
        Os.fcntlInt(descriptor, OsConstants.F_SETFL, flags or OsConstants.O_NONBLOCK)
        val poll = StructPollfd().apply { fd = descriptor; events = OsConstants.POLLIN.toShort() }
        destination.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024); var bytes = 0L; var nextSpaceCheck = 0L
          while (true) {
            job.check()
            if (declaredLength >= 0 && bytes == declaredLength) break
            poll.revents = 0
            if (Os.poll(arrayOf(poll), 100) == 0) continue
            job.check()
            val requested = if (declaredLength >= 0) minOf(buffer.size.toLong(), declaredLength - bytes).toInt() else buffer.size
            val count = stream.read(buffer, 0, requested)
            job.check()
            if (count < 0) {
              require(declaredLength < 0 || bytes == declaredLength) { "The selected video ended before its declared size." }
              break
            }
            require(count > 0) { "The selected video stopped streaming." }
            require(bytes <= MAX_SOURCE_BYTES - count) { "Choose a video smaller than 512 MiB." }
            if (bytes >= nextSpaceCheck) {
              require(context.cacheDir.usableSpace >= 32L * 1024 * 1024) { "There is not enough temporary storage for this video." }
              nextSpaceCheck = bytes + 4L * 1024 * 1024
            }
            output.write(buffer, 0, count); bytes += count
          }
          require(bytes > 0) { "The selected video is empty." }
        }
      } finally {
        job.sourceResource.compareAndSet(stream, null)
        stream.close()
      }
    }
    if (file != null) FileInputStream(file).use { copy(it, file.length(), it.fd) }
    else {
      val descriptor = context.contentResolver.openAssetFileDescriptor(uri, "r", job.sourceOpenCancellation)
        ?: error("The selected video could not be opened.")
      descriptor.use { asset ->
        // Register the descriptor before inspecting or constructing a stream.
        // AssetFileDescriptor.createInputStream() can consume a pipe's start
        // offset inside its constructor, before a caller can bound that read.
        job.sourceResource.set(asset)
        try {
          job.check()
          val fd = asset.fileDescriptor
          val stat = Os.fstat(fd)
          val regular = OsConstants.S_ISREG(stat.st_mode)
          require(asset.startOffset >= 0 && (regular || asset.startOffset == 0L)) { "This streamed video range cannot be read safely. Save the video to this device first." }
          require(asset.declaredLength in -1..MAX_SOURCE_BYTES) { "Choose a video smaller than 512 MiB." }
          if (regular) {
            require(asset.startOffset <= stat.st_size && (asset.declaredLength < 0 || asset.declaredLength <= stat.st_size - asset.startOffset)) { "The selected video range exceeds its file." }
            Os.lseek(fd, asset.startOffset, OsConstants.SEEK_SET)
          }
          val flags = Os.fcntlInt(fd, OsConstants.F_GETFL, 0)
          Os.fcntlInt(fd, OsConstants.F_SETFL, flags or OsConstants.O_NONBLOCK)
          job.check()
          ParcelFileDescriptor.AutoCloseInputStream(asset.parcelFileDescriptor).use { copy(it, asset.declaredLength, fd) }
        } finally { job.sourceResource.compareAndSet(asset, null) }
      }
    }
    job.check()
    return destination
  }

  private fun image(file: File) {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    require(options.outWidth in 1..2200 && options.outHeight in 1..4000) { "Story artwork exceeds its size limit or could not be read." }
  }

  private fun number(map: Map<*, *>, key: String, min: Double, max: Double): Double {
    val value = (map[key] as? Number)?.toDouble()
    require(value != null && value.isFinite() && value in min..max) { "The video $key is invalid." }
    return value
  }

  private fun recipe(raw: Any?): StoryRecipe {
    val map = raw as? Map<*, *> ?: error("The video recipe is missing.")
    val width = number(map, "width", 2.0, 1080.0)
    val height = number(map, "height", 2.0, 1920.0)
    val start = number(map, "trimStart", 0.0, 86400.0)
    val end = number(map, "trimEnd", .1, 86400.0)
    val speed = number(map, "speed", .25, 4.0)
    require(width % 2 == 0.0 && height % 2 == 0.0 && end > start && end - start <= 60.01 && (end - start) / speed <= 120.01) { "The export size or duration is invalid." }
    val matrix = (map["matrix"] as? List<*>)?.map { (it as? Number)?.toDouble() ?: Double.NaN }
    require(matrix != null && matrix.size == 20 && matrix.all { it.isFinite() && abs(it) <= 16 }) { "The video grade is invalid." }
    require(map["fit"] == "contain" || map["fit"] == "cover") { "The video fit is invalid." }
    return StoryRecipe(width.toInt(), height.toInt(), start, end, speed.toFloat(),
      number(map, "volume", 0.0, 1.0).toFloat(), map["fit"] == "cover",
      number(map, "scale", .35, 5.0).toFloat(), number(map, "x", -2.0, 2.0).toFloat(),
      number(map, "y", -2.0, 2.0).toFloat(), matrix.map { it.toFloat() }.toFloatArray())
  }

  private fun processors(volume: Float): MutableList<AudioProcessor> {
    val channels = ChannelMixingAudioProcessor()
    for (count in 1..6) {
      // Mono duplication and stereo gain match the editor/iOS volume scale;
      // use the standard layout-aware downmix only for multichannel sources.
      val matrix = if (count <= 2) ChannelMixingMatrix.createForConstantGain(count, 2)
        else ChannelMixingMatrix.createForConstantPower(count, 2)
      channels.putChannelMixingMatrix(matrix.scaleBy(volume))
    }
    val resample = SonicAudioProcessor().apply { setOutputSampleRateHz(48_000) }
    return mutableListOf(ToInt16PcmAudioProcessor(), channels, resample)
  }

  private fun clipped(file: File, start: Double, end: Double): MediaItem = MediaItem.Builder()
    .setUri(Uri.fromFile(file))
    .setClippingConfiguration(MediaItem.ClippingConfiguration.Builder()
      .setStartPositionMs((start * 1000).roundToLong()).setEndPositionMs((end * 1000).roundToLong()).build())
    .build()

  private fun prepare(context: Context, raw: Map<String, Any?>, job: Job) {
    val kind = raw["inputKind"] ?: "video"
    require(kind == "video" || kind == "image") { "The story input type is invalid." }
    val r = recipe(raw["recipe"])
    val output = local(context, raw["outputUri"], output = true)
    // Reserve the new path before any writer starts; competing requests cannot
    // silently overwrite an existing output even within the app cache.
    require(output.createNewFile()) { "Choose a new export file in the app cache." }
    job.output = output
    val source = source(context, raw["inputUri"], still = kind == "image", job = job)
    val still = kind == "image"
    val sourceInfo = if (still) {
      image(source)
      require(r.start == 0.0 && r.speed == 1f && r.end in 1.0..30.0) { "The story image movie duration is invalid." }
      MediaInfo(r.end, false, false)
    } else media(source).also { require(it.hasVideo && r.end <= it.duration + .1) { "The selected video could not be read or its trim exceeds its duration." } }
    val background = raw["backgroundUri"]?.let { local(context, it).also(::image) }
    val rawLayers = raw["layers"] as? List<*> ?: error("The story artwork list is missing.")
    require(rawLayers.size <= 23) { "Too many artwork layers." }
    val layers = rawLayers.map { entry ->
      val layer = entry as? Map<*, *> ?: error("A story artwork layer is invalid.")
      val from = number(layer, "start", 0.0, r.duration)
      val end = number(layer, "end", .001, r.duration + .1)
      require(end > from) { "An artwork time range is invalid." }
      StoryArtwork(local(context, layer["uri"]).also(::image), from, end)
    }
    job.check()
    val useOriginalAudio = sourceInfo.hasAudio && r.volume > 0 &&
      minOf(r.end, sourceInfo.audioEnd) - maxOf(r.start, sourceInfo.audioStart) > .001
    val audioEffects = if (useOriginalAudio) processors(r.volume) else mutableListOf()
    val videoEffects = mutableListOf<Effect>()
    if (r.speed != 1f) {
      if (audioEffects.isNotEmpty()) {
        val pair = Effects.createExperimentalSpeedChangingEffect(object : SpeedProvider {
          override fun getSpeed(timeUs: Long) = r.speed
          override fun getNextSpeedChangeTimeUs(timeUs: Long) = C.TIME_UNSET
        })
        audioEffects.add(pair.first); videoEffects.add(pair.second)
      } else videoEffects.add(SpeedChangeEffect(r.speed))
    }
    // Media3 1.8 ignores setFrameRate for videos. Bound the actual post-speed
    // frame stream before the full-resolution canvas/bitmap work.
    videoEffects.add(FrameDropEffect.createDefaultFrameDropEffect(30f))
    videoEffects.add(StoryCanvasEffect(r, background, layers, job::check))
    val input = if (still) MediaItem.Builder().setUri(Uri.fromFile(source)).setImageDurationMs((r.end * 1000).roundToLong()).build()
      else clipped(source, r.start, minOf(r.end, sourceInfo.duration))
    val editedVideo = EditedMediaItem.Builder(input).setRemoveAudio(!useOriginalAudio)
      .setFrameRate(30).setEffects(Effects(audioEffects, videoEffects)).build()
    val sequences = mutableListOf(EditedMediaItemSequence.Builder(editedVideo).build())
    var soundtrack = false
    if (raw["audio"] != null) {
      val audio = raw["audio"] as? Map<*, *> ?: error("The soundtrack excerpt is invalid.")
      val file = local(context, audio["uri"])
      require(file.length() <= 50L * 1024 * 1024) { "The soundtrack file is too large." }
      val info = media(file)
      val start = number(audio, "start", 0.0, 600.0)
      val duration = number(audio, "duration", 1.0, 600.0)
      val volume = number(audio, "volume", 0.0, 1.0)
      val loop = audio["loop"] as? Boolean ?: error("The soundtrack loop is invalid.")
      require(info.hasAudio && !info.hasVideo && info.duration <= 600.1 && start + duration <= info.duration + .1) { "The soundtrack excerpt could not be read." }
      // A non-looping voiceover must never extend a shorter output video.
      val end = minOf(start + duration, info.duration, start + r.duration)
      val editedAudio = EditedMediaItem.Builder(clipped(file, start, end)).setRemoveVideo(true)
        .setEffects(Effects(processors(volume.toFloat()), emptyList())).build()
      sequences.add(EditedMediaItemSequence.Builder(editedAudio).setIsLooping(loop).build())
      soundtrack = true
    }
    val composition = Composition.Builder(sequences).setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build()
    val hasSoundtrack = soundtrack
    val transformer = Transformer.Builder(context)
      .setLooper(job.handler.looper)
      .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(DefaultEncoderFactory.Builder(context).setEnableFallback(false).build())
      .setVideoFrameProcessorFactory(DefaultVideoFrameProcessor.Factory.Builder()
        .setSdrWorkingColorSpace(DefaultVideoFrameProcessor.WORKING_COLOR_SPACE_ORIGINAL).build())
      .setMaxDelayBetweenMuxerSamplesMs(15_000)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          try {
            job.check()
            val result = verify(output, raw["outputUri"] as String, r, hasSoundtrack, useOriginalAudio || hasSoundtrack, job::check)
            job.check(); finish(job, Result.success(result))
          } catch (error: Exception) { finish(job, Result.failure(error)) }
        }
        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          finish(job, Result.failure(exportException))
        }
      }).build()
    job.transformer = transformer
    job.check()
    transformer.start(composition, output.path)
  }

  private fun verify(file: File, uri: String, r: StoryRecipe, soundtrack: Boolean, expectedAudio: Boolean, checkCurrent: () -> Unit): Map<String, Any> {
    require(file.length() > 1024) { "The exported video is empty." }
    val info = media(file)
    require(info.hasVideo && (!expectedAudio || info.hasAudio) && abs(info.duration - r.duration) < .25
      && info.audioEnd <= r.duration + .25) { "The exported video or soundtrack could not be verified." }
    val metadata = MediaMetadataRetriever()
    val width: Int; val height: Int
    try {
      metadata.setDataSource(file.path)
      val rawWidth = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val rawHeight = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val rotation = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      width = if (rotation % 180 == 0) rawWidth else rawHeight
      height = if (rotation % 180 == 0) rawHeight else rawWidth
    } finally { metadata.release() }
    require(width == r.width && height == r.height) { "This device could not encode the requested story size." }
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(file.path)
      var videoSamples = false; var audioSamples = false
      val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
      for (i in 0 until extractor.trackCount) {
        val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: ""
        extractor.selectTrack(i); extractor.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        var last = -1L; var previous = -1L; var count = 0
        while (extractor.sampleTime >= 0) {
          checkCurrent(); require(++count <= 60_000) { "The exported timeline exceeds its sample limit." }
          buffer.clear()
          if (Build.VERSION.SDK_INT >= 28) require(extractor.sampleSize in 1..buffer.capacity().toLong()) { "An exported media sample is empty or too large." }
          require(extractor.readSampleData(buffer, 0) > 0) { "An exported media sample is empty." }
          val timestamp = extractor.sampleTime
          if (timestamp > last) { previous = last; last = timestamp }
          else if (timestamp > previous && timestamp < last) previous = timestamp
          if (!extractor.advance()) break
        }
        if (mime.startsWith("video/")) {
          // Frame dropping bounds high rates; it does not invent frames for a
          // low-fps source. The final real frame can cover its native interval.
          val tail = if (previous >= 0) maxOf((last - previous) / 1_000_000.0, 1.0 / 30) else info.duration
          videoSamples = count > 0 && count <= r.duration * 32 + 3 && last / 1_000_000.0 <= r.duration + .1
            && last / 1_000_000.0 + tail >= r.duration - .25
        }
        if (mime.startsWith("audio/")) audioSamples = count > 0
        extractor.unselectTrack(i)
      }
      require(videoSamples && (!expectedAudio || audioSamples)) { "The exported video or soundtrack has missing or truncated samples." }
    } finally { extractor.release() }
    return mapOf("uri" to uri, "duration" to info.duration, "width" to width, "height" to height,
      "bytes" to file.length(), "soundtrackMixed" to soundtrack)
  }
}
