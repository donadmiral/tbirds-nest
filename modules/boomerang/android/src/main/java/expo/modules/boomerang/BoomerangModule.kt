package expo.modules.boomerang

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android reports itself unavailable for now; the JavaScript keeps the straight
// clip. The MediaCodec encoder lands here next.
class BoomerangModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Boomerang")

    AsyncFunction("make") { input: String, output: String, loops: Int, promise: Promise ->
      promise.reject(CodedException("E_UNSUPPORTED", "Boomerang encoding is not available on Android yet", null))
    }
  }
}