package expo.modules.securemedia

import android.system.Os
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.UUID

class SecureMediaCryptoTest {
  private lateinit var root: File
  private val key = Base64.encodeToString(ByteArray(32) { 7 }, Base64.NO_WRAP)
  @Before fun prepare() {
    root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "pc-offline-v1/" + UUID.randomUUID()).canonicalFile
    check(root.mkdirs())
  }
  @After fun cleanup() { root.deleteRecursively() }
  private fun source(): File = File(root, "source").apply { writeBytes(ByteArray(1024 * 1024) { (it % 251).toByte() }) }
  private fun transform(source: File, dest: File, encodedKey: String = key, decrypt: Boolean = false): Int =
    SecureMediaCrypto.transform(root, source.toURI().toString(), dest.toURI().toString(), encodedKey, decrypt)
  private fun rejects(action: () -> Unit) {
    var rejected = false
    try { action() } catch (_: Exception) { rejected = true }
    assertTrue("Operation must reject invalid input", rejected)
  }
  @Test fun fullResolutionRoundtrip() {
    val source = source(); val cipher = File(root, "cipher"); val opened = File(root, "opened")
    assertEquals(source.length().toInt() + 28, transform(source, cipher))
    assertEquals(source.length().toInt(), transform(cipher, opened, decrypt = true))
    assertArrayEquals(source.readBytes(), opened.readBytes())
  }
  @Test fun freshNoncePerWrite() {
    val source = source(); val first = File(root, "first"); val second = File(root, "second")
    transform(source, first); transform(source, second)
    assertFalse(first.readBytes().contentEquals(second.readBytes()))
  }
  @Test fun tamperedTagRejectedWithoutPlaintext() {
    val cipher = File(root, "cipher"); val opened = File(root, "opened")
    transform(source(), cipher)
    val data = cipher.readBytes(); data[data.lastIndex] = (data.last().toInt() xor 1).toByte(); cipher.writeBytes(data)
    rejects { transform(cipher, opened, decrypt = true) }
    assertFalse(opened.exists()); assertFalse(File(root, "opened.partial").exists())
  }
  @Test fun rotatedAccountKeyCannotDecrypt() {
    val cipher = File(root, "cipher"); val opened = File(root, "opened")
    transform(source(), cipher)
    rejects { transform(cipher, opened, Base64.encodeToString(ByteArray(32) { 8 }, Base64.NO_WRAP), true) }
    assertFalse(opened.exists()); assertFalse(File(root, "opened.partial").exists())
  }
  @Test fun traversalAndSymlinkEscapeRejected() {
    val source = source()
    rejects { transform(source, File(root, "../escape")) }
    val link = File(root, "escape-link")
    Os.symlink(root.parentFile!!.path, link.path)
    try { rejects { transform(source, File(link, "escaped")) } } finally { link.delete() }
  }
  @Test fun invalidKeyAndOversizeInputRejected() {
    val opened = File(root, "opened")
    rejects { transform(source(), opened, "bad-key") }
    val large = File(root, "large"); java.io.RandomAccessFile(large, "rw").use { it.setLength(24L * 1024 * 1024 + 1) }
    rejects { transform(large, opened) }
    assertFalse(opened.exists()); assertFalse(File(root, "opened.partial").exists())
  }
}
