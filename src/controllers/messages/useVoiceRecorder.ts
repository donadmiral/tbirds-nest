/**
 * useVoiceRecorder
 *
 * Recording for chat voice notes, on expo-audio rather than expo-av, which is
 * deprecated in SDK 54.
 *
 * The awkward parts this handles so the UI does not have to:
 *   permission asked on first attempt rather than on mount
 *   a hard cap so a pocket recording cannot become a twenty minute upload
 *   duration ticking while recording, for the timer
 *   cancel that discards the recording instead of leaving it half-made
 *
 * It records and returns a file. Uploading and sending belong to the caller,
 * because a failed send should not lose the recording.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioModule, AudioQuality, IOSOutputFormat, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

export const MAX_VOICE_SECONDS = 300;

/**
 * Tuned for speech, not for music.
 *
 * Mono on purpose: a phone has one microphone, so stereo writes the identical
 * signal into two channels and doubles the file for no audible difference.
 *
 * 96 kbps AAC at 48 kHz is roughly four times what WhatsApp uses for voice
 * notes and well past transparent for a human voice, while a five minute
 * message still lands near 3.6 MB. That matters where mobile data is
 * expensive: a recording nobody can afford to receive is not high quality.
 */
export const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 48000,
  numberOfChannels: 1,
  bitRate: 96000,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 96000,
  },
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MAX,
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 96000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
} as const;

export type VoiceResult = { uri: string; durationSec: number };

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS as any);
  const state = useAudioRecorderState(recorder);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false), running = useRef(false), generation = useRef(0), live = useRef(true);
  const began = useRef(0), completed = useRef<VoiceResult | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTick = () => { if (tick.current) clearInterval(tick.current); tick.current = null; };
  const resetMode = () => AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  useEffect(() => { live.current = true; return () => {
    live.current = false; ++generation.current; stopTick();
    if (running.current && !busy.current) { busy.current = true; running.current = false; void recorder.stop().catch(() => {}).finally(async () => { await resetMode(); busy.current = false; }); }
  }; }, [recorder]);
  const start = useCallback(async () => {
    if (busy.current || running.current || completed.current) return false;
    busy.current = true; const operation = ++generation.current;
    const current = () => live.current && generation.current === operation;
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!current()) return false;
      if (!permission.granted) { setError('Microphone access is needed to record a voice message.'); return false; }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!current()) { await resetMode(); return false; }
      await recorder.prepareToRecordAsync();
      if (!current()) { await recorder.stop().catch(() => {}); await resetMode(); return false; }
      recorder.record({ forDuration: MAX_VOICE_SECONDS });
      running.current = true; began.current = Date.now(); setSeconds(0); setRecording(true);
      stopTick(); tick.current = setInterval(() => {
        const elapsed = Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - began.current) / 1000));
        if (live.current) setSeconds(elapsed);
        if (elapsed >= MAX_VOICE_SECONDS) stopTick();
      }, 250);
      return true;
    } catch {
      running.current = false; await resetMode();
      if (current()) { setError('Could not start recording.'); setRecording(false); }
      return false;
    } finally { busy.current = false; }
  }, [recorder]);
  const stop = useCallback(async (): Promise<VoiceResult | null> => {
    if (completed.current) return completed.current;
    if (!running.current || busy.current) return null;
    busy.current = true; running.current = false; stopTick();
    const operation = generation.current;
    try {
      // A native duration limit can finish before this user action.
      try { await recorder.stop(); } catch { if (!recorder.uri) throw Error('No recording'); }
      await resetMode();
      if (!live.current || generation.current !== operation) return null;
      const durationSec = Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - began.current) / 1000));
      const saved = recorder.uri && durationSec >= 1 ? { uri: recorder.uri, durationSec } : null;
      completed.current = saved; setResult(saved); setRecording(false); setSeconds(durationSec);
      return saved;
    } catch { if (live.current && generation.current === operation) { setRecording(false); setError('Could not save the recording.'); } return null; }
    finally { busy.current = false; }
  }, [recorder]);
  const clearResult = useCallback(() => { completed.current = null; setResult(null); setSeconds(0); }, []);
  const cancel = useCallback(async () => {
    ++generation.current; stopTick(); completed.current = null;
    const wasRunning = running.current && !busy.current; running.current = false;
    if (live.current) { setRecording(false); setResult(null); setSeconds(0); }
    if (wasRunning) { busy.current = true; try { await recorder.stop().catch(() => {}); await resetMode(); } finally { busy.current = false; } }
  }, [recorder]);
  return { recording, seconds, result, clearResult, atLimit: seconds >= MAX_VOICE_SECONDS,
    metering: state?.metering ?? null, error, start, stop, cancel };
}

export function formatVoiceDuration(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}