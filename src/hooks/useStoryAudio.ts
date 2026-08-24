/**
 * useStoryAudio - plays a story's attached audio (voiceover or sound)
 * alongside image/text stories in the viewer. Loads a fresh Audio.Sound
 * when the url changes, follows the viewer's pause state, and unloads
 * on unmount. Video stories carry their own audio track, so callers
 * pass null for them.
 */
import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

export function useStoryAudio(url: string | null, playing: boolean) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (soundRef.current) {
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }
      if (!url) return;
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: false });
        if (cancelled) { try { await sound.unloadAsync(); } catch {} return; }
        soundRef.current = sound;
        if (playingRef.current) { try { await sound.playAsync(); } catch {} }
      } catch (e: any) {
        console.log('[useStoryAudio] load error:', e?.message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const s = soundRef.current;
    if (!s) return;
    if (playing) { s.playAsync().catch(() => {}); } else { s.pauseAsync().catch(() => {}); }
  }, [playing]);

  useEffect(() => () => {
    if (soundRef.current) { soundRef.current.unloadAsync().catch(() => {}); soundRef.current = null; }
  }, []);
}