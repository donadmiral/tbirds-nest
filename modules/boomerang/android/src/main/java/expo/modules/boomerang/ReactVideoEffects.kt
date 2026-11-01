package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.SegmentationMask
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import java.nio.ByteBuffer
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.roundToInt

/** Fit the original or crop the transparent camera layer onto an exact canvas. */
@UnstableApi
internal class ReactLayerEffect(
  private val rect: ReactRect, private val zoom: Float, private val foreground: Boolean,
  private val cutout: Boolean, private val checkCurrent: () -> Unit,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): BaseGlShaderProgram {
    require(!useHdr) { "Reaction export requires SDR output." }
    return ReactLayerProgram(rect, zoom, foreground, cutout, checkCurrent)
  }
}

@UnstableApi
private class ReactLayerProgram(
  private val rect: ReactRect, private val zoom: Float, private val foreground: Boolean,
  private val cutout: Boolean, private val checkCurrent: () -> Unit,
) : BaseGlShaderProgram(false, 2) {
  private val program = GlProgram(VERTEX, FRAGMENT)
  private val readProgram = if (cutout) GlProgram(VERTEX, READ_FRAGMENT) else null
  private val segmenter = if (cutout) Segmentation.getClient(SelfieSegmenterOptions.Builder()
    .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).enableRawSizeMask().build()) else null
  private var analysis: Bitmap? = null
  private var readBuffer: ByteBuffer? = null
  private var pixels = IntArray(0)
  private var maskBitmap: Bitmap? = null
  private var maskPixels = IntArray(0)
  private var readTexture = 0
  private var readFramebuffer = 0
  private var maskTexture = 0
  private var pendingMask: Task<SegmentationMask>? = null
  private var released = false

  init {
    program.setBufferAttribute("aPosition", GlUtil.getNormalizedCoordinateBounds(), 4)
    readProgram?.setBufferAttribute("aPosition", GlUtil.getNormalizedCoordinateBounds(), 4)
    program.setFloatsUniform("uRect", floatArrayOf(rect.x * 720, (1 - rect.y - rect.height) * 1280, rect.width * 720, rect.height * 1280))
    program.setFloatUniform("uForeground", if (foreground) 1f else 0f)
    program.setFloatUniform("uCutout", if (cutout) 1f else 0f)
    val opaque = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
    try { opaque.eraseColor(Color.WHITE); maskTexture = GlUtil.createTexture(opaque) } finally { opaque.recycle() }
  }
  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    checkCurrent()
    require(inputWidth > 0 && inputHeight > 0) { "The reaction video frame is empty." }
    val scaleX = rect.width * 720 / inputWidth; val scaleY = rect.height * 1280 / inputHeight
    // Match the capture preview and iOS renderer: preserve the whole original
    // until the creator zooms it, while the camera fills its own window.
    val scale = (if (foreground) maxOf(scaleX, scaleY) else minOf(scaleX, scaleY)) * zoom
    val drawnWidth = inputWidth * scale; val drawnHeight = inputHeight * scale
    program.setFloatsUniform("uDraw", floatArrayOf(drawnWidth, drawnHeight))
    program.setFloatsUniform("uOffset", floatArrayOf(rect.x * 720 + (rect.width * 720 - drawnWidth) / 2,
      (1 - rect.y - rect.height) * 1280 + (rect.height * 1280 - drawnHeight) / 2))
    if (cutout) {
      // Only the small analysis frame crosses the GPU/CPU boundary. The full
      // camera frame stays on the GPU and receives this frame's inferred mask.
      val ratio = minOf(1.0, 384.0 / maxOf(inputWidth, inputHeight))
      val width = maxOf(1, (inputWidth * ratio).roundToInt()); val height = maxOf(1, (inputHeight * ratio).roundToInt())
      releaseAnalysis()
      analysis = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      pixels = IntArray(width * height); readBuffer = ByteBuffer.allocateDirect(width * height * 4)
      readTexture = GlUtil.createTexture(analysis!!)
      val framebuffers = IntArray(1); GLES20.glGenFramebuffers(1, framebuffers, 0); readFramebuffer = framebuffers[0]
    }
    return Size(720, 1280)
  }
  override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
    try {
      checkCurrent()
      if (cutout) updateMask(inputTexId)
      program.use()
      program.setSamplerTexIdUniform("uInput", inputTexId, 0)
      program.setSamplerTexIdUniform("uMask", maskTexture, 1)
      program.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    } catch (error: Exception) { throw VideoFrameProcessingException(error, presentationTimeUs) }
  }
  private fun updateMask(inputTexId: Int) {
    val bitmap = analysis ?: error("The camera cutout could not initialize.")
    val bytes = readBuffer ?: error("The camera cutout frame is unavailable.")
    val framebuffer = IntArray(1); val viewport = IntArray(4)
    GLES20.glGetIntegerv(GLES20.GL_FRAMEBUFFER_BINDING, framebuffer, 0)
    GLES20.glGetIntegerv(GLES20.GL_VIEWPORT, viewport, 0)
    try {
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, readFramebuffer)
      GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, readTexture, 0)
      require(GLES20.glCheckFramebufferStatus(GLES20.GL_FRAMEBUFFER) == GLES20.GL_FRAMEBUFFER_COMPLETE) { "This device cannot prepare a camera cutout." }
      GLES20.glViewport(0, 0, bitmap.width, bitmap.height)
      readProgram!!.use(); readProgram.setSamplerTexIdUniform("uInput", inputTexId, 0); readProgram.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      bytes.clear(); GLES20.glReadPixels(0, 0, bitmap.width, bitmap.height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, bytes)
      GlUtil.checkGlError()
    } finally {
      GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, framebuffer[0])
      GLES20.glViewport(viewport[0], viewport[1], viewport[2], viewport[3])
    }
    // GL rows are bottom-up; ML Kit consumes top-left Android bitmap rows.
    for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
      val offset = ((bitmap.height - 1 - y) * bitmap.width + x) * 4
      pixels[y * bitmap.width + x] = Color.rgb(bytes.get(offset).toInt() and 255, bytes.get(offset + 1).toInt() and 255, bytes.get(offset + 2).toInt() and 255)
    }
    bitmap.setPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    checkCurrent()
    val task = segmenter!!.process(InputImage.fromBitmap(bitmap, 0)); pendingMask = task
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
    var mask: SegmentationMask? = null
    while (mask == null) {
      checkCurrent()
      require(System.nanoTime() < deadline) { "Camera cutout took too long. Try another layout." }
      try { mask = Tasks.await(task, 100, TimeUnit.MILLISECONDS) } catch (_: TimeoutException) { /* Keep cancellation responsive while the bundled model runs. */ }
    }
    pendingMask = null; checkCurrent()
    val width = mask.width; val height = mask.height
    require(width in 1..1024 && height in 1..1024) { "The camera cutout mask is invalid." }
    if (maskBitmap?.width != width || maskBitmap?.height != height) {
      maskBitmap?.recycle(); maskBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888); maskPixels = IntArray(width * height)
    }
    val confidence = mask.buffer; confidence.rewind()
    require(confidence.remaining() >= width * height * 4) { "The camera cutout mask is incomplete." }
    for (index in maskPixels.indices) {
      val value = confidence.float
      require(value.isFinite()) { "The camera cutout mask is invalid." }
      val channel = (value.coerceIn(0f, 1f) * 255).roundToInt()
      maskPixels[index] = Color.rgb(channel, channel, channel)
    }
    maskBitmap!!.setPixels(maskPixels, 0, width, 0, 0, width, height)
    GlUtil.setTexture(maskTexture, maskBitmap!!)
  }
  private fun releaseAnalysis() {
    if (readTexture != 0) { GlUtil.deleteTexture(readTexture); readTexture = 0 }
    if (readFramebuffer != 0) { GLES20.glDeleteFramebuffers(1, intArrayOf(readFramebuffer), 0); readFramebuffer = 0 }
    val bitmap = analysis; analysis = null
    if (bitmap != null) {
      val task = pendingMask
      if (task != null && !task.isComplete) task.addOnCompleteListener(Executor { it.run() }) { bitmap.recycle() }
      else bitmap.recycle()
    }
    readBuffer = null; pixels = IntArray(0)
  }
  override fun release() {
    if (released) return
    released = true
    var failure: Exception? = null
    fun dispose(block: () -> Unit) { try { block() } catch (error: Exception) { if (failure == null) failure = error } }
    dispose { segmenter?.close() }; dispose { releaseAnalysis() }
    dispose { program.delete() }; dispose { readProgram?.delete() }
    if (maskTexture != 0) dispose { GlUtil.deleteTexture(maskTexture); maskTexture = 0 }
    maskBitmap?.recycle(); maskBitmap = null; maskPixels = IntArray(0)
    dispose { super.release() }
    failure?.let { throw VideoFrameProcessingException(it) }
  }
  companion object {
    private const val VERTEX = """
      attribute vec4 aPosition;
      varying vec2 vUv;
      void main() { gl_Position = aPosition; vUv = (aPosition.xy + 1.0) * 0.5; }
    """
    private const val READ_FRAGMENT = """
      precision highp float;
      uniform sampler2D uInput;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uInput, vUv); }
    """
    private const val FRAGMENT = """
      precision highp float;
      uniform sampler2D uInput;
      uniform sampler2D uMask;
      uniform vec4 uRect;
      uniform vec2 uDraw;
      uniform vec2 uOffset;
      uniform float uForeground;
      uniform float uCutout;
      varying vec2 vUv;
      void main() {
        vec2 canvas = vUv * vec2(720.0, 1280.0);
        vec2 uv = (canvas - uOffset) / uDraw;
        vec4 result = vec4(0.0, 0.0, 0.0, 1.0 - uForeground);
        if (canvas.x >= uRect.x && canvas.y >= uRect.y && canvas.x <= uRect.x + uRect.z && canvas.y <= uRect.y + uRect.w && uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
          vec4 source = texture2D(uInput, uv);
          float mask = uCutout > 0.5 ? smoothstep(0.2, 0.8, texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).r) : 1.0;
          result = vec4(source.rgb * mask, source.a * mask);
        }
        gl_FragColor = result;
      }
    """
  }
}
