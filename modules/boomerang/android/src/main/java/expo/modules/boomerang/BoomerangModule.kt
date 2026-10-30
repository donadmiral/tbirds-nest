package expo.modules.boomerang

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Native Android encoding is unavailable. The JavaScript bridge reports this
// capability accurately and uses its frame-encoder fallback where supported.
class BoomerangModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Boomerang")

    AsyncFunction("make") { input: String, output: String, loops: Int, promise: Promise ->
      promise.reject(CodedException("E_UNSUPPORTED", "Boomerang encoding is not available on Android yet", null))
    }
  }
}