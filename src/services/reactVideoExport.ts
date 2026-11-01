import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';
import { Image } from 'react-native';
import { composeReactVideo } from '../../modules/boomerang/reactComposition';
import { reactLocalFileUri, reactRects, trimReactTimeline, type ReactExport, type ReactLayout, type ReactRect, type ReactSegment, type ReactSource } from '../../shared/reactVideoComposition';
import { assertReactSourceAccess, prepareReactPostSource } from './reactSourceAccess';

const cancelled = () => new Error('Reaction preparation was cancelled.');
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw cancelled(); };
export const discardReactFile = async (uri?: string | null) => {
  if (uri) { try { await FileSystem.deleteAsync(reactLocalFileUri(uri), { idempotent: true }); } catch {} }
};

/** A take retains its own private local source until export or discard. Remote
 * post authorization is refreshed before download and again before publishing. */
export async function stageReactSource(source: ReactSource, signal?: AbortSignal, renderedTextUri?: string): Promise<{ source: ReactSource; uri: string; dispose: () => Promise<void> }> {
  check(signal);
  const fresh = source.postId ? await prepareReactPostSource(source, signal) : source;
  check(signal);
  if (fresh.isPrivate || fresh.allowReact === false) throw new Error('This source is not available for React.');
  const originalUri = fresh.uri.startsWith('/') ? reactLocalFileUri(fresh.uri) : fresh.uri;
  if (!fresh.postId && !/^(file|content):\/\//.test(originalUri)) throw new Error('Choose an original photo or video from this device.');
  if (!FileSystem.cacheDirectory) throw new Error('Temporary video storage is unavailable.');
  const limit = fresh.kind === 'video' ? 512 * 1024 * 1024 : 32 * 1024 * 1024;
  const staged = `${FileSystem.cacheDirectory}pc-react-source-${Crypto.randomUUID()}.${fresh.kind === 'video' ? 'mp4' : 'image'}`;
  const files = new Set<string>([staged]);
  let download: ReturnType<typeof FileSystem.createDownloadResumable> | null = null;
  let expired = false, tooLarge = false;
  const abort = () => { void download?.cancelAsync().catch(() => {}); };
  const timeout = setTimeout(() => { expired = true; abort(); }, 120_000);
  signal?.addEventListener('abort', abort, { once: true });
  const dispose = async () => { await Promise.all([...files].map(discardReactFile)); };
  try {
    if (/^https:\/\//.test(originalUri) && fresh.postId) {
      download = FileSystem.createDownloadResumable(originalUri, staged, { cache: false, sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, progress => {
        if (progress.totalBytesWritten > limit || progress.totalBytesExpectedToWrite > limit) { tooLarge = true; abort(); }
      });
      const result = await download.downloadAsync();
      check(signal);
      if (expired) throw new Error('The reaction source took too long to download. Try again.');
      if (tooLarge) throw new Error('Choose a video under 512 MB or a photo under 32 MB.');
      if (!result || result.status !== 200 || result.uri !== staged) throw new Error('The reaction source could not be prepared.');
    } else {
      const input = fresh.postId && fresh.text && renderedTextUri ? reactLocalFileUri(renderedTextUri) : originalUri;
      if (!/^(file|content):\/\//.test(input)) throw new Error('The original post could not be prepared as a source.');
      await FileSystem.copyAsync({ from: input, to: staged });
    }
    check(signal);
    if (expired) throw new Error('The reaction source took too long to prepare. Try again.');
    const info = await FileSystem.getInfoAsync(staged);
    if (!info.exists || info.isDirectory || !info.size || info.size > limit) throw new Error('The source is empty or exceeds the reaction size limit.');
    let uri = staged;
    if (fresh.kind === 'image') {
      const dimensions = await Image.getSize(staged);
      if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width < 1 || dimensions.height < 1
        || dimensions.width > 50000 || dimensions.height > 50000 || dimensions.width * dimensions.height > 200_000_000) throw new Error('The source photo is too large to prepare. Choose a smaller copy.');
      check(signal);
      const ratio = Math.min(1, 1920 / dimensions.width, 1920 / dimensions.height);
      const photo = await ImageManipulator.manipulateAsync(staged, [{ resize: { width: Math.max(1, Math.round(dimensions.width * ratio)), height: Math.max(1, Math.round(dimensions.height * ratio)) } }], { compress: .94, format: ImageManipulator.SaveFormat.JPEG });
      const photoUri = reactLocalFileUri(photo.uri);
      files.add(photoUri); check(signal); uri = photoUri;
    }
    return { source: fresh, uri, dispose };
  } catch (error) { await dispose(); throw error; }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function reactVideoDuration(uri: string, signal?: AbortSignal): Promise<number> {
  check(signal); const player = createVideoPlayer(uri);
  let timer: ReturnType<typeof setTimeout> | undefined, subscription: ReturnType<typeof player.addListener> | undefined;
  let onAbort = () => {};
  try {
    return await new Promise<number>((resolve, reject) => {
      const ready = () => {
        if (Number.isFinite(player.duration) && player.duration > 0) resolve(player.duration);
        else if (player.status === 'error') reject(new Error('The recorded video could not be read.'));
      };
      subscription = player.addListener('statusChange', ready);
      timer = setTimeout(() => reject(new Error('The video duration could not be read.')), 15_000);
      onAbort = () => reject(cancelled()); signal?.addEventListener('abort', onAbort, { once: true }); ready();
    });
  } finally { if (timer) clearTimeout(timer); subscription?.remove(); signal?.removeEventListener('abort', onAbort); player.release(); }
}

export async function exportReactTake(input: {
  source: ReactSource; sourceUri: string; cameraUri: string; segments: ReactSegment[];
  trimStart: number; trimEnd: number; layout: ReactLayout; faceRect: ReactRect; sourceZoom: number;
  voiceVolume: number; overlayUri?: string;
}, signal?: AbortSignal): Promise<ReactExport> {
  check(signal); await assertReactSourceAccess(input.source); check(signal);
  if (!FileSystem.cacheDirectory) throw new Error('Temporary video storage is unavailable.');
  const id = Crypto.randomUUID(), outputUri = `${FileSystem.cacheDirectory}pc-react-export-${id}.mp4`;
  const rects = reactRects(input.layout, input.faceRect);
  try {
    const result = await composeReactVideo({ id, sourceUri: reactLocalFileUri(input.sourceUri), sourceKind: input.source.kind, cameraUri: reactLocalFileUri(input.cameraUri), outputUri,
      width: 720, height: 1280, cameraStart: input.trimStart, duration: input.trimEnd - input.trimStart,
      segments: trimReactTimeline(input.segments, input.trimStart, input.trimEnd), sourceRect: rects.source, faceRect: rects.face,
      voiceVolume: input.voiceVolume, sourceZoom: input.sourceZoom, cutout: input.layout === 'cutout', ...(input.overlayUri ? { overlayUri: reactLocalFileUri(input.overlayUri) } : {}),
    }, signal);
    check(signal); await assertReactSourceAccess(input.source); check(signal);
    return { uri: result.uri, mimeType: 'video/mp4', width: 720, height: 1280, duration: result.duration,
      source: { ...(input.source.postId ? { postId: input.source.postId } : {}), ...(input.source.creatorId ? { creatorId: input.source.creatorId } : {}),
        ...(input.source.creatorName ? { creatorName: input.source.creatorName } : {}), ...(input.source.attributionText ? { attributionText: input.source.attributionText } : {}),
        ...(input.source.sourceMediaId ? { sourceMediaId: input.source.sourceMediaId } : {}), ...(input.source.sourceRevision ? { sourceRevision: input.source.sourceRevision } : {}) } };
  } catch (error) { await discardReactFile(outputUri); throw error; }
}
