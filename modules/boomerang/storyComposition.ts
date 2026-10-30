import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { StoryVideoRecipe } from '../../shared/storyVideoComposition';

const native = requireOptionalNativeModule('Boomerang') as any;
export const storyVideoCompositionAvailable = Platform.OS === 'ios' && native?.storyVideoVersion === 1 && typeof native?.composeStory === 'function';
export type StoryVideoCompositionRequest = { id: string; inputUri: string; outputUri: string; recipe: StoryVideoRecipe; backgroundUri?: string; layers: { uri: string; start: number; end: number }[] };
export async function composeStoryVideo(request: StoryVideoCompositionRequest, signal?: AbortSignal): Promise<{ uri: string; duration: number; width: number; height: number; bytes: number }> {
  if (!storyVideoCompositionAvailable) throw new Error('Edited video export needs the new iPhone build. Your draft is kept.');
  if (signal?.aborted) throw new Error('Video export was cancelled.');
  const cancel = () => { void native.cancelStoryComposition(request.id).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await native.composeStory(request);
    if (signal?.aborted) throw new Error('Video export was cancelled.');
    if (result?.uri !== request.outputUri || !Number.isFinite(result?.duration) || result.duration <= 0 || result.bytes < 1024) throw new Error('The exported video could not be verified.');
    return result;
  } finally { signal?.removeEventListener('abort', cancel); }
}
