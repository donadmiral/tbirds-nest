import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { storyNativeEditingUnavailable, type StoryVideoRecipe } from '../../shared/storyVideoComposition';

const native = requireOptionalNativeModule('Boomerang') as any;
export const storyVideoCompositionAvailable = (Platform.OS === 'ios' || Platform.OS === 'android') && native?.storyVideoVersion === 1
  && typeof native?.composeStory === 'function' && typeof native?.cancelStoryComposition === 'function';
export const storyAudioCompositionAvailable = storyVideoCompositionAvailable && native?.storyAudioExportVersion === 1;
// The iOS version-one module includes its color-correct native view. Android's
// encoder has no corresponding preview view and must keep using Expo Video.
export const storyVideoPreviewAvailable = Platform.OS === 'ios' && storyVideoCompositionAvailable;
export type StoryVideoAudioLayer = { uri: string; start: number; duration: number; volume: number; loop: boolean };
export type StoryVideoCompositionRequest = { id: string; inputUri: string; inputKind?: 'video' | 'image'; outputUri: string; recipe: StoryVideoRecipe; backgroundUri?: string; layers: { uri: string; start: number; end: number }[]; audio?: StoryVideoAudioLayer };
export async function composeStoryVideo(request: StoryVideoCompositionRequest, signal?: AbortSignal): Promise<{ uri: string; duration: number; width: number; height: number; bytes: number }> {
  if (!storyVideoCompositionAvailable) throw new Error(storyNativeEditingUnavailable(Platform.OS, request.audio ? 'audio' : 'video'));
  if ((request.audio || request.inputKind === 'image') && !storyAudioCompositionAvailable) throw new Error(storyNativeEditingUnavailable(Platform.OS, 'audio'));
  if (request.audio && (!/^file:\/\//.test(request.audio.uri) || !Number.isFinite(request.audio.start) || request.audio.start < 0 || request.audio.start > 600
    || !Number.isFinite(request.audio.duration) || request.audio.duration < 1 || request.audio.duration > 600
    || !Number.isFinite(request.audio.volume) || request.audio.volume < 0 || request.audio.volume > 1 || typeof request.audio.loop !== 'boolean')) throw new Error('The story audio excerpt is invalid. Choose it again.');
  if (signal?.aborted) throw new Error('Video export was cancelled.');
  const cancel = () => { void native.cancelStoryComposition(request.id).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await native.composeStory(request);
    if (signal?.aborted) throw new Error('Video export was cancelled.');
    if (result?.uri !== request.outputUri || !Number.isFinite(result?.duration) || result.duration <= 0
      || !Number.isFinite(result.bytes) || result.bytes < 1024
      || !Number.isFinite(result.width) || result.width < 2 || !Number.isFinite(result.height) || result.height < 2) throw new Error('The exported video could not be verified.');
    if (request.audio && result.soundtrackMixed !== true) throw new Error('The exported soundtrack could not be verified.');
    return result;
  } finally { signal?.removeEventListener('abort', cancel); }
}
