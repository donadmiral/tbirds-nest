package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.ExifInterface
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.system.Os
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

/** Real concatenated movies, decoded pixels/PCM and private-file lifecycle checks. */
@RunWith(AndroidJUnit4::class)
@UnstableApi
class MemoryMovieExportTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val fixtures: File get() = File(context.filesDir, "memory-fixtures").apply { mkdirs() }
  private val evidence: File get() = File(context.filesDir, "evidence").apply { mkdirs() }
  private val media = StoryAudioExportTest()
  private val identity = listOf(1.0,0.0,0.0,0.0,0.0, 0.0,1.0,0.0,0.0,0.0, 0.0,0.0,1.0,0.0,0.0, 0.0,0.0,0.0,1.0,0.0)
  private fun uri(file: File) = Uri.fromFile(file).toString()
  private fun id(name: String) = "memory-$name-${sequence.incrementAndGet()}"
  private fun image(name: String, color: Int, width: Int = 720, height: Int = 1280, draw: ((Bitmap) -> Unit)? = null): File {
    val file = File(fixtures, "$name.png")
    val bitmap = Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
    try {
      bitmap.eraseColor(color); draw?.invoke(bitmap)
      file.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) }
    } finally { bitmap.recycle() }
    return file
  }
  private fun scene(name: String, file: File, seconds: Double = 1.0, kind: String = "image"): MutableMap<String, Any?> = mutableMapOf(
    "id" to id(name), "inputUri" to uri(file), "inputKind" to kind,
    "recipe" to mapOf("width" to 720,"height" to 1280,"trimStart" to 0.0,"trimEnd" to seconds,"speed" to 1.0,
      "volume" to 0.0,"fit" to "contain","scale" to 1.0,"x" to 0.0,"y" to 0.0,"matrix" to identity),
    "layers" to emptyList<Map<String,Any?>>(), "transition" to mapOf("fadeSec" to 0.0),
    "motion" to mapOf("fromScale" to 1.0,"toScale" to 1.0,"x" to 0.0,"y" to 0.0),
  )
  private fun edit(scene: MutableMap<String,Any?>, values: Map<String,Any?>) {
    scene["recipe"] = (scene["recipe"] as Map<*,*>).entries.associate { it.key.toString() to it.value } + values
  }
  private fun duration(scene: Map<String,Any?>): Double {
    val r=scene["recipe"] as Map<*,*>
    return ((r["trimEnd"] as Number).toDouble()-(r["trimStart"] as Number).toDouble())/(r["speed"] as Number).toDouble()
  }
  private fun request(name: String, scenes: List<Map<String,Any?>>): MutableMap<String,Any?> = mutableMapOf(
    "id" to id(name), "outputUri" to uri(File(context.cacheDir,"pc-memory-export-$name-${sequence.incrementAndGet()}.mp4")),
    "width" to 720,"height" to 1280,"scenes" to scenes,
  )
  private fun sound(file: File, start: Double = 1.0, seconds: Double = 1.0, volume: Double = 1.0, loop: Boolean = true) =
    mapOf("uri" to uri(file),"start" to start,"duration" to seconds,"volume" to volume,"loop" to loop)
  private fun bookSound(request: MutableMap<String,Any?>, scenes: List<Map<String,Any?>>, sound: Map<String,Any?>, gains: List<Double>) {
    assertEquals(scenes.size,gains.size)
    var cursor=0.0
    request["soundtrack"]=sound + mapOf("gain" to scenes.mapIndexed { index, scene ->
      val start=cursor; cursor+=duration(scene); mapOf("start" to start,"end" to cursor,"volume" to gains[index])
    })
  }
  private fun output(request: Map<String,Any?>) = File(Uri.parse(request["outputUri"] as String).path!!)
  private class Pending {
    val latch=CountDownLatch(1); val calls=AtomicInteger(); val value=AtomicReference<Result<Map<String,Any>>?>()
    fun accept(result: Result<Map<String,Any>>) { calls.incrementAndGet(); value.set(result); latch.countDown() }
    fun await(): Result<Map<String,Any>> {
      assertTrue("The native memory operation did not settle in 180 seconds",latch.await(180,TimeUnit.SECONDS))
      assertEquals("The native operation settled more than once",1,calls.get())
      return value.get()!!
    }
  }
  private fun begin(request: Map<String,Any?>) = Pending().also { MemoryMovieComposition.compose(context,request,it::accept) }
  private fun beginImage(request: Map<String,Any?>) = Pending().also { MemoryMovieComposition.prepareImage(context,request,it::accept) }
  private fun imageRequest(name: String, source: File) = mutableMapOf<String,Any?>(
    "id" to id(name),"inputUri" to uri(source),"outputUri" to uri(File(context.cacheDir,"pc-memory-image-$name-${sequence.incrementAndGet()}.png")),
  )
  private fun export(request: Map<String,Any?>, name: String): File {
    val result=begin(request).await().getOrThrow(); val file=output(request)
    assertEquals(request["outputUri"],result["uri"]); assertEquals(720,result["width"]); assertEquals(1280,result["height"])
    assertEquals((request["scenes"] as List<*>).size,result["sceneCount"])
    assertEquals(request["soundtrack"] != null,result["soundtrackMixed"])
    assertEquals(file.length(),(result["bytes"] as Number).toLong()); assertTrue(file.length() in 1025..256L*1024*1024)
    return file.copyTo(File(evidence,"$name.mp4"),overwrite=true).also { assertTrue(file.delete()) }
  }
  private fun normalized(request: Map<String,Any?>, name: String): File {
    val result=beginImage(request).await().getOrThrow(); val file=output(request)
    assertEquals(request["outputUri"],result["uri"]); assertEquals(file.length(),(result["bytes"] as Number).toLong())
    val decoded=BitmapFactory.decodeFile(file.path) ?: error("The prepared PNG could not be decoded")
    try {
      assertEquals(decoded.width,result["width"]); assertEquals(decoded.height,result["height"])
      assertTrue(decoded.width in 1..1440 && decoded.height in 1..2560)
    } finally { decoded.recycle() }
    return file.copyTo(File(evidence,"$name.png"),overwrite=true).also { assertTrue(file.delete()) }
  }
  private fun source(): File = File(evidence,"memory-source-original-330hz.mp4").takeIf { it.isFile }
    ?: media.sourceMovie("memory-source")
  private fun pixel(file: File, seconds: Double, x: Int, y: Int): Int {
    val retriever=MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val frame=retriever.getFrameAtTime((seconds*1_000_000).toLong(),MediaMetadataRetriever.OPTION_CLOSEST) ?: error("No decoded video frame")
      try { assertEquals(720,frame.width);assertEquals(1280,frame.height);return frame.getPixel(x,y) }
      finally { frame.recycle() }
    } finally { retriever.release() }
  }
  private fun color(expected: Int, actual: Int, tolerance: Int = 30) {
    for(shift in listOf(16,8,0)) assertTrue("Expected ${Integer.toHexString(expected)}, got ${Integer.toHexString(actual)}",
      abs((expected shr shift and 255)-(actual shr shift and 255))<=tolerance)
  }
  private fun coverage(file: File, seconds: Double, exactStillRate: Boolean = false): Map<String,Any> {
    assertEquals(seconds,media.duration(file),.12)
    val audio=media.decodeAudio(file); val audioEnd=audio.samples.size.toDouble()/audio.rate
    assertTrue("Decoded PCM does not cover the complete movie: $audioEnd vs $seconds",audioEnd in seconds-.12..seconds+.12)
    assertTrue(audio.samples.all { it.isFinite() })
    val extractor=MediaExtractor(); val pts=mutableListOf<Long>()
    try {
      extractor.setDataSource(file.path)
      val track=(0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/")==true }
      val format=extractor.getTrackFormat(track);assertEquals(720,format.getInteger(MediaFormat.KEY_WIDTH));assertEquals(1280,format.getInteger(MediaFormat.KEY_HEIGHT));extractor.selectTrack(track)
      while(extractor.sampleTime>=0) { pts.add(extractor.sampleTime);assertTrue("Unbounded encoded frame count",pts.size<=seconds*31+4);if(!extractor.advance())break }
    } finally { extractor.release() }
    assertTrue(pts.size>=2); assertTrue(pts.first() in 0..120_000)
    assertTrue("Video ended before its final page",pts.last()/1_000_000.0+1.0/30 in seconds-.12..seconds+.12)
    val steps=pts.zipWithNext { a,b -> b-a };assertTrue("Non-monotonic video timestamps",steps.all { it>0 })
    assertTrue("Video cadence exceeded the 30 fps cap",steps.min()>=30_000)
    assertTrue("A page has a video timing gap",steps.max()<=120_000)
    if(exactStillRate) assertTrue("Still pages did not encode at 30 fps",pts.size in (seconds*30-2).toInt()..(seconds*30+2).toInt())
    return mapOf("containerSeconds" to media.duration(file),"decodedAudioSeconds" to audioEnd,"videoFrames" to pts.size,
      "videoFirstUs" to pts.first(),"videoLastUs" to pts.last(),"minFrameStepUs" to steps.min(),"maxFrameStepUs" to steps.max())
  }
  private fun record(name: String, values: Map<String,Any> = emptyMap()) {
    synchronized(records) { records.put(JSONObject(values+mapOf("case" to name,"passed" to true))) }
  }

  @Test fun stillScenesKeepOrderAndContinuousDuckedSoundtrack() {
    val scenes=listOf(scene("red",image("red",Color.RED),1.25),scene("blue",image("blue",Color.BLUE),2.25),scene("green",image("green",Color.GREEN),1.5))
    val request=request("continuous",scenes)
    bookSound(request,scenes,sound(media.wav("memory-excerpt"),seconds=1.5,volume=.8),listOf(1.0,.25,.75))
    val file=export(request,"memory-continuous-music");val audio=media.decodeAudio(file)
    color(Color.RED,pixel(file,.5,360,640));color(Color.BLUE,pixel(file,2.0,360,640));color(Color.GREEN,pixel(file,4.0,360,640))
    val windows=listOf(Triple(440,.2,.6),Triple(880,1.05,1.2),Triple(880,1.33,1.45),Triple(440,1.7,2.1),Triple(440,3.7,3.9),Triple(880,4.15,4.4),Triple(440,4.7,4.9))
    val expected=listOf(.16,.16,.04,.04,.12,.12,.12)
    val amplitudes=windows.mapIndexed { index,w -> audio.amplitude(w.first,w.second,w.third).also { assertEquals("Music phase or duck gain changed at a page boundary",expected[index],it,.025) } }
    assertTrue(audio.amplitude(220,.2,4.9)<.01);assertTrue(audio.amplitude(1760,.2,4.9)<.01)
    record("stillScenesKeepOrderAndContinuousDuckedSoundtrack",coverage(file,5.0,true)+mapOf("amplitudes" to amplitudes,"expectedAmplitudes" to expected))
  }

  @Test fun videoPageAndBookAudioPreserveIndependentClocks() {
    val source=source();val excerpt=media.wav("memory-page-excerpt")
    val fast=scene("fast",source,3.0,"video");edit(fast,mapOf("trimStart" to 1.0,"speed" to 2.0,"volume" to .5))
    fast["audio"]=sound(excerpt,volume=.25,loop=false)
    val slow=scene("slow",source,2.0,"video");edit(slow,mapOf("trimStart" to 1.0,"speed" to .5,"volume" to .25))
    slow["audio"]=sound(excerpt,start=2.0,volume=.5,loop=false)
    val scenes=listOf(scene("title",image("title",Color.BLACK)),fast,slow,scene("end",image("end",Color.GREEN)))
    val request=request("independent-audio",scenes)
    bookSound(request,scenes,sound(media.wav("memory-book-tone",frequency=1100),start=0.0,seconds=1.5,volume=.5),listOf(1.0,.25,.5,1.0))
    val file=export(request,"memory-independent-audio");val audio=media.decodeAudio(file)
    val windows=listOf(.2 to .8,1.2 to 1.8,2.2 to 2.8,3.2 to 3.8,4.2 to 4.8)
    val original=windows.map { audio.amplitude(330,it.first,it.second) };val book=windows.map { audio.amplitude(1100,it.first,it.second) }
    val expectedOriginal=listOf(0.0,.1,.05,.05,0.0);val expectedBook=listOf(.1,.025,.05,.05,.1)
    original.forEachIndexed { i,v -> assertEquals("Original voice pitch/gain or silent-page gap changed",expectedOriginal[i],v,.022) }
    book.forEachIndexed { i,v -> assertEquals("Continuous book music changed with page speed",expectedBook[i],v,.022) }
    assertEquals(.05,audio.amplitude(440,1.2,1.8),.02);assertEquals(.1,audio.amplitude(880,2.2,2.8),.025)
    assertTrue("One-pass page voiceover leaked into its tail",audio.amplitude(880,3.2,3.8)<.01)
    assertTrue("Fast original pitch doubled",audio.amplitude(660,1.2,1.8)<.01);assertTrue("Slow original pitch halved",audio.amplitude(165,2.2,3.8)<.01)
    record("videoPageAndBookAudioPreserveIndependentClocks",coverage(file,5.0)+mapOf("original330Hz" to original,"book1100Hz" to book))
  }

  @Test fun sceneArtworkFadeAndMotionUseLocalTime() {
    val quadrants=image("quadrants",Color.RED,draw={ bitmap ->
      val canvas=Canvas(bitmap);val paint=Paint();paint.color=Color.GREEN;canvas.drawRect(360f,0f,720f,640f,paint)
      paint.color=Color.BLUE;canvas.drawRect(0f,640f,360f,1280f,paint);paint.color=Color.YELLOW;canvas.drawRect(360f,640f,720f,1280f,paint)
    })
    val overlay=image("moving-artwork",Color.TRANSPARENT,draw={ bitmap -> Canvas(bitmap).drawRect(50f,100f,170f,220f,Paint().apply { color=Color.CYAN }) })
    val second=scene("motion",quadrants,2.0)
    second["layers"]=listOf(mapOf("uri" to uri(overlay),"start" to .4,"end" to 1.2))
    second["transition"]=mapOf("fadeSec" to .25);second["motion"]=mapOf("fromScale" to 1.0,"toScale" to 1.1,"x" to .05,"y" to .05)
    val file=export(request("local-effects",listOf(scene("first",image("first",Color.RED),2.0),second)),"memory-local-effects")
    color(Color.RED,pixel(file,.7,110,160));color(Color.CYAN,pixel(file,2.7,110,160))
    color(Color.CYAN,pixel(file,2.7,40,150));color(Color.RED,pixel(file,3.4,110,160))
    color(Color.YELLOW,pixel(file,2.6,360,640));color(Color.RED,pixel(file,3.4,360,640))
    val first=pixel(file,2.0,100,300);color(Color.BLACK,first,18)
    val fadeIn=pixel(file,2.1,100,300);val fadeOut=pixel(file,3.9,100,300)
    assertTrue("Fade-in skipped the second scene's local clock",Color.red(fadeIn) in 55..150)
    assertTrue("Fade-out skipped the second scene's local clock",Color.red(fadeOut) in 55..150)
    record("sceneArtworkFadeAndMotionUseLocalTime",coverage(file,4.0,true)+mapOf("fadeInRed" to Color.red(fadeIn),"fadeOutRed" to Color.red(fadeOut),"timedArtworkAndWholeCompositeMotion" to true))
  }

  @Test fun onePassBookMusicDoesNotShortenSilentTail() {
    val picture=image("one-pass",Color.BLUE);val scenes=(1..3).map { scene("one-pass-$it",picture) };val request=request("one-pass",scenes)
    bookSound(request,scenes,sound(media.wav("memory-one-pass"),loop=false),listOf(1.0,.25,1.0))
    val file=export(request,"memory-one-pass");val audio=media.decodeAudio(file)
    assertEquals(.2,audio.amplitude(440,.2,.8),.025);assertTrue(audio.rms(1.3,2.8)<.003)
    record("onePassBookMusicDoesNotShortenSilentTail",coverage(file,3.0,true)+mapOf("tailRms" to audio.rms(1.3,2.8)))
  }

  @Test fun zeroGainBookSelectionEncodesSilence() {
    val picture=image("zero-gain",Color.RED);val scenes=listOf(scene("zero-a",picture),scene("zero-b",picture));val request=request("zero-gain",scenes)
    bookSound(request,scenes,sound(media.wav("memory-zero"),volume=.5),listOf(0.0,0.0))
    val file=export(request,"memory-zero-volume");val audio=media.decodeAudio(file)
    assertTrue(audio.rms(.2,1.8)<.002)
    record("zeroGainBookSelectionEncodesSilence",coverage(file,2.0,true)+mapOf("rms" to audio.rms(.2,1.8)))
  }

  private fun longRequest(name: String): MutableMap<String,Any?> {
    val picture=image("$name-source",Color.BLUE)
    return request(name,(1..5).map { scene("$name-$it",picture,20.0) })
  }
  private fun waitForWriter(request: Map<String,Any?>, pending: Pending) {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(30)
    while(!output(request).exists() && pending.latch.count>0 && System.nanoTime()<deadline) Thread.sleep(10)
    assertTrue("The writer did not create its owned output",output(request).exists())
    assertEquals("The long fixture unexpectedly finished before cancellation",1L,pending.latch.count)
  }
  private fun writerReleased() {
    val deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(20)
    while(System.nanoTime()<deadline) {
      val pending=Pending();StoryVideoComposition.compose(context,mapOf("id" to id("idle-probe")),pending::accept)
      val failure=pending.await().exceptionOrNull() ?: error("An incomplete probe was accepted")
      if(!failure.message.orEmpty().contains("Another video")) return
      Thread.sleep(20)
    }
    error("The actual native writer did not release its reservation")
  }

  @Test fun cancellationReleasesWriterBeforeRetryAndBlocksStory() {
    val request=longRequest("cancel");val pending=begin(request);waitForWriter(request,pending)
    val other=Pending();StoryVideoComposition.compose(context,mapOf("id" to id("blocked-story")),other::accept)
    assertTrue(other.await().exceptionOrNull()?.message.orEmpty().contains("Another video"))
    val rival=request("rival",listOf(scene("rival",image("rival",Color.RED))))
    assertTrue(begin(rival).await().exceptionOrNull()?.message.orEmpty().contains("Another video"));assertFalse(output(rival).exists())
    MemoryMovieComposition.cancel("unrelated-memory-request");assertEquals(1L,pending.latch.count)
    val at=System.nanoTime();MemoryMovieComposition.cancel(request["id"] as String)
    assertTrue(pending.await().isFailure);val elapsed=(System.nanoTime()-at)/1_000_000
    assertTrue("Cancellation did not stop the native writer promptly",elapsed<5000);assertFalse(output(request).exists());writerReleased()
    val retry=export(request("cancel-retry",listOf(scene("retry",image("retry",Color.GREEN)))),"memory-cancel-retry")
    color(Color.GREEN,pixel(retry,.5,360,640))
    record("cancellationReleasesWriterBeforeRetryAndBlocksStory",mapOf("milliseconds" to elapsed,"noPartialOutput" to true,"retry" to coverage(retry,1.0,true)))
  }

  @Test fun cancelAllStopsMovieAndImagePreparation() {
    val request=longRequest("background");val pending=begin(request);waitForWriter(request,pending)
    MemoryMovieComposition.cancelAll();assertTrue(pending.await().isFailure);assertFalse(output(request).exists());writerReleased()
    val photo=image("cancel-photo",Color.BLUE,2880,5120);val preparation=imageRequest("cancel-photo",photo)
    val imagePending=beginImage(preparation);MemoryMovieComposition.cancelAll()
    assertTrue(imagePending.await().isFailure);assertFalse(output(preparation).exists());assertTrue(photo.exists());writerReleased()
    val retry=normalized(imageRequest("prepare-retry",image("prepare-retry",Color.GREEN)),"memory-prepare-retry")
    assertTrue(retry.isFile)
    record("cancelAllStopsMovieAndImagePreparation",mapOf("movieAndImageOutputsRemoved" to true,"sourcePreserved" to true,"retryPassed" to true))
  }

  @Test fun outputByteCeilingCancelsAndRemovesTheOwnedFile() {
    val request=longRequest("byte-ceiling");val pending=begin(request);waitForWriter(request,pending)
    // Inject storage growth into this disposable job's own output to exercise
    // the live byte watchdog without encoding hundreds of megabytes of video.
    RandomAccessFile(output(request),"rw").use { it.setLength(256L*1024*1024+1) }
    val result=pending.await();assertTrue(result.isFailure);assertFalse(output(request).exists());writerReleased()
    assertTrue("Expected the byte limit rejection, got ${result.exceptionOrNull()}",result.exceptionOrNull()?.message.orEmpty().contains("256 MiB"))
    record("outputByteCeilingCancelsAndRemovesTheOwnedFile",mapOf("injectedOutputBytes" to 256L*1024*1024+1,"partialOutputRemoved" to true))
  }

  @Test fun normalizedPngIsBoundedAndPreservesTransparency() {
    val photo=image("large-alpha",Color.TRANSPARENT,2880,5120,draw={ bitmap ->
      Canvas(bitmap).drawRect(1440f,2560f,2880f,5120f,Paint().apply { color=Color.GREEN })
    })
    val file=normalized(imageRequest("large-alpha",photo),"memory-normalized-alpha")
    val bitmap=BitmapFactory.decodeFile(file.path)
    try {
      assertEquals(1440,bitmap.width);assertEquals(2560,bitmap.height);assertEquals(0,Color.alpha(bitmap.getPixel(100,100)))
      assertEquals(255,Color.alpha(bitmap.getPixel(1200,2200)));assertEquals(Color.GREEN,bitmap.getPixel(1200,2200))
    } finally { bitmap.recycle() }
    assertTrue(photo.exists())
    record("normalizedPngIsBoundedAndPreservesTransparency",mapOf("sourceWidth" to 2880,"sourceHeight" to 5120,"width" to 1440,"height" to 2560,"transparentPixelsPreserved" to true))
  }

  @Test fun normalizedJpegHonorsExifOrientation() {
    val photo=File(fixtures,"rotated-camera.jpg");val bitmap=Bitmap.createBitmap(600,300,Bitmap.Config.ARGB_8888)
    try {
      bitmap.eraseColor(Color.RED);Canvas(bitmap).drawRect(300f,0f,600f,300f,Paint().apply { color=Color.BLUE })
      photo.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,100,it)) }
    } finally { bitmap.recycle() }
    ExifInterface(photo.path).apply { setAttribute(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_ROTATE_90.toString());saveAttributes() }
    val file=normalized(imageRequest("camera-exif",photo),"memory-normalized-exif");val result=BitmapFactory.decodeFile(file.path)
    try { assertEquals(300,result.width);assertEquals(600,result.height);color(Color.RED,result.getPixel(150,150));color(Color.BLUE,result.getPixel(150,450)) }
    finally { result.recycle() }
    record("normalizedJpegHonorsExifOrientation",mapOf("sourceOrientation" to 6,"width" to 300,"height" to 600,"orientedPixelsVerified" to true))
  }

  @Test fun animatedContainersAreRejectedBeforeStaticPreparation() {
    val rejected=mutableListOf<String>()
    val sources=listOf("memory-animated.gif","memory-animated.png","memory-animated.webp","memory-static.gif").map { name ->
      File(fixtures,name).also { source -> InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { input -> source.outputStream().use { destination -> input.copyTo(destination) } } }
    }.toMutableList()
    // Incomplete marker-only containers must also fail closed before a decoder
    // can silently retain only their first image. Valid two-frame inputs above
    // remain separate fixtures; these mutations intentionally remove metadata.
    val png=File(fixtures,"memory-animated.png").readBytes().toString(Charsets.ISO_8859_1)
    for((name,bytes) in listOf(
      "memory-fctl-only.png" to png.replace("acTL","pcAa"),
      "memory-fdat-only.png" to png.replace("acTL","pcAa").replace("fcTL","pcBb"),
      "memory-vp8x-only.webp" to File(fixtures,"memory-animated.webp").readBytes().toString(Charsets.ISO_8859_1).replace("ANIM","pAAA").replace("ANMF","pBBB"),
    )) sources.add(File(fixtures,name).also { it.writeBytes(bytes.toByteArray(Charsets.ISO_8859_1)) })
    for(source in sources) {
      val name=source.name
      val request=imageRequest("animated",source);val result=beginImage(request).await()
      assertTrue("An actual animated container was flattened: $name",result.exceptionOrNull()?.message.orEmpty().contains("Animated"))
      assertFalse(output(request).exists());assertTrue(source.exists());rejected.add(name)
      val movie=request("animated-movie",listOf(scene("animated-scene",source)))
      assertTrue(begin(movie).await().exceptionOrNull()?.message.orEmpty().contains("Animated"));assertFalse(output(movie).exists())
    }
    record("animatedContainersAreRejectedBeforeStaticPreparation",mapOf("twoFrameStaticGifAndMarkerOnlyContainers" to rejected))
  }

  @Test fun imagePreparationRejectsUnsafeInputsAndPreservesExistingFiles() {
    val photo=image("safe-image",Color.RED)
    val oversized=File(fixtures,"oversized-photo.png");RandomAccessFile(oversized,"rw").use { it.setLength(32L*1024*1024+1) }
    try {
      val large=imageRequest("large",oversized);assertTrue(beginImage(large).await().exceptionOrNull()?.message.orEmpty().contains("32 MiB"));assertFalse(output(large).exists())
    } finally { oversized.delete() }
    val existing=imageRequest("existing",photo);val sentinel="owned-before-request".toByteArray();output(existing).writeBytes(sentinel)
    try { assertTrue(beginImage(existing).await().isFailure);assertArrayEquals(sentinel,output(existing).readBytes()) } finally { output(existing).delete() }
    val escaped=imageRequest("escaped",photo);val outside=File(context.filesDir,"pc-memory-image-escaped.png");escaped["outputUri"]=uri(outside)
    assertTrue(beginImage(escaped).await().isFailure);assertFalse(outside.exists())
    val remote=imageRequest("remote",photo);remote["inputUri"]="https://example.invalid/photo.png"
    assertTrue(beginImage(remote).await().isFailure);assertFalse(output(remote).exists());assertTrue(photo.exists())
    record("imagePreparationRejectsUnsafeInputsAndPreservesExistingFiles",mapOf("sourceByteLimit" to 32L*1024*1024,"existingOutputPreserved" to true,"remoteAndNoncacheOutputRejected" to true))
  }

  @Test fun movieLimitsAndGainContinuityAreEnforcedBeforeWriting() {
    val picture=image("limits",Color.BLUE);val rejected=mutableListOf<String>()
    fun reject(name: String, candidate: MutableMap<String,Any?>) {
      assertTrue("Invalid $name was accepted",begin(candidate).await().isFailure);assertFalse(output(candidate).exists());rejected.add(name)
    }
    reject("empty",request("empty",emptyList()))
    reject("83-scenes",request("83-scenes",(1..83).map { scene("limit-$it",picture) }))
    val duplicate=scene("duplicate",picture);reject("duplicate-identities",request("duplicate",listOf(duplicate,duplicate)))
    reject("duration",request("long",(1..11).map { scene("long-$it",picture,30.0) }))
    val invalidMotion=scene("motion-invalid",picture);invalidMotion["motion"]=mapOf("fromScale" to 1.0,"toScale" to 1.11,"x" to 0.0,"y" to 0.0)
    reject("motion",request("motion-invalid",listOf(invalidMotion)))
    val invalidGrade=scene("grade-invalid",picture);edit(invalidGrade,mapOf("matrix" to identity.map { Double.NaN }))
    reject("nonfinite-grade",request("grade-invalid",listOf(invalidGrade)))
    val layers=(1..11).map { number -> scene("layers-$number",picture).also { it["layers"]=(1..22).map { mapOf("uri" to uri(picture),"start" to 0.0,"end" to 1.0) } } }
    reject("aggregate-artwork",request("layers",layers))
    val scenes=listOf(scene("gain-a",picture),scene("gain-b",picture));val badGain=request("gain-gap",scenes)
    badGain["soundtrack"]=sound(media.wav("memory-bad-gain"))+mapOf("gain" to listOf(mapOf("start" to 0.0,"end" to 1.0,"volume" to 1.0),mapOf("start" to 1.1,"end" to 2.0,"volume" to .5)))
    reject("gain-gap",badGain)
    val incorrectSize=request("size",listOf(scene("size",picture)));incorrectSize["width"]=1080;reject("canvas",incorrectSize)
    record("movieLimitsAndGainContinuityAreEnforcedBeforeWriting",mapOf("rejected" to rejected,"allOutputsAbsent" to true))
  }

  @Test fun aggregateInputBytesAreBoundedWithoutCopyingLargeSources() {
    val files=listOf(image("sparse-one",Color.RED),image("sparse-two",Color.BLUE))
    try {
      files.forEach { file -> RandomAccessFile(file,"rw").use { it.setLength(270L*1024*1024) } }
      val request=request("aggregate-input",files.mapIndexed { i,file -> scene("aggregate-$i",file) })
      val result=begin(request).await();assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("512 MiB"));assertFalse(output(request).exists())
      assertTrue(files.all { it.length()==270L*1024*1024 })
      record("aggregateInputBytesAreBoundedWithoutCopyingLargeSources",mapOf("preparedSourceBytes" to files.sumOf { it.length() },"limitBytes" to 512L*1024*1024,"sourcesPreserved" to true))
    } finally { files.forEach { it.delete() } }
  }

  @Test fun sourcePathsRemainConfinedEvenThroughSymlinks() {
    val privatePhoto=image("private-photo",Color.RED);val external=File(context.externalCacheDir!!,"memory-external.png")
    privatePhoto.copyTo(external,overwrite=true);val link=File(fixtures,"external-link.png");Os.symlink(external.path,link.path)
    try {
      for(file in listOf(external,link)) {
        val request=request("unconfined",listOf(scene("unconfined",file)))
        assertTrue(begin(request).await().isFailure);assertFalse(output(request).exists())
        val preparation=imageRequest("unconfined-image",file);assertTrue(beginImage(preparation).await().isFailure);assertFalse(output(preparation).exists())
      }
      assertTrue(external.exists());assertTrue(privatePhoto.exists())
    } finally { link.delete();external.delete() }
    record("sourcePathsRemainConfinedEvenThroughSymlinks",mapOf("externalAndSymlinkRejected" to true,"callerSourcesPreserved" to true))
  }

  @Test fun mutedVideoKeepsPageVoiceoverAndSilentCards() {
    val video=scene("muted",source(),2.0,"video");edit(video,mapOf("volume" to 0.0))
    video["audio"]=sound(media.wav("memory-muted-voice"),volume=.5,loop=false)
    val scenes=listOf(scene("mute-title",image("mute-title",Color.BLACK)),video,scene("mute-end",image("mute-end",Color.GREEN)))
    val file=export(request("muted-page",scenes),"memory-muted-original");val audio=media.decodeAudio(file)
    assertTrue(audio.rms(.2,.8)<.003);assertEquals(.1,audio.amplitude(440,1.2,1.8),.025)
    assertTrue(audio.amplitude(330,1.2,2.8)<.01);assertTrue(audio.rms(2.3,3.8)<.003)
    record("mutedVideoKeepsPageVoiceoverAndSilentCards",coverage(file,4.0)+mapOf("voiceover440Hz" to audio.amplitude(440,1.2,1.8),"tailRms" to audio.rms(2.3,3.8)))
  }

  @After fun stopAnyFailedJob() {
    MemoryMovieComposition.cancelAll();StoryVideoComposition.cancelAll();writerReleased()
    context.cacheDir.listFiles()?.filter { it.name.startsWith("pc-memory-export-") || it.name.startsWith("pc-memory-image-") }?.forEach { it.delete() }
  }
  companion object {
    private val sequence=AtomicInteger();private val records=JSONArray()
    @JvmStatic @AfterClass fun saveReceipt() {
      val context=InstrumentationRegistry.getInstrumentation().targetContext
      val directory=File(context.filesDir,"evidence").apply { mkdirs() }
      File(directory,"memory-receipt.json").writeText(JSONObject().put("sdk",Build.VERSION.SDK_INT).put("model",Build.MODEL)
        .put("abis",JSONArray(Build.SUPPORTED_ABIS.toList())).put("media3Version","1.8.1")
        .put("renderer","Actual production MemoryMovieComposition.kt, StoryVideoComposition.kt and StoryVideoEffects.kt")
        .put("cases",records).put("physicalDeviceAcceptance",false).toString(2)+"\n")
    }
  }
}
