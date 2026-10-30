/** Audio chosen here stays in this browser and is used only in a downloaded movie. */
export type LocalExportAudio = { file: File; duration: number; volume: number; startSec: number; loop: boolean };

export function exportCancelled(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Video export was cancelled.');
}

export async function exportStep<T>(work: Promise<T>, signal: AbortSignal, message: string, timeout = 20000): Promise<T> {
  exportCancelled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      cancel = () => { try { exportCancelled(signal); } catch (error) { reject(error); } };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })]);
  } finally { clearTimeout(timer); if (cancel) signal.removeEventListener('abort', cancel); }
}

function validateAudioFile(file: File) {
  const type = file.type.split(';')[0].toLowerCase();
  if (!['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac'].includes(type)) throw new Error('Choose an MP3, M4A, AAC, WAV, Ogg, WebM or FLAC audio file.');
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('Choose a non-empty audio file under 30 MB.');
}

export async function inspectExportAudio(file: File, signal: AbortSignal): Promise<LocalExportAudio> {
  validateAudioFile(file);
  const url = URL.createObjectURL(file), audio = document.createElement('audio');
  try {
    await exportStep(new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(); audio.onerror = () => reject(new Error('This browser cannot read that audio file. Try an MP3 or M4A recording.'));
      audio.preload = 'metadata'; audio.src = url; audio.load();
    }), signal, 'The audio file took too long to read. Choose it again.');
    if (!Number.isFinite(audio.duration) || audio.duration < .1 || audio.duration > 180) throw new Error('Choose an audio excerpt between a tenth of a second and three minutes. You can loop it across the movie.');
    return { file, duration: audio.duration, volume: .7, startSec: 0, loop: false };
  } finally { audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
}

/** Decode once, before recording. A failed or unsupported audio track fails the whole export. */
export async function decodeExportAudio(context: AudioContext, selection: LocalExportAudio, signal: AbortSignal) {
  validateAudioFile(selection.file);
  const data = await exportStep(selection.file.arrayBuffer(), signal, 'The selected audio could not be read.');
  let buffer: AudioBuffer;
  try { buffer = await exportStep(context.decodeAudioData(data), signal, 'The selected audio could not be decoded. Try an MP3 or M4A recording.'); }
  catch { exportCancelled(signal); throw new Error('The selected audio could not be decoded. Try an MP3 or M4A recording.'); }
  if (!Number.isFinite(buffer.duration) || buffer.duration < .1 || buffer.duration > 180 || buffer.numberOfChannels > 2) throw new Error('Use a mono or stereo audio excerpt of three minutes or less.');
  if (!Number.isFinite(selection.startSec) || selection.startSec < 0 || selection.startSec > buffer.duration - .05) throw new Error('Choose an audio start point before the end of the recording.');
  if (!Number.isFinite(selection.volume) || selection.volume < 0 || selection.volume > 1) throw new Error('Choose an audio level between 0 and 100%.');
  exportCancelled(signal);
  return buffer;
}

export function playExportAudio(context: AudioContext, destination: AudioNode, buffer: AudioBuffer, selection: Pick<LocalExportAudio, 'volume' | 'startSec' | 'loop'>) {
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer; source.loop = selection.loop; source.loopStart = selection.startSec; source.loopEnd = buffer.duration;
  gain.gain.value = selection.volume; source.connect(gain); gain.connect(destination); source.start(0, selection.startSec);
  return () => { try { source.stop(); } catch { /* It may have reached its end. */ } source.disconnect(); gain.disconnect(); };
}
