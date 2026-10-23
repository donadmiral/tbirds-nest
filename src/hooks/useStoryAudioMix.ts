/** Attached original/reusable audio; pause retains position, URL changes unload. */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';

export function useStoryAudioMix(url: string | null, active: boolean, volume = 1) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const playback = useRef({ active, volume, foreground: AppState.currentState === 'active' });
  playback.current.active = active; playback.current.volume = volume;
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const generation = useRef(0), queue = useRef(Promise.resolve());
  const sync = () => {
    const sound = soundRef.current, current = generation.current;
    if (!sound) return;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (sound !== soundRef.current || current !== generation.current) return;
      const state = playback.current;
      await sound.setVolumeAsync(Number.isFinite(state.volume) ? Math.max(0, Math.min(1, state.volume)) : 1);
      if (sound !== soundRef.current || current !== generation.current) return;
      // Muting never restarts the soundtrack, so unmuting stays on the timeline.
      if (playback.current.active && playback.current.foreground) await sound.playAsync();
      else await sound.pauseAsync();
    }).catch(() => { if (sound === soundRef.current && current === generation.current) setError('Sound could not play. Please retry.'); });
  };
  useEffect(() => {
    const current = ++generation.current; let owned: Audio.Sound | null = null; setError(null);
    if (url) void (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        if (current !== generation.current) return;
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: false, isLooping: true, volume: 0 });
        owned = sound;
        if (current !== generation.current) { await sound.unloadAsync(); return; }
        soundRef.current = sound; sync();
      } catch { if (current === generation.current) setError('Sound could not load. Please retry.'); }
    })();
    return () => { generation.current++; if (soundRef.current === owned) soundRef.current = null; if (owned) void owned.unloadAsync().catch(() => {}); };
  }, [url, attempt]);
  useEffect(() => { sync(); }, [active, volume]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { playback.current.foreground = state === 'active'; sync(); });
    return () => subscription.remove();
  }, []);
  return { error, retry: () => setAttempt(n => n + 1) };
}
