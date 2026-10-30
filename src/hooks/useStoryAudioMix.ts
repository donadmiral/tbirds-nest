/** Attached original/reusable audio; pause retains position, URL changes unload. */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';
import { useCallContext } from '../contexts/CallContext';
import { getSoundtrack } from '../services/soundtrackService';

export function useStoryAudioMix(url: string | null, active: boolean, volume = 1, durationSec?: number | null, startSec = 0, soundId?: string | null) {
  const { callState } = useCallContext();
  const soundRef = useRef<Audio.Sound | null>(null);
  const playback = useRef({ active, volume, durationSec, startSec, foreground: AppState.currentState === 'active' });
  playback.current.active = active && callState === 'idle'; playback.current.volume = volume; playback.current.durationSec = durationSec; playback.current.startSec = startSec;
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const generation = useRef(0), queue = useRef(Promise.resolve()), rightsRevoked=useRef(false);
  const sync = () => {
    const sound = soundRef.current, current = generation.current;
    if (!sound) return;
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (sound !== soundRef.current || current !== generation.current) return;
      const state = playback.current;
      await sound.setVolumeAsync(Number.isFinite(state.volume) ? Math.max(0, Math.min(1, state.volume)) : 1);
      if (sound !== soundRef.current || current !== generation.current) return;
      // Muting never restarts the soundtrack, so unmuting stays on the timeline.
      if (!rightsRevoked.current && playback.current.active && playback.current.foreground) { await sound.playAsync(); if (rightsRevoked.current || !playback.current.active || !playback.current.foreground) await sound.pauseAsync(); }
      else await sound.pauseAsync();
    }).catch(() => { if (sound === soundRef.current && current === generation.current) setError('Sound could not play. Please retry.'); });
  };
  useEffect(() => {
    const current = ++generation.current; let owned: Audio.Sound | null = null; setError(null);rightsRevoked.current=false;
    if (url) void (async () => {
      try {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        if (current !== generation.current) return;
        let authorizedUrl=url;
        if(soundId){const track=await getSoundtrack(soundId,'story');if(current!==generation.current)return;const start=Math.max(0,playback.current.startSec),duration=Math.min(30,Math.max(1,playback.current.durationSec||30));if(start+duration>track.duration_sec||duration>track.max_excerpt_sec)throw new Error('The selected excerpt is unavailable.');authorizedUrl=track.url;}
        const { sound } = await Audio.Sound.createAsync({ uri: authorizedUrl }, { shouldPlay: false, isLooping: true, positionMillis: Math.max(0,playback.current.startSec)*1000, volume: 0, progressUpdateIntervalMillis: 100 });
        owned = sound;
        if (current !== generation.current) { await sound.unloadAsync(); return; }
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate(status => {
          if (current !== generation.current || sound !== soundRef.current || !status.isLoaded) return;
          const end = Math.min(30, Math.max(1, playback.current.durationSec || 30));
          if (status.positionMillis >= (playback.current.startSec+end) * 1000) void sound.setPositionAsync(playback.current.startSec*1000).catch(() => {});
        });
        sync();
      } catch { if (current === generation.current) setError('Sound could not load. Please retry.'); }
    })();
    return () => { generation.current += 1; if (soundRef.current === owned) soundRef.current = null; if (owned) void owned.unloadAsync().catch(() => {}); };
  }, [url, soundId, attempt]);
  useEffect(() => {
    if(!url||!soundId)return;
    let alive=true;const current=generation.current;
    const check=()=>void getSoundtrack(soundId,'story').then(track=>{if(!alive||current!==generation.current)return;const duration=Math.min(30,Math.max(1,playback.current.durationSec||30));if(playback.current.startSec+duration>track.duration_sec||duration>track.max_excerpt_sec)throw new Error('Excerpt unavailable');}).catch(()=>{if(alive&&current===generation.current){rightsRevoked.current=true;void soundRef.current?.pauseAsync().catch(()=>{});setError('This audio is no longer available.');}});
    const timer=setInterval(check,30000);const subscription=AppState.addEventListener('change',state=>{if(state==='active')check();});
    return()=>{alive=false;clearInterval(timer);subscription.remove();};
  },[url,soundId,attempt]);
  useEffect(() => { sync(); }, [active, volume, callState]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { playback.current.foreground = state === 'active'; sync(); });
    return () => subscription.remove();
  }, []);
  return { error, retry: () => setAttempt(n => n + 1) };
}
