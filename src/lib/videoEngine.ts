/**
 * One video engine for the whole app. Surfaces attach to it instead of creating
 * players; the surface that is on screen and in front owns it, and the same file
 * carries over from the feed to the post without restarting. On a post, a video
 * scrolled out of view keeps playing docked in the corner.
 */
import { useEffect, useRef } from 'react';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import { create } from 'zustand';

type EngineState = { uri: string | null; owner: string | null; floating: boolean; poster: string | null; postId: string | null };
export const useVideoEngine = create<EngineState & { set: (p: Partial<EngineState>) => void }>((set) => ({
  uri: null, owner: null, floating: false, poster: null, postId: null, set: (p) => set(p),
}));

let player: VideoPlayer | null = null;
export function getVideoPlayer(): VideoPlayer {
  if (!player) { player = createVideoPlayer(null); player.loop = true; player.timeUpdateEventInterval = 0.25; }
  return player;
}

export function stopFloating() {
  try { getVideoPlayer().pause(); } catch {}
  useVideoEngine.getState().set({ floating: false, owner: null });
}

export function useSharedVideo(o: { uri: string; visible: boolean; screenActive: boolean; poster?: string | null; postId?: string | null; rate?: number; muted?: boolean; loop?: boolean; floatWhenScrolled?: boolean }) {
  const idRef = useRef('v' + Math.random().toString(36).slice(2));
  const id = idRef.current;
  const owner = useVideoEngine((s) => s.owner);
  const owns = owner === id;
  const visRef = useRef(o.visible); visRef.current = o.visible;
  const actRef = useRef(o.screenActive); actRef.current = o.screenActive;
  const floatRef = useRef(!!o.floatWhenScrolled); floatRef.current = !!o.floatWhenScrolled;
  const active = o.visible && o.screenActive;
  useEffect(() => {
    if (!active) return;
    const p = getVideoPlayer();
    const st = useVideoEngine.getState();
    if (st.uri !== o.uri) { try { p.replace(o.uri); } catch {} }
    p.loop = o.loop ?? true; p.muted = !!o.muted; p.playbackRate = o.rate || 1;
    st.set({ owner: id, uri: o.uri, poster: o.poster ?? null, postId: o.postId ?? null, floating: false });
    return () => {
      const s2 = useVideoEngine.getState();
      if (s2.owner !== id) return;
      const scrolledAway = actRef.current && !visRef.current;
      if (scrolledAway && floatRef.current) s2.set({ owner: null, floating: true });
      else { try { p.pause(); } catch {} s2.set({ owner: null, floating: false }); }
    };
  }, [active, o.uri, id]);
  return { player: getVideoPlayer(), owns };
}