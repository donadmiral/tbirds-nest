import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { isMediaDeliveryCapability } from '../../shared/contentMedia';
import { authorizeLibraryAudioExport } from '../../shared/musicExportAuthorization';
import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../shared/originalAudio';
import type { StoryVideoAudioLayer } from '../../modules/boomerang/storyComposition';
import type { StoryAudioDraft } from './storiesService';
import { hydrateSoundMedia } from './contentMedia';
import { supabase, SUPABASE_URL } from './supabase';

export type PreparedStoryExportAudio = { layer: StoryVideoAudioLayer; assertRights(): Promise<void>; release(): Promise<void> };

async function step<T>(work: PromiseLike<T>, signal: AbortSignal, timeout = 20000, cancel?: () => void): Promise<T> {
  if (signal.aborted) throw new Error('Video export was cancelled.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      stop = () => { cancel?.(); reject(new Error('Video export was cancelled.')); };
      signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => { cancel?.(); reject(new Error('Preparing the soundtrack took too long. Please retry.')); }, timeout);
      if (signal.aborted) stop();
    })]);
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', stop); }
}

/** Library audio requires current server export rights. Local voiceover requires
 * its saved publication attestation. Staged files never become draft URLs. */
export async function prepareStoryExportAudio(audio: StoryAudioDraft, volume: number, owner: string | null,
  signal: AbortSignal, assertCurrent: () => void, use: 'story'|'memory_album' = 'story'): Promise<PreparedStoryExportAudio> {
  if (!owner || !Number.isFinite(volume) || volume < 0 || volume > 1 || !FileSystem.cacheDirectory) throw new Error('This soundtrack cannot be prepared for export.');
  const selection = { ...audio };
  let changed = false, released = false;
  const files: string[] = [];
  let download: ReturnType<typeof FileSystem.createDownloadResumable> | null = null;
  const watcher = supabase.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_OUT' || session?.user.id !== owner) changed = true; });
  const ensure = () => { assertCurrent(); if (signal.aborted) throw new Error('Video export was cancelled.'); if (changed || released) throw new Error('The account changed. Reopen the story to export its audio.'); };
  const removeFiles = async () => { await Promise.all(files.map(uri => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}))); };
  const cancelDownload = () => { void download?.cancelAsync().catch(() => {}); };
  const release = async () => {
    if (!released) { released = true; watcher.data.subscription.unsubscribe(); cancelDownload(); }
    await removeFiles();
  };
  const session = async () => {
    ensure();
    const { data, error } = await step(supabase.auth.getSession(), signal);
    ensure();
    if (error || data.session?.user.id !== owner) throw new Error('Return to the account that owns this audio.');
  };
  const rights = async () => {
    await session();
    if (selection.kind === 'voiceover') {
      if (!selection.rightsAttested || !selection.localUri || !/^file:\/\//.test(selection.localUri)) throw new Error('Use an original recording with confirmed publication rights.');
      return null;
    }
    if (selection.kind !== 'sound' || !selection.soundId) throw new Error('Choose verified audio from your library.');
    const track = await step(authorizeLibraryAudioExport(supabase, { soundId: selection.soundId, startSec: selection.startSec ?? 0, durationSec: selection.durationSec ?? NaN }, use), signal);
    ensure();
    return track;
  };
  try {
    const track = await rights();
    const base = FileSystem.cacheDirectory + 'pc-story-audio-' + Crypto.randomUUID();
    let staged = base + '.tmp'; files.push(staged);
    if (track) {
      const [safe] = await step(hydrateSoundMedia([track]), signal); ensure();
      if (!safe?.url || !isMediaDeliveryCapability(safe.url, SUPABASE_URL!)) throw new Error('Private audio delivery is unavailable. Please retry.');
      let oversized = false;
      download = FileSystem.createDownloadResumable(safe.url, staged, { cache: false, sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, progress => {
        if (progress.totalBytesWritten > ORIGINAL_AUDIO_MAX_BYTES || progress.totalBytesExpectedToWrite > ORIGINAL_AUDIO_MAX_BYTES) { oversized = true; cancelDownload(); }
      });
      const pending = download.downloadAsync();
      void pending.then(() => { if (released) return removeFiles(); }, () => { if (released) return removeFiles(); });
      const result = await step(pending, signal, 120000, cancelDownload); ensure();
      if (oversized || !result || result.status !== 200 || result.uri !== staged) throw new Error('This original audio could not be downloaded for export.');
    } else {
      const original = await step(FileSystem.getInfoAsync(selection.localUri!), signal); ensure();
      if (!original.exists || original.isDirectory || original.size > ORIGINAL_AUDIO_MAX_BYTES) throw new Error('The voiceover recording is missing or too large.');
      const pending = FileSystem.copyAsync({ from: selection.localUri!, to: staged });
      void pending.then(() => { if (released) return removeFiles(); }, () => {});
      await step(pending, signal); ensure();
    }
    const stat = await step(FileSystem.getInfoAsync(staged), signal); ensure();
    if (!stat.exists || stat.isDirectory || stat.size > ORIGINAL_AUDIO_MAX_BYTES) throw new Error('The soundtrack file is missing or too large.');
    const encoded = await step(FileSystem.readAsStringAsync(staged, { encoding: FileSystem.EncodingType.Base64 }), signal); ensure();
    const info = inspectOriginalAudio(new Uint8Array(decode(encoded)));
    const start = selection.startSec ?? 0, duration = selection.durationSec ?? info.durationSec;
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration < 1 || start + duration > info.durationSec + .01
      || track && (!Number.isFinite(track.max_excerpt_sec) || duration > track.max_excerpt_sec || start + duration > track.duration_sec + .01)) throw new Error('The saved audio excerpt exceeds this recording. Choose it again.');
    const verified = base + '.' + info.extension; files.push(verified);
    const moving = FileSystem.moveAsync({ from: staged, to: verified });
    void moving.then(() => { if (released) return removeFiles(); }, () => {});
    await step(moving, signal); staged = verified; ensure();
    await rights(); ensure();
    return { layer: { uri: staged, start, duration, volume, loop: selection.kind === 'sound' }, assertRights: async () => { await rights(); ensure(); }, release };
  } catch (error) { await release(); throw error; }
}
