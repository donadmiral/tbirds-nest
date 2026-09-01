/**
 * useStoryAudioMix — plays a story's attached audio with a live
 * volume from the stored sound mix. Supersedes useStoryAudio in the
 * viewer only; the original hook stays untouched for anything else.
 */
import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

export function useStoryAudioMix(url: string | null, active: boolean, volume: number = 1) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const urlRef = useRef<string | null>(null);
  const volRef = useRef(volume);
  volRef.current = volume;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!url || !active || volRef.current <= 0.001) {
          if (soundRef.current) { try { await soundRef.current.stopAsync(); } catch {} try { await soundRef.current.unloadAsync(); } catch {} soundRef.current = null; urlRef.current = null; }
          return;
        }
        if (urlRef.current === url && soundRef.current) {
          try { await soundRef.current.setVolumeAsync(Math.max(0, Math.min(1, volRef.current))); } catch {}
          try { await soundRef.current.playAsync(); } catch {}
          return;
        }
        if (soundRef.current) { try { await soundRef.current.unloadAsync(); } catch {} soundRef.current = null; }
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
        const { sound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: true, isLooping: true, volume: Math.max(0, Math.min(1, volRef.current)) },
        );
        if (cancelled) { try { await sound.unloadAsync(); } catch {} return; }
        soundRef.current = sound;
        urlRef.current = url;
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [url, active]);

  // Live volume changes without reloading
  useEffect(() => {
    const s = soundRef.current;
    if (!s) return;
    s.setVolumeAsync(Math.max(0, Math.min(1, volume))).catch(() => {});
  }, [volume]);

  // Pause/resume with active flag
  useEffect(() => {
    const s = soundRef.current;
    if (!s) return;
    if (active && volRef.current > 0.001) { s.playAsync().catch(() => {}); }
    else { s.pauseAsync().catch(() => {}); }
  }, [active]);

  useEffect(() => () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) { s.stopAsync().catch(() => {}).finally(() => { s.unloadAsync().catch(() => {}); }); }
  }, []);
}
