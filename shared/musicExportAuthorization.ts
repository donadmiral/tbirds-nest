import { audioLibraryCapabilities, librarySourceAvailable } from './originalAudioAvailability';
import { readSoundtrack, type SoundtrackSelection, type SoundtrackTrack, type SoundtrackUse } from './soundtrack';
import { soundtrackRead } from './soundtrackPicker';

type ExportSelection = Pick<SoundtrackSelection, 'soundId' | 'startSec' | 'durationSec'>;
type ExportClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message?: string; code?: string } | null;
  }>;
};

/** Export authority is distinct from playback or permission to reuse a sound.
 * Call again before offering a download or saving to Photos. The caller owns
 * cancellation and the account/draft lifecycle around this bounded operation.
 */
export async function authorizeLibraryAudioExport(client: ExportClient, selection: ExportSelection,
  use: SoundtrackUse): Promise<SoundtrackTrack> {
  if (!readSoundtrack({ ...selection, volume: 1, originalVolume: 1 })
    || !['story', 'post', 'memory_album'].includes(use)) {
    throw new Error('The saved audio excerpt is invalid. Choose it again.');
  }
  const capabilities = await audioLibraryCapabilities(client);
  if (!capabilities) throw new Error('Audio export is not available in this app environment yet.');
  const name = capabilities.version === 2 ? 'authorize_music_audio_export' : 'authorize_original_audio_export';
  const { data, error } = await soundtrackRead(client.rpc(name, { p_sound_id: selection.soundId, p_use: use }));
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('This sound does not have current export permission. Choose an original you own or another track.');
  }
  const track = data as SoundtrackTrack;
  if (track.id !== selection.soundId || !librarySourceAvailable(track.source, capabilities)
    || typeof track.title !== 'string' || typeof track.url !== 'string' || !track.url
    || !Number.isFinite(track.duration_sec) || track.duration_sec < 1 || track.duration_sec > 600
    || !Number.isFinite(track.max_excerpt_sec) || track.max_excerpt_sec < 1
    || selection.durationSec > track.max_excerpt_sec
    || selection.startSec + selection.durationSec > track.duration_sec + .01) {
    throw new Error('This audio excerpt no longer has valid export permission. Choose it again.');
  }
  return track;
}
