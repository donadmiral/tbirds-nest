package expo.modules.boomerang

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/** Test-only provider. It has no exported permission or network capability. */
class FixtureMediaProvider : ContentProvider() {
  override fun onCreate() = true
  override fun getType(uri: Uri) = "video/mp4"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
    require(mode == "r")
    val id = uri.lastPathSegment ?: error("Missing fixture")
    val kind = uri.pathSegments.firstOrNull()
    require(id.matches(Regex("[A-Za-z0-9_.-]+")))
    if (kind == "range") {
      val source = File(context!!.filesDir, "evidence/$id")
      val ranged = File(context!!.cacheDir, "provider-range-$id")
      ranged.outputStream().use { output ->
        output.write(ByteArray(4096)); source.inputStream().use { it.copyTo(output) }; output.write(ByteArray(4096))
      }
      return AssetFileDescriptor(ParcelFileDescriptor.open(ranged, ParcelFileDescriptor.MODE_READ_ONLY), 4096, source.length())
    }
    val knownSource = if (kind == "known" || kind == "truncated") File(context!!.filesDir, "evidence/$id") else null
    val declaredLength = if (kind == "offset") 1024L else knownSource?.length()?.let { it + if (kind == "truncated") 128 else 0 } ?: AssetFileDescriptor.UNKNOWN_LENGTH
    val pipe = ParcelFileDescriptor.createPipe()
    val writer = ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])
    writers[id] = writer; counts[id] = AtomicLong()
    Thread({
      try {
        when (kind) {
          "file", "known", "truncated" -> {
            val source = File(context!!.filesDir, "evidence/$id")
            source.inputStream().use { input ->
              val bytes = ByteArray(64 * 1024)
              while (true) { val count = input.read(bytes); if (count < 0) break; writer.write(bytes, 0, count); counts[id]!!.addAndGet(count.toLong()) }
            }
            if (kind == "known") while (writers[id] === writer) Thread.sleep(50)
          }
          "oversize" -> {
            val bytes = ByteArray(64 * 1024)
            repeat(8_194) { writer.write(bytes); counts[id]!!.addAndGet(bytes.size.toLong()) }
          }
          "blocked" -> {
            writer.write(ByteArray(64 * 1024)); counts[id]!!.addAndGet(64 * 1024)
            // Remain open without delivering EOF or more bytes. The production
            // renderer must cancel its polling read without help from us.
            while (writers[id] === writer) Thread.sleep(50)
          }
          "offset" -> while (writers[id] === writer) Thread.sleep(50)
          else -> error("Unknown fixture")
        }
      } catch (_: Exception) {
      } finally {
        try { writer.close() } catch (_: Exception) {}
        writers.remove(id, writer)
      }
    }, "FixtureMediaStream").apply { isDaemon = true }.start()
    return AssetFileDescriptor(pipe[0], if (kind == "offset") 1L shl 40 else 0L, declaredLength)
  }

  companion object {
    private val writers = ConcurrentHashMap<String, ParcelFileDescriptor.AutoCloseOutputStream>()
    private val counts = ConcurrentHashMap<String, AtomicLong>()
    fun written(id: String): Long = counts[id]?.get() ?: 0
    fun isOpen(id: String): Boolean = writers.containsKey(id)
    fun closeAll() {
      val active = writers.values.toList(); writers.clear()
      active.forEach { try { it.close() } catch (_: Exception) {} }
    }
  }
}
