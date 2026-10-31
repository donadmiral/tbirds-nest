package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.DefaultVideoFrameProcessor
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
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.roundToLong

/** One local render graph. Inputs and writers remain owned until actual shutdown. */
@UnstableApi
object MemoryMovieComposition {
  private const val MAX_INPUT_BYTES = 512L * 1024 * 1024
  private const val MAX_OUTPUT_BYTES = 256L * 1024 * 1024
  private val main = Handler(Looper.getMainLooper())
  private val lock = Any()
  private var active: Job? = null
  private class Job(val id: String, val callback: (Result<Map<String, Any>>) -> Unit) {
    val thread = HandlerThread("PlatinumMemoryExport")
    lateinit var handler: Handler
    val cancelled = AtomicBoolean(false)
    val settled = AtomicBoolean(false)
    @Volatile var reason = "Memory movie export was cancelled."
    @Volatile var output: File? = null
    var transformer: Transformer? = null
    var timeout: Runnable? = null
    var watch: Runnable? = null
    fun check() { check(!cancelled.get()) { reason } }
  }
  private data class Audio(val file: File, val startUs: Long, val excerptUs: Long, val volume: Float, val loop: Boolean)
  private data class Scene(val source: File, val still: Boolean, val recipe: StoryRecipe,
    val background: File?, val layers: List<StoryArtwork>, val audio: Audio?, val originalAudio: Boolean,
    val transform: MemorySceneTransform) { val durationUs: Long get() = (recipe.duration * 1_000_000).roundToLong() }
  private data class Gain(val startUs: Long, val endUs: Long, val volume: Float)

  fun compose(context: Context, request: Map<String, Any?>, callback: (Result<Map<String, Any>>) -> Unit) =
    start(context, request, callback, 15 * 60_000L) { job -> prepareMovie(context.applicationContext, request, job) }

  fun prepareImage(context: Context, request: Map<String, Any?>, callback: (Result<Map<String, Any>>) -> Unit) =
    start(context, request, callback, 30_000L) { job -> normalizeImage(context.applicationContext, request, job) }

