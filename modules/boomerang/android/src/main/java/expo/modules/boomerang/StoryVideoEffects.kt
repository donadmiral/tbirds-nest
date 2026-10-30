package expo.modules.boomerang

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import java.io.File

internal data class StoryArtwork(val file: File, val start: Double, val end: Double)

/** One exact canvas pass, including the 4x5 matrix used by the shared editor. */
@UnstableApi
internal class StoryCanvasEffect(
  private val recipe: StoryRecipe,
  private val background: File?,
  private val layers: List<StoryArtwork>,
  private val checkCurrent: () -> Unit,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): BaseGlShaderProgram {
    require(!useHdr) { "Story export requires SDR output." }
    return StoryCanvasProgram(recipe, background, layers, checkCurrent)
  }
}

@UnstableApi
private class StoryCanvasProgram(
  private val recipe: StoryRecipe,
  background: File?,
  private val layers: List<StoryArtwork>,
  private val checkCurrent: () -> Unit,
) : BaseGlShaderProgram(false, 1) {
  private val program = GlProgram(VERTEX, FRAGMENT)
  private val bitmap = Bitmap.createBitmap(recipe.width, recipe.height, Bitmap.Config.ARGB_8888)
  private val canvas = Canvas(bitmap)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val bounds = Rect(0, 0, recipe.width, recipe.height)
  private var backgroundTexture = 0
  private var artworkTexture = 0
  private var previousLayers: List<Int>? = null
  private var sourceWidth = 0
  private var sourceHeight = 0
  private var released = false

  init {
    try {
      checkCurrent()
      bitmap.eraseColor(Color.BLACK)
      if (background != null) drawImage(background)
      backgroundTexture = GlUtil.createTexture(bitmap)
      bitmap.eraseColor(Color.TRANSPARENT)
      artworkTexture = GlUtil.createTexture(bitmap)
      program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), 4)
      program.setFloatsUniform("uCanvasSize", floatArrayOf(recipe.width.toFloat(), recipe.height.toFloat()))
      // GLSL matrices are column-major; the editor's rows include a fifth bias.
      val matrix = FloatArray(16) { index -> recipe.matrix[(index % 4) * 5 + index / 4] }
      program.setFloatsUniform("uColorMatrix", matrix)
      program.setFloatsUniform("uColorBias", FloatArray(4) { recipe.matrix[it * 5 + 4] })
    } catch (error: Exception) {
      release()
      throw VideoFrameProcessingException(error)
    }
  }

  override fun configure(inputWidth: Int, inputHeight: Int): Size {
    checkCurrent()
    require(inputWidth > 0 && inputHeight > 0) { "The video frame is empty." }
    sourceWidth = inputWidth
    sourceHeight = inputHeight
    val fitX = recipe.width.toFloat() / inputWidth
    val fitY = recipe.height.toFloat() / inputHeight
    val scale = (if (recipe.cover) maxOf(fitX, fitY) else minOf(fitX, fitY)) * recipe.scale
    val drawnWidth = inputWidth * scale
    val drawnHeight = inputHeight * scale
    program.setFloatsUniform("uDrawSize", floatArrayOf(drawnWidth, drawnHeight))
    program.setFloatsUniform("uOffset", floatArrayOf(
      (recipe.width - drawnWidth) / 2 + recipe.x * recipe.width,
      (recipe.height - drawnHeight) / 2 - recipe.y * recipe.height,
    ))
    return Size(recipe.width, recipe.height)
  }

  override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
    try {
      checkCurrent()
      check(sourceWidth > 0 && sourceHeight > 0)
      val time = presentationTimeUs / 1_000_000.0
      val active = layers.indices.filter { time >= layers[it].start && time < layers[it].end }
      if (active != previousLayers) {
        bitmap.eraseColor(Color.TRANSPARENT)
        // Only one decoded artwork image is resident at a time. Twenty-three
        // timed windows cannot retain twenty-three full-resolution bitmaps.
        active.forEach { index -> checkCurrent(); drawImage(layers[index].file) }
        GlUtil.setTexture(artworkTexture, bitmap)
        previousLayers = active
      }
      program.use()
      program.setSamplerTexIdUniform("uInput", inputTexId, 0)
      program.setSamplerTexIdUniform("uBackground", backgroundTexture, 1)
      program.setSamplerTexIdUniform("uArtwork", artworkTexture, 2)
      program.bindAttributesAndUniforms()
      GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
      GlUtil.checkGlError()
    } catch (error: Exception) {
      throw VideoFrameProcessingException(error, presentationTimeUs)
    }
  }

  private fun drawImage(file: File) {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    require(options.outWidth in 1..2200 && options.outHeight in 1..4000) { "Story artwork exceeds its size limit." }
    options.inJustDecodeBounds = false
    options.inSampleSize = 1
    while (options.outWidth / (options.inSampleSize * 2) >= recipe.width && options.outHeight / (options.inSampleSize * 2) >= recipe.height) options.inSampleSize *= 2
    val decoded = BitmapFactory.decodeFile(file.path, options) ?: error("A story artwork layer could not be read.")
    try {
      require(decoded.width in 1..2200 && decoded.height in 1..4000) { "Story artwork exceeds its size limit." }
      canvas.drawBitmap(decoded, null, bounds, paint)
    } finally { decoded.recycle() }
  }

  override fun release() {
    if (released) return
    released = true
    var failure: Exception? = null
    fun releasePart(action: () -> Unit) { try { action() } catch (error: Exception) { if (failure == null) failure = error } }
    releasePart { program.delete() }
    val background = backgroundTexture; backgroundTexture = 0
    val artwork = artworkTexture; artworkTexture = 0
    if (background != 0) releasePart { GlUtil.deleteTexture(background) }
    if (artwork != 0) releasePart { GlUtil.deleteTexture(artwork) }
    if (!bitmap.isRecycled) bitmap.recycle()
    releasePart { super.release() }
    failure?.let { throw VideoFrameProcessingException(it) }
  }

  companion object {
    private const val VERTEX = """
      attribute vec4 aFramePosition;
      varying vec2 vCanvas;
      void main() {
        gl_Position = aFramePosition;
        vCanvas = (aFramePosition.xy + 1.0) * 0.5;
      }
    """
    private const val FRAGMENT = """
      precision highp float;
      uniform sampler2D uInput;
      uniform sampler2D uBackground;
      uniform sampler2D uArtwork;
      uniform vec2 uCanvasSize;
      uniform vec2 uDrawSize;
      uniform vec2 uOffset;
      uniform mat4 uColorMatrix;
      uniform vec4 uColorBias;
      varying vec2 vCanvas;
      void main() {
        // Android Bitmap rows start at the top; video texture rows start below.
        vec2 bitmapUv = vec2(vCanvas.x, 1.0 - vCanvas.y);
        vec4 result = texture2D(uBackground, bitmapUv);
        vec2 sourceUv = (vCanvas * uCanvasSize - uOffset) / uDrawSize;
        if (sourceUv.x >= 0.0 && sourceUv.x <= 1.0 && sourceUv.y >= 0.0 && sourceUv.y <= 1.0) {
          vec4 source = texture2D(uInput, sourceUv);
          if (source.a > 0.0) source.rgb /= source.a;
          vec4 graded = clamp(uColorMatrix * source + uColorBias, 0.0, 1.0);
          result = vec4(graded.rgb * graded.a + result.rgb * (1.0 - graded.a),
                        graded.a + result.a * (1.0 - graded.a));
        }
        vec4 artwork = texture2D(uArtwork, bitmapUv);
        gl_FragColor = vec4(artwork.rgb + result.rgb * (1.0 - artwork.a), 1.0);
      }
    """
  }
}
