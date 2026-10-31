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

    // The exact production renderer passed all 23 encoded-audio, pixel,
    // cancellation and bounded-input emulator cases. New binaries expose this
    // contract; physical-device acceptance remains a separate check.
    Constants("storyVideoVersion" to 1, "storyAudioExportVersion" to 1, "memoryMovieVersion" to 0)

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
    AsyncFunction("composeMemoryMovie") { request: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject(CodedException("E_CONTEXT", "The application is no longer active.", null))
      else MemoryMovieComposition.compose(context, request) { result ->
        result.fold({ promise.resolve(it) }, { promise.reject(CodedException("E_MEMORY_EXPORT", it.message ?: "Memory movie export failed.", it)) })
      }
    }
    AsyncFunction("prepareMemoryMovieImage") { request: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) promise.reject(CodedException("E_CONTEXT", "The application is no longer active.", null))
      else MemoryMovieComposition.prepareImage(context, request) { result ->
        result.fold({ promise.resolve(it) }, { promise.reject(CodedException("E_MEMORY_IMAGE", it.message ?: "The photo could not be prepared.", it)) })
      }
    }
    AsyncFunction("cancelMemoryMovie") { id: String -> MemoryMovieComposition.cancel(id) }
    OnActivityEntersBackground { StoryVideoComposition.cancelAll(); MemoryMovieComposition.cancelAll() }
    OnDestroy { StoryVideoComposition.cancelAll(); MemoryMovieComposition.cancelAll() }

    AsyncFunction("make") { input: String, output: String, loops: Int, promise: Promise ->
      promise.reject(CodedException("E_UNSUPPORTED", "Boomerang encoding is not available on Android yet", null))
    }
  }
}
