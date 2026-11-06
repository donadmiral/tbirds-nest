package expo.modules.securemedia

import java.io.File
import java.net.URI
import java.security.SecureRandom
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Shared by the Expo bridge and isolated Android runtime instrumentation.
object SecureMediaCrypto {
  fun transform(root: File, input: String, output: String, encodedKey: String, decrypt: Boolean): Int {
      fun checked(path: String): File {
        val uri = URI(path)
        require(uri.scheme == "file") { "Invalid cache path" }
        return File(uri).canonicalFile.also { require(it.path.startsWith(root.path + File.separator)) { "Invalid cache path" } }
      }
      val source = checked(input)
      val destination = checked(output)
      val key = Base64.decode(encodedKey, Base64.NO_WRAP)
      require(key.size == 32 && source.length() in 1..(24L * 1024 * 1024 + if (decrypt) 28 else 0)) { "Invalid media cache input" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      val partial = File(destination.path + ".partial")
      destination.parentFile!!.mkdirs()
      try {
        source.inputStream().use { sourceStream ->
          val nonce = ByteArray(12)
          if (decrypt) require(sourceStream.read(nonce) == nonce.size) { "Invalid encrypted media" }
          else SecureRandom().nextBytes(nonce)
          cipher.init(if (decrypt) Cipher.DECRYPT_MODE else Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
          partial.outputStream().use { sink ->
            if (!decrypt) sink.write(nonce)
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val count = sourceStream.read(buffer)
              if (count < 0) break
              cipher.update(buffer, 0, count)?.let { sink.write(it) }
            }
            sink.write(cipher.doFinal())
            sink.fd.sync()
          }
        }
        check(partial.renameTo(destination)) { "Could not commit cached media" }
        return destination.length().toInt()
      } finally { partial.delete(); key.fill(0) }
  }
}
