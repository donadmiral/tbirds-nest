package expo.modules.securemedia

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class SecureMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SecureMedia")
    AsyncFunction("transform") { input: String, output: String, encodedKey: String, decrypt: Boolean ->
      val root = File(requireNotNull(appContext.reactContext).cacheDir, "pc-offline-v1").canonicalFile
      SecureMediaCrypto.transform(root, input, output, encodedKey, decrypt)
    }
  }
}
