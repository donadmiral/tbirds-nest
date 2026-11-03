import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useCallContext } from './CallContext';
import { livePlayback, type LivePlaybackTicket } from '../services/liveService';
import type { LiveSession } from '../../shared/liveDirectory';
import { subscribeLiveControl } from '../services/liveControlEvents';
import { liveObject } from '../services/liveService';

type Playback = {
  player: VideoPlayer; session: LiveSession | null; expanded: boolean; loading: boolean; error: string | null;
  open(session: LiveSession): Promise<void>; close(): void; minimize(): void; expand(): void; retry(): Promise<void>;
};
const Context = createContext<Playback | null>(null);
export function useLivePlayback() {
  const value = useContext(Context);
  if (!value) throw new Error('Live playback is unavailable.');
  return value;
}

/** One player survives navigation. URLs live only in memory and expire with access. */
export function LivePlaybackProvider({ children }: { children: React.ReactNode }) {
  const owner = useAuthStore(s => s.profile?.id ?? null);
  const { callState } = useCallContext();
  const callBusy=useRef(false);callBusy.current=callState!=='idle'&&callState!=='failed';
  const [session, setSession] = useState<LiveSession | null>(null);
  const [expanded, setExpanded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(null, value => {
    value.loop = false;
    value.staysActiveInBackground = true;
    value.showNowPlayingNotification = true;
    value.timeUpdateEventInterval = 1;
    value.bufferOptions = { preferredForwardBufferDuration: 12, minBufferForPlayback: 1, maxBufferBytes: 24 * 1024 * 1024 };
  });
  const generation = useRef(0), active = useRef<LiveSession | null>(null), ticket = useRef<LivePlaybackTicket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), expires = useRef<ReturnType<typeof setTimeout> | null>(null), auth = useRef(owner), mounted = useRef(true);
  const sourceQueue = useRef<Promise<unknown>>(Promise.resolve());
  auth.current = owner;
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const changeSource = (work: () => Promise<void>) => { const next=sourceQueue.current.catch(()=>{}).then(work);sourceQueue.current=next;return next; };
  const close = useCallback(() => {
    generation.current++; clearTimer(); if(expires.current)clearTimeout(expires.current);expires.current=null; active.current = null; ticket.current = null;
    player.pause(); void changeSource(()=>player.replaceAsync(null)).catch(() => {});
    if (mounted.current) { setSession(null); setExpanded(false); setLoading(false); setError(null); }
  }, [player]);
  const refresh = useRef<(value: LiveSession, reset: boolean) => Promise<void>>(async () => {});
  refresh.current = async (value, reset) => {
    clearTimer(); const version = ++generation.current, scope = auth.current;
    if (!scope) return;
    setLoading(true); setError(null);
    try {
      const next = await livePlayback(value.id);
      if (!mounted.current || version !== generation.current || scope !== auth.current || active.current?.id !== value.id) return;
      const position = !reset && !next.live ? player.currentTime : null;
      const wasPlaying = !callBusy.current && (reset || player.playing);
      await changeSource(async()=>{
        if(!mounted.current||version!==generation.current||scope!==auth.current)return;
        await player.replaceAsync({ uri: next.url, contentType: 'hls', useCaching: false, metadata: { title: value.title, artist: value.host.full_name || value.host.username || 'Platinum Live' } });
      });
      if (!mounted.current || version !== generation.current || scope !== auth.current) return;
      if (position !== null) player.currentTime = position;
      ticket.current = next;
      if (wasPlaying && !callBusy.current) player.play();
      setLoading(false);
      // Refresh the expiring grant, not stream metadata. One timer and request per player.
      if(expires.current)clearTimeout(expires.current);
      expires.current=setTimeout(()=>{if(ticket.current===next){player.pause();ticket.current=null;void changeSource(()=>player.replaceAsync(null)).catch(()=>{});setError('Playback access expired. Reconnect to continue.');}},Math.max(1000,next.expiresAt-Date.now()));
      timer.current = setTimeout(() => { if (active.current?.id === value.id) void refresh.current(value, false); }, Math.max(1000, next.expiresAt - Date.now() - 25000 - Math.random()*5000));
    } catch (reason) {
      if (!mounted.current || version !== generation.current || scope !== auth.current) return;
      player.pause(); ticket.current = null;
      await changeSource(async()=>{if(version===generation.current)await player.replaceAsync(null);}).catch(() => {});
      setLoading(false); setError(reason instanceof Error ? reason.message : 'Playback could not connect. Retry to reconnect.');
    }
  };
  const open = useCallback(async (value: LiveSession) => {
    if (active.current?.id === value.id && ticket.current && ticket.current.expiresAt > Date.now() + 1000) { setExpanded(true); return; }
    active.current = value; setSession(value); setExpanded(true);
    await refresh.current(value, true);
  }, []);
  const retry = useCallback(async () => { const value=active.current;if(value){await refresh.current(value,false);if(!callBusy.current&&active.current?.id===value.id&&ticket.current&&ticket.current.expiresAt>Date.now())player.play();} }, [player]);
  useEffect(() => { close(); }, [owner, close]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' && active.current && (!ticket.current || ticket.current.expiresAt <= Date.now() + 30000)) void refresh.current(active.current, false);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => { if (callState !== 'idle' && callState !== 'failed') player.pause(); }, [callState, player]);
  useEffect(()=>{
    if(!owner||!session)return;
    let activeChannel=true,updating=false;
    const changed=()=>{
      if(!activeChannel||updating||active.current?.id!==session.id)return;
      const resume=player.playing;player.pause();updating=true;
      void refresh.current(active.current,false).then(()=>{if(!callBusy.current&&resume&&active.current?.id===session.id&&ticket.current&&ticket.current.expiresAt>Date.now())player.play();}).finally(()=>{updating=false;});
    };
    const unsubscribe=subscribeLiveControl(session.id,owner,(event,payload)=>{
      if(event==='access_changed') { if(!payload.user_id||payload.user_id===owner)changed(); }
      if(event==='session'&&liveObject(payload.session)) {
        if(['ending','ended','cancelled'].includes(String(payload.session.state))) {
          generation.current++;player.pause();clearTimer();ticket.current=null;setLoading(false);void changeSource(()=>player.replaceAsync(null)).catch(()=>{});
          setError('This live broadcast has ended. Open the stream to check its replay.');
        }
      }
    });
    return()=>{activeChannel=false;unsubscribe();};
  },[owner,session?.id,player]);
  useEffect(() => {
    const listener = player.addListener('statusChange', event => {
      if (event.status === 'error' && active.current) { setError('Playback was interrupted. Retry to reconnect.'); setLoading(false); }
    });
    return () => listener.remove();
  }, [player]);
  useEffect(() => {mounted.current=true;return () => { mounted.current = false; generation.current++; clearTimer();if(expires.current)clearTimeout(expires.current); active.current = null; ticket.current = null; };}, []);
  return <Context.Provider value={{ player, session, expanded, loading, error, open, close, minimize: () => setExpanded(false), expand: () => setExpanded(true), retry }}>{children}</Context.Provider>;
}

export function MiniLivePlayer({ onOpen }: { onOpen(id: string): void }) {
  const live = useLivePlayback();
  if (!live.session || live.expanded) return null;
  return <View style={styles.mini} accessibilityLabel="Minimized Live player">
    <VideoView player={live.player} style={styles.video} contentFit="contain" nativeControls allowsPictureInPicture startsPictureInPictureAutomatically />
    <View style={styles.bar}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Return to live stream" style={styles.titleButton} onPress={() => onOpen(live.session!.id)}><Text numberOfLines={1} style={styles.title}>{live.session.title}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close live stream" onPress={live.close} style={styles.close}><Feather name="x" size={18} color="#fff" /></TouchableOpacity></View>
    {live.error ? <TouchableOpacity accessibilityRole="button" onPress={() => void live.retry()} style={styles.retry}><Text style={styles.title}>Playback stopped. Retry</Text></TouchableOpacity> : null}
  </View>;
}
const styles = StyleSheet.create({ mini: { position: 'absolute', bottom: 92, right: 12, width: 216, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111', zIndex: 45, elevation: 10 }, video: { width: '100%', aspectRatio: 16 / 9 }, bar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10 }, titleButton: { flex: 1, minHeight: 44, justifyContent: 'center' }, title: { color: '#fff', fontSize: 12, fontWeight: '600' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, retry: { minHeight: 44, justifyContent: 'center', padding: 10, backgroundColor: '#512323' } });
