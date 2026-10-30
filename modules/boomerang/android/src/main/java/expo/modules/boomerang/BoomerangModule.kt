package expo.modules.boomerang

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import androidx.media3.common.util.UnstableApi

// Camera Boomerangs use the existing frame encoder. Story composition is a
// separate, explicitly versioned capability with local-media validation.
@UnstableApi
class BoomerangModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Boomerang")

    // Enable only after the real encoded-audio, pixel and cancellation harness
    // passes. The candidate renderer does not imply installed-device support.
    Constants("storyVideoVersion" to 0, "storyAudioExportVersion" to 0)

    AsyncFunction("composeStory") { request: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("E_CONTEXT", "The application is no longer active.", null))
      } else {
        StoryVideoComposition.compose(context, request) { result ->
          result.fold({ value -> promise.resolve(value) }, { error ->
            promise.reject(CodedException("E_STORY_EXPORT", error.message ?: "Story export failed.", error))
          })
        }
      }
    }
    AsyncFunction("cancelStoryComposition") { id: String -> StoryVideoComposition.cancel(id) }
    OnActivityEntersBackground { StoryVideoComposition.cancelAll() }
    OnDestroy { StoryVideoComposition.cancelAll() }

    AsyncFunction("make") { input: String, output: String, loops: Int, promise: Promise ->
      promise.reject(CodedException("E_UNSUPPORTED", "Boomerang encoding is not available on Android yet", null))
    }
  }
}
