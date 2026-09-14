/**
 * One video engine for the whole app. Surfaces attach to it instead of creating
 * players; the surface that is on screen and in front owns it, and the same file
 * carries over from the feed to the post without restarting. A surface that
 * leaves the screen releases the engine and the engine pauses: nothing plays
 * out of view. Only the owner writes to the player; idle cards never touch it.
 */
import { useEffect, useRef } from 'react';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import { create } from 'zustand';

type EngineState = { uri: string | null; owner: string | null; postId: string | null };
export const useVideoEngine = create<EngineState & { set: (p: Partial<EngineState>) => void }>((set) => ({
  uri: null, owner: null, postId: null, set: (p) => set(p),
}));

let player: VideoPlayer | null = null;
export function getVideoPlayer(): VideoPlayer {
  if (!player) { player = createVideoPlayer(null); player.loop = true; player.timeUpdateEventInterval = 0.25; }
  return player;
}

// A position handed from one surface to the next: the expanded viewer closing back onto the feed.
let pendingSeek: { uri: string; at: number } | null = null;
export function seekWhenClaimed(uri: string, at: number) { pendingSeek = { uri, at }; }

/** Where the engine is in a file right now, so another surface can start from the same moment. */
export function enginePosition(uri: string): number {
  if (!player || useVideoEngine.getState().uri !== uri) return 0;
  try { return Number(player.currentTime) || 0; } catch { return 0; }
}

/** Pause and free the engine, whoever holds it. */
export function releaseEngine() {
  try { getVideoPlayer().pause(); } catch {}
  useVideoEngine.getState().set({ owner: null });
}

export function useSharedVideo(o: { uri: string; visible: boolean; screenActive: boolean; postId?: string | null; rate?: number; muted?: boolean; loop?: boolean }) {
  const idRef = useRef('v' + Math.random().toString(36).slice(2));
  const id = idRef.current;
  const owner = useVideoEngine((s) => s.owner);
  const owns = owner === id;
  const active = o.visible && o.screenActive;
  useEffect(() => {
    if (!active) return;
    const p = getVideoPlayer();
    const st = useVideoEngine.getState();
    if (st.uri !== o.uri) { try { p.replace(o.uri); } catch {} }
    if (pendingSeek && pendingSeek.uri === o.uri) { try { p.currentTime = pendingSeek.at; } catch {} pendingSeek = null; }
    p.loop = o.loop ?? true; p.muted = !!o.muted; p.playbackRate = o.rate || 1;
    st.set({ owner: id, uri: o.uri, postId: o.postId ?? null });
    return () => {
      const s2 = useVideoEngine.getState();
      if (s2.owner !== id) return;
      try { p.pause(); } catch {}
      s2.set({ owner: null });
    };
  }, [active, o.uri, id]);
  return { player: getVideoPlayer(), owns };
}