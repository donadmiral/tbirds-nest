import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { StoryVideoRecipe } from '../../shared/storyVideoComposition';

const native = requireOptionalNativeModule('Boomerang') as any;
export const storyVideoCompositionAvailable = Platform.OS === 'ios' && native?.storyVideoVersion === 1 && typeof native?.composeStory === 'function';
export const storyAudioCompositionAvailable = storyVideoCompositionAvailable && native?.storyAudioExportVersion === 1;
export type StoryVideoAudioLayer = { uri: string; start: number; duration: number; volume: number; loop: boolean };
export type StoryVideoCompositionRequest = { id: string; inputUri: string; inputKind?: 'video' | 'image'; outputUri: string; recipe: StoryVideoRecipe; backgroundUri?: string; layers: { uri: string; start: number; end: number }[]; audio?: StoryVideoAudioLayer };
export async function composeStoryVideo(request: StoryVideoCompositionRequest, signal?: AbortSignal): Promise<{ uri: string; duration: number; width: number; height: number; bytes: number }> {
  if (!storyVideoCompositionAvailable) throw new Error('Edited video export needs the new iPhone build. Your draft is kept.');
  if ((request.audio || request.inputKind === 'image') && !storyAudioCompositionAvailable) throw new Error('Added audio export needs the new iPhone build. Your soundtrack and draft are kept.');
  if (request.audio && (!/^file:\/\//.test(request.audio.uri) || !Number.isFinite(request.audio.start) || request.audio.start < 0 || request.audio.start > 600
    || !Number.isFinite(request.audio.duration) || request.audio.duration < 1 || request.audio.duration > 600
    || !Number.isFinite(request.audio.volume) || request.audio.volume < 0 || request.audio.volume > 1 || typeof request.audio.loop !== 'boolean')) throw new Error('The story audio excerpt is invalid. Choose it again.');
  if (signal?.aborted) throw new Error('Video export was cancelled.');
  const cancel = () => { void native.cancelStoryComposition(request.id).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await native.composeStory(request);
    if (signal?.aborted) throw new Error('Video export was cancelled.');
    if (result?.uri !== request.outputUri || !Number.isFinite(result?.duration) || result.duration <= 0 || result.bytes < 1024) throw new Error('The exported video could not be verified.');
    if (request.audio && result.soundtrackMixed !== true) throw new Error('The exported soundtrack could not be verified.');
    return result;
  } finally { signal?.removeEventListener('abort', cancel); }
}
