import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { validateReactRequest, validateReactResult, type ReactNativeRequest, type ReactNativeResult } from '../../shared/reactVideoComposition';

type ReactNativeModule = {
  reactVideoVersion?: number; reactCutoutVersion?: number;
  composeReactVideo?: (request: ReactNativeRequest) => Promise<unknown>;
  cancelReactVideo?: (id: string) => Promise<void>;
};
const native = requireOptionalNativeModule<ReactNativeModule>('Boomerang');
export const reactVideoCompositionAvailable = (Platform.OS === 'ios' || Platform.OS === 'android') && native?.reactVideoVersion === 1 && typeof native.composeReactVideo === 'function' && typeof native.cancelReactVideo === 'function';
export const reactCutoutAvailable = reactVideoCompositionAvailable && native?.reactCutoutVersion === 1;
export async function composeReactVideo(request: ReactNativeRequest, signal?: AbortSignal): Promise<ReactNativeResult> {
  if (!reactVideoCompositionAvailable) throw new Error('React needs the new app build to combine the source, face camera, and voice.');
  if (request.cutout && !reactCutoutAvailable) throw new Error('Person cutout is unavailable in this app build. Choose picture in picture or split screen.');
  validateReactRequest(request);
  if (signal?.aborted) throw new Error('Reaction export was cancelled.');
  const cancel = () => { void native!.cancelReactVideo!(request.id).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Explicitly omit absent options: the Android generic map bridge cannot
    // represent nested undefined values reliably.
    const payload: ReactNativeRequest = { ...request, segments: request.segments.map(value => ({ ...value })), sourceRect: { ...request.sourceRect }, faceRect: { ...request.faceRect } };
    if (!request.overlayUri) delete payload.overlayUri;
    const result = await native!.composeReactVideo!(payload);
    if (signal?.aborted) throw new Error('Reaction export was cancelled.');
    return validateReactResult(request, result);
  } finally { signal?.removeEventListener('abort', cancel); }
}