  private fun start(context: Context, request: Map<String, Any?>, callback: (Result<Map<String, Any>>) -> Unit,
    timeoutMs: Long, work: (Job) -> Unit) {
    val id = request["id"] as? String
    if (id == null || !Regex("[A-Za-z0-9_-]{8,120}").matches(id)) {
      callback(Result.failure(IllegalArgumentException("The memory export request is invalid."))); return
    }
    val job = Job(id, callback)
    synchronized(lock) {
      if (active != null || !StoryVideoComposition.reserveMemory(id)) {
        callback(Result.failure(IllegalStateException("Another video is still exporting."))); return
      }
      active = job
      job.thread.start(); job.handler = Handler(job.thread.looper)
      // Cancellation cannot finish a visible job until every monitor is
      // registered. Otherwise a late registration could retain a finished job.
      job.timeout = Runnable { cancelJob(job, "The memory export took too long. Choose a shorter cut and try again.") }.also { main.postDelayed(it, timeoutMs) }
      job.watch = object : Runnable {
        override fun run() {
          if (synchronized(lock) { active !== job }) return
          if ((job.output?.length() ?: 0L) > MAX_OUTPUT_BYTES) cancelJob(job, "The exported movie exceeds 256 MiB. Choose a shorter cut.")
          else if (context.cacheDir.usableSpace < 16L * 1024 * 1024) cancelJob(job, "There is not enough temporary storage for this export.")
          synchronized(lock) { if (active === job && !job.cancelled.get()) main.postDelayed(this, 250) }
        }
      }.also { main.postDelayed(it, 250) }
      job.handler.post { try { job.check(); work(job) } catch (error: Exception) { finish(job, Result.failure(error)) } }
    }
  }
  fun cancel(id: String) { synchronized(lock) { active?.takeIf { it.id == id } }?.let { cancelJob(it) } }
  fun cancelAll() { synchronized(lock) { active }?.let { cancelJob(it) } }
  private fun cancelJob(job: Job, reason: String = "Memory movie export was cancelled.") {
    synchronized(lock) {
      if (active !== job) return
      if (job.cancelled.compareAndSet(false, true)) job.reason = reason
    }
    // Do not resolve cancellation while a native writer still owns the file.
    job.handler.post { finish(job, Result.failure(IllegalStateException(job.reason))) }
  }
  private fun finish(job: Job, initial: Result<Map<String, Any>>) {
    if (synchronized(lock) { active !== job }) return
    var result = initial
    try { job.transformer?.cancel() } catch (error: Exception) { result = Result.failure(error) }
    job.transformer = null
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
  private fun output(context: Context, raw: Any?, prefix: String, extension: String): File {
    val uri = Uri.parse(raw as? String ?: error("The output file is missing."))
    require(uri.scheme == "file" && uri.host.isNullOrEmpty() && uri.query == null && uri.fragment == null) { "The output must be a local file." }
    val file = File(uri.path ?: error("The output path is invalid.")).canonicalFile
    require(file.parentFile == context.cacheDir.canonicalFile && file.name.startsWith(prefix)
      && file.extension == extension && !file.exists()) { "Choose a new export file in the app cache." }
    require(context.cacheDir.usableSpace > 32L * 1024 * 1024) { "There is not enough temporary storage for this export." }
    require(file.createNewFile()) { "The export file already exists." }
    return file
  }
  private fun number(map: Map<*, *>, key: String, min: Double, max: Double) = StoryVideoComposition.number(map, key, min, max)
  private fun recipe(value: Any?): StoryRecipe {
    val r = value as? Map<*, *> ?: error("A scene edit is missing.")
    require(r["width"] == 720 || (r["width"] as? Number)?.toDouble() == 720.0) { "Memory movies must be 720 by 1280." }
    require((r["height"] as? Number)?.toDouble() == 1280.0) { "Memory movies must be 720 by 1280." }
    val start = number(r, "trimStart", 0.0, 600.0); val end = number(r, "trimEnd", start + .05, 660.0)
    val speed = number(r, "speed", .25, 4.0)
    require(end - start <= 60.001 && (end - start) / speed in .05..120.0) { "A scene exceeds its duration limit." }
    val matrix = (r["matrix"] as? List<*>)?.map { (it as? Number)?.toDouble() ?: Double.NaN }
    require(matrix != null && matrix.size == 20 && matrix.all { it.isFinite() && abs(it) <= 16 }) { "A scene grade is invalid." }
    require(r["fit"] == "contain" || r["fit"] == "cover") { "A scene fit is invalid." }
    return StoryRecipe(720, 1280, start, end, speed.toFloat(), number(r,"volume",0.0,1.0).toFloat(), r["fit"] == "cover",
      number(r,"scale",.35,5.0).toFloat(), number(r,"x",-2.0,2.0).toFloat(), number(r,"y",-2.0,2.0).toFloat(), matrix.map { it.toFloat() }.toFloatArray())
  }
  private fun prepareMovie(context: Context, raw: Map<String, Any?>, job: Job) {
    require((raw["width"] as? Number)?.toDouble() == 720.0 && (raw["height"] as? Number)?.toDouble() == 1280.0) { "Memory movies must be 720 by 1280." }
    val rawScenes = raw["scenes"] as? List<*> ?: error("The movie scenes are missing.")
    require(rawScenes.size in 1..82) { "A memory movie needs between one and 82 scenes." }
    val files = mutableSetOf<String>(); var bytes = 0L; var artworkCount = 0; var totalUs = 0L
    fun local(value: Any?): File {
      job.check()
      val file = StoryVideoComposition.local(context, value)
      if (files.add(file.path)) { bytes += file.length(); require(bytes <= MAX_INPUT_BYTES) { "The prepared movie sources exceed 512 MiB." } }
      return file
    }
    val audioInfo = mutableMapOf<String, StoryVideoComposition.MediaInfo>()
    fun audio(value: Any?): Audio {
      val a = value as? Map<*, *> ?: error("A movie audio selection is invalid.")
      val file = local(a["uri"]); require(file.length() <= 50L * 1024 * 1024) { "A selected audio file is too large." }
      val info = audioInfo.getOrPut(file.path) { StoryVideoComposition.media(file) }
      val start = number(a,"start",0.0,600.0); val duration = number(a,"duration",1.0,600.0)
      require(info.hasAudio && !info.hasVideo && info.duration <= 600.1 && start + duration <= info.duration + .1) { "A soundtrack excerpt could not be read." }
      val excerpt = (minOf(duration, info.duration - start) * 1_000_000).roundToLong()
      require(excerpt > 0) { "A soundtrack excerpt is empty." }
      return Audio(file,(start * 1_000_000).roundToLong(),excerpt,number(a,"volume",0.0,1.0).toFloat(),a["loop"] as? Boolean ?: error("The audio loop is invalid."))
    }
    val identifiers = mutableSetOf<String>()
    val scenes = rawScenes.map { value ->
      job.check()
      val s = value as? Map<*, *> ?: error("A movie scene is invalid.")
      val id = s["id"] as? String ?: ""
      require(Regex("[A-Za-z0-9_-]{8,120}").matches(id) && identifiers.add(id)) { "Movie scene identities must be unique." }
      require(s["inputKind"] == "image" || s["inputKind"] == "video") { "A movie scene type is invalid." }
      val still = s["inputKind"] == "image"; val source = local(s["inputUri"]); val r = recipe(s["recipe"])
      val info = if (still) {
        require(r.start == 0.0 && r.speed == 1f && r.duration in 1.0..30.0) { "A still scene must last one to 30 seconds." }
        rejectAnimation(source,job::check); StoryVideoComposition.image(source); StoryVideoComposition.MediaInfo(r.duration,false,false)
      } else StoryVideoComposition.media(source).also { require(it.hasVideo && r.end <= it.duration + .1) { "A scene trim exceeds its video." } }
      val background = s["backgroundUri"]?.let { local(it).also { file -> rejectAnimation(file,job::check); StoryVideoComposition.image(file) } }
      val rawLayers = s["layers"] as? List<*> ?: error("Scene artwork is missing.")
      require(rawLayers.size <= 24) { "A scene has too many artwork layers." }
      artworkCount += rawLayers.size; require(artworkCount <= 240) { "The movie has too many artwork windows." }
      val layers = rawLayers.map { layer ->
        val l = layer as? Map<*, *> ?: error("A scene artwork window is invalid.")
        val start = number(l,"start",0.0,r.duration); val end = number(l,"end",start + .001,r.duration + .001)
        StoryArtwork(local(l["uri"]).also { file -> rejectAnimation(file,job::check); StoryVideoComposition.image(file) },start,end)
      }
      val motion = s["motion"] as? Map<*, *> ?: error("Scene motion is missing.")
      val transition = s["transition"] as? Map<*, *> ?: error("Scene transitions are missing.")
      val transform = MemorySceneTransform(r.duration,number(transition,"fadeSec",0.0,minOf(.5,r.duration/2)),
        number(motion,"fromScale",1.0,1.1).toFloat(),number(motion,"toScale",1.0,1.1).toFloat(),number(motion,"x",-.05,.05).toFloat(),number(motion,"y",-.05,.05).toFloat())
      totalUs += (r.duration * 1_000_000).roundToLong(); require(totalUs <= 300_001_000L) { "Choose a memory movie of five minutes or less." }
      Scene(source,still,r,background,layers,s["audio"]?.let(::audio),info.hasAudio && r.volume > 0 && minOf(r.end,info.audioEnd)-maxOf(r.start,info.audioStart) > .001,transform)
    }
    val soundtrack = raw["soundtrack"]?.let(::audio)
    val gain = if (soundtrack != null) {
      val windows = (raw["soundtrack"] as Map<*, *>)["gain"] as? List<*> ?: error("The soundtrack gain windows are missing.")
      require(windows.size == scenes.size) { "Every scene needs a soundtrack gain window." }
      var cursor = 0L
      windows.mapIndexed { index, value ->
        val w = value as? Map<*, *> ?: error("A soundtrack gain window is invalid.")
        val start = (number(w,"start",0.0,totalUs / 1_000_000.0) * 1_000_000).roundToLong()
        val end = (number(w,"end",(start + 10_000) / 1_000_000.0,totalUs / 1_000_000.0 + .002) * 1_000_000).roundToLong()
        require(abs(start-cursor) <= 2000 && abs((end-start)-scenes[index].durationUs) <= 2000) { "The soundtrack gain timeline is invalid." }
        // Normalize admitted sub-frame serialization error to the exact scene clock.
        Gain(cursor,cursor+scenes[index].durationUs,number(w,"volume",0.0,1.0).toFloat()).also { cursor += scenes[index].durationUs }
      }
    } else emptyList()
    val target = output(context,raw["outputUri"],"pc-memory-export-","mp4"); job.output = target
    var sceneOffsetUs = 0L
    // Media3's default drop effect retains a lookahead frame and discards it on
    // every item end. A shared, non-buffering limiter keeps each page's tail and
    // applies the 30 fps ceiling across the complete concatenated timeline.
    val frameRate = MemoryFrameRateEffect(job::check)
    val videoItems = scenes.map { scene ->
      val r = scene.recipe
      val item = if (scene.still) MediaItem.Builder().setUri(Uri.fromFile(scene.source)).setImageDurationMs((r.duration*1000).roundToLong()).build()
        else StoryVideoComposition.clipped(scene.source,r.start,r.end)
      val effects = mutableListOf<Effect>()
      if (r.speed != 1f) effects.add(SpeedChangeEffect(r.speed))
      effects.add(frameRate)
      // Media3 presents effects with the concatenated movie clock, even for
      // bitmap scenes. Authored artwork, fades and motion use page-local time.
      val sceneStart = sceneOffsetUs / 1_000_000.0
      effects.add(StoryCanvasEffect(r,scene.background,scene.layers,job::check,sceneStart))
      effects.add(MemorySceneEffect(scene.transform.copy(start=sceneStart),job::check))
      EditedMediaItem.Builder(item).setRemoveAudio(!scene.originalAudio).setFrameRate(30)
        .setEffects(Effects(if(scene.originalAudio) StoryVideoComposition.processors(r.volume,r.speed) else emptyList(),effects)).build()
        .also { sceneOffsetUs += scene.durationUs }
    }
    val sequences = mutableListOf(EditedMediaItemSequence.Builder(videoItems).experimentalSetForceAudioTrack(true).build())
    if (scenes.any { it.audio != null }) {
      val pageAudio = EditedMediaItemSequence.Builder()
      for (scene in scenes) appendAudio(pageAudio,scene.audio,scene.durationUs,emptyList(),job)
      sequences.add(pageAudio.experimentalSetForceAudioTrack(true).build())
    }
    if (soundtrack != null) {
      val bookAudio = EditedMediaItemSequence.Builder()
      appendAudio(bookAudio,soundtrack,totalUs,gain,job)
      sequences.add(bookAudio.experimentalSetForceAudioTrack(true).build())
    }
    val composition = Composition.Builder(sequences).setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL).build()
    val transformer = Transformer.Builder(context).setLooper(job.handler.looper)
      .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(DefaultEncoderFactory.Builder(context).setEnableFallback(false).build())
      .setVideoFrameProcessorFactory(DefaultVideoFrameProcessor.Factory.Builder().setSdrWorkingColorSpace(DefaultVideoFrameProcessor.WORKING_COLOR_SPACE_ORIGINAL).build())
      .setMaxDelayBetweenMuxerSamplesMs(15_000)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          try {
            job.check(); require(target.length() in 1025..MAX_OUTPUT_BYTES) { "The exported movie exceeds its file limit." }
            val expected = totalUs / 1_000_000.0
            val verifyRecipe = scenes[0].recipe.copy(start=0.0,end=expected,speed=1f)
            val result = StoryVideoComposition.verify(target,raw["outputUri"] as String,verifyRecipe,soundtrack != null,true,job::check).toMutableMap()
            require((result["duration"] as Number).toDouble() in expected-.15..expected+.2) { "The movie duration could not be verified." }
            result["sceneCount"] = scenes.size
            job.check(); finish(job,Result.success(result))
          } catch(error: Exception) { finish(job,Result.failure(error)) }
        }
        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) = finish(job,Result.failure(exportException))
      }).build()
    job.transformer = transformer; job.check(); transformer.start(composition,target.path)
  }

  /** Finite clips keep the music clock independent from page speed and duck changes. */
  private fun appendAudio(sequence: EditedMediaItemSequence.Builder, audio: Audio?, durationUs: Long, gain: List<Gain>, job: Job) {
    if (audio == null) { sequence.addGap(durationUs); return }
    val sounding = if(audio.loop) durationUs else minOf(durationUs,audio.excerptUs)
    var cursor = 0L; var clips = 0; var window = 0
    while(cursor < sounding) {
      job.check(); require(++clips <= 512) { "The selected music needs too many timeline segments." }
      while(window + 1 < gain.size && gain[window].endUs <= cursor) window++
      val offset = cursor % audio.excerptUs
      val end = minOf(sounding,cursor+audio.excerptUs-offset,if(gain.isEmpty()) sounding else gain[window].endUs)
      require(end > cursor) { "The music timeline could not advance." }
      val volume = audio.volume * (if(gain.isEmpty()) 1f else gain[window].volume)
      if(end-cursor < 1000L) sequence.addGap(end-cursor)
      else sequence.addItem(EditedMediaItem.Builder(StoryVideoComposition.clippedUs(audio.file,audio.startUs+offset,audio.startUs+offset+end-cursor))
        .setRemoveVideo(true).setEffects(Effects(StoryVideoComposition.processors(volume),emptyList())).build())
      cursor = end
    }
    if(cursor < durationUs) sequence.addGap(durationUs-cursor)
  }

  private fun normalizeImage(context: Context, raw: Map<String, Any?>, job: Job) {
    val input = StoryVideoComposition.local(context,raw["inputUri"])
    require(input.length() <= 32L*1024*1024) { "Choose a photo of 32 MiB or less." }
    rejectAnimation(input,job::check)
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(input.path,options)
    require(options.outWidth in 1..65535 && options.outHeight in 1..65535 && options.outWidth.toLong()*options.outHeight <= 200_000_000L) { "This photo cannot be prepared safely on this device." }
    val orientation = try { ExifInterface(input.path).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL) } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
    val rotated = orientation in listOf(ExifInterface.ORIENTATION_ROTATE_90,ExifInterface.ORIENTATION_ROTATE_270,ExifInterface.ORIENTATION_TRANSPOSE,ExifInterface.ORIENTATION_TRANSVERSE)
    val maxWidth = if(rotated) 2560 else 1440; val maxHeight = if(rotated) 1440 else 2560
    options.inSampleSize = 1
    while((options.outWidth + options.inSampleSize - 1)/options.inSampleSize > maxWidth || (options.outHeight + options.inSampleSize - 1)/options.inSampleSize > maxHeight) options.inSampleSize *= 2
    options.inJustDecodeBounds = false; options.inPreferredConfig = Bitmap.Config.ARGB_8888; options.inMutable = false
    job.check()
    val decoded = BitmapFactory.decodeFile(input.path,options) ?: error("This device could not decode the selected photo.")
    var image: Bitmap? = null
    val result: Map<String, Any> = try {
      job.check()
      val matrix = Matrix().apply { when(orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f,1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f,-1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f,1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f,1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
      } }
      image = Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,matrix,true)
      require(image.width in 1..1440 && image.height in 1..2560) { "The prepared image exceeds its size limit." }
      val target = output(context,raw["outputUri"],"pc-memory-image-","png"); job.output = target
      target.outputStream().use { require(image.compress(Bitmap.CompressFormat.PNG,100,it)) { "The prepared image could not be saved." } }
      job.check(); require(target.length() in 1..32L*1024*1024) { "The prepared image exceeds its file limit." }
      mapOf("uri" to (raw["outputUri"] as String),"width" to image.width,"height" to image.height,"bytes" to target.length())
    } finally { if(image !== decoded) image?.recycle(); decoded.recycle() }
    job.check(); finish(job,Result.success(result))
  }

  /** Inspect container structure, never decode animation frames just to discover them. */
  private fun rejectAnimation(file: File, checkCurrent: () -> Unit) {
    RandomAccessFile(file,"r").use { input ->
      val header = ByteArray(minOf(32,file.length().toInt())); input.readFully(header)
      fun ascii(start: Int,end: Int) = if(header.size>=end) String(header,start,end-start,Charsets.US_ASCII) else ""
      fun skip(bytes: Long) { require(bytes >= 0 && input.filePointer+bytes <= input.length()) { "The image container is incomplete." }; input.seek(input.filePointer+bytes) }
      if(ascii(0,6) in listOf("GIF87a","GIF89a")) {
        error("Animated images and GIFs cannot be included in a memory movie yet. Choose a static photo.")
      }
      if(header.size>=8 && header.sliceArray(0..7).contentEquals(byteArrayOf(-119,80,78,71,13,10,26,10))) {
        input.seek(8);var chunks=0
        while(input.filePointer+12<=input.length()) {
          checkCurrent();require(++chunks<=65536) { "The selected PNG has too many image sections." };val size=input.readInt().toLong() and 0xffffffffL;val kind=ByteArray(4);input.readFully(kind)
          val name=String(kind,Charsets.US_ASCII);require(name !in listOf("acTL","fcTL","fdAT")) { "Animated images and GIFs cannot be included in a memory movie yet. Choose a static photo." };skip(size+4);if(name=="IEND")return
        }
        error("The PNG image is incomplete.")
      }
      if(ascii(0,4)=="RIFF" && ascii(8,12)=="WEBP") {
        input.seek(12);var chunks=0
        while(input.filePointer+8<=input.length()) {
          checkCurrent();require(++chunks<=65536) { "The selected WebP has too many image sections." };val kind=ByteArray(4);input.readFully(kind);val size=Integer.reverseBytes(input.readInt()).toLong() and 0xffffffffL
          val name=String(kind,Charsets.US_ASCII);require(name!="ANIM" && name!="ANMF") { "Animated images and GIFs cannot be included in a memory movie yet. Choose a static photo." }
          if(name=="VP8X" && size>0) { val position=input.filePointer;val flags=input.readUnsignedByte();input.seek(position);require(flags and 2==0) { "Animated images and GIFs cannot be included in a memory movie yet. Choose a static photo." } }
          skip(size+(size and 1))
        }
      }
      if(ascii(4,8)=="ftyp") {
        input.seek(0);val size=input.readInt().toLong() and 0xffffffffL
        require(size in 16..minOf(4096,input.length())) { "The image brand header is invalid." }
        input.seek(8);val brands=ByteArray((size-8).toInt());input.readFully(brands)
        val names=brands.asList().chunked(4).map { String(it.toByteArray(),Charsets.US_ASCII) }
        require(names.none { it in listOf("msf1","avis","hevc","hevx") }) { "Animated image sequences need the animated composition feature." }
      }
    }
  }
}
