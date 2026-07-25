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
import { AudioModule, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

export const MAX_VOICE_SECONDS = 300;

export type VoiceResult = { uri: string; durationSec: number };

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTick = () => {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
  };

  useEffect(() => () => { stopTick(); }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone access is needed to record a voice message.');
        return false;
      }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      await recorder.prepareToRecordAsync();
      recorder.record();

      setSeconds(0);
      setRecording(true);
      stopTick();
      tick.current = setInterval(() => {
        setSeconds(s => {
          const next = s + 1;
          if (next >= MAX_VOICE_SECONDS) stopTick();
          return next;
        });
      }, 1000);
      return true;
    } catch (e: any) {
      console.log('[VOICE] start failed:', e?.message);
      setError('Could not start recording.');
      setRecording(false);
      return false;
    }
  }, [recorder]);

  /** Stops and returns the file. Null if nothing usable was captured. */
  const stop = useCallback(async (): Promise<VoiceResult | null> => {
    stopTick();
    if (!recording) return null;
    setRecording(false);
    try {
      await recorder.stop();
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      const captured = seconds;
      setSeconds(0);
      // Under a second is almost always a mis-tap.
      if (!uri || captured < 1) return null;
      return { uri, durationSec: captured };
    } catch (e: any) {
      console.log('[VOICE] stop failed:', e?.message);
      setError('Could not save the recording.');
      return null;
    }
  }, [recorder, recording, seconds]);

  /** Stops and throws the recording away. */
  const cancel = useCallback(async () => {
    stopTick();
    if (!recording) return;
    setRecording(false);
    setSeconds(0);
    try {
      await recorder.stop();
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch { /* nothing to salvage */ }
  }, [recorder, recording]);

  return {
    recording,
    seconds,
    atLimit: seconds >= MAX_VOICE_SECONDS,
    metering: state?.metering ?? null,
    error,
    start,
    stop,
    cancel,
  };
}

export function formatVoiceDuration(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}