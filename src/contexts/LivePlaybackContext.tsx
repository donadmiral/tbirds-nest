import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useCallContext } from './CallContext';
import { livePlayback, liveRequestId, type LivePlaybackTicket } from '../services/liveService';
import type { LiveSession } from '../../shared/liveDirectory';
import { subscribeLiveControl } from '../services/liveControlEvents';
import { liveObject } from '../services/liveService';
import { LIVE_STARTUP_WINDOW_MS, liveStartupDelay, type LivePlaybackStartup } from '../services/livePlaybackStartup';
import { supabase } from '../services/supabase';
import { createLiveViewerPresenceHook } from '../../shared/useLiveViewerPresence';

const useLiveViewerPresence = createLiveViewerPresenceHook({ useEffect, useRef });

type Playback = {
  player: VideoPlayer; session: LiveSession | null; expanded: boolean; loading: boolean; error: string | null;
  open(session: LiveSession): Promise<void>; close(): void; minimize(): void; expand(): void; retry(): Promise<void>; setPictureInPicture(active: boolean): void;
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
  const identityScope = useAuthStore(s => s.session ? `${s.session.user.id}:${s.session.user.last_sign_in_at ?? ''}` : null);
  const { callState } = useCallContext();
  const callBusy=useRef(false);callBusy.current=callState!=='idle'&&callState!=='failed';
  const [session, setSession] = useState<LiveSession | null>(null);
  const [expanded, setExpanded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  // watching: the viewer has frames and has not paused, closed or hit an error. A rebuffer or a grant renewal does not end it.
  const [watching, setWatching] = useState(false), [foreground, setForeground] = useState(AppState.currentState === 'active'), [pictureInPicture, setPictureInPicture] = useState(false);
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
  const startup = useRef<LivePlaybackStartup | null>(null), startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null), authorizationPending = useRef(false), swapping = useRef(false);
  const scheduleStartupRetry = useRef<(message?: string) => boolean>(() => false);
  useLiveViewerPresence({ client: supabase, sessionId: session?.id ?? null, identityScope,
    active: watching && (foreground || pictureInPicture) && ticket.current?.live === true && !callBusy.current,
    createPlaybackId: liveRequestId });
  auth.current = owner;
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const clearStartupTimer = () => { if (startupTimer.current) clearTimeout(startupTimer.current); startupTimer.current = null; };
  const changeSource = (work: () => Promise<void>) => { const next=sourceQueue.current.catch(()=>{}).then(work);sourceQueue.current=next;return next; };
  const source = (value: LiveSession, grant: LivePlaybackTicket) => ({ uri: grant.url, contentType: 'hls' as const, useCaching: false, metadata: { title: value.title, artist: value.host.full_name || value.host.username || 'Platinum Live' } });
  scheduleStartupRetry.current = (message = '') => {
    const value = active.current, grant = ticket.current, attempt = startup.current, scope = auth.current, version = generation.current;
    if (!mounted.current || !scope || !value || !grant?.live || !attempt || authorizationPending.current || callBusy.current) return false;
    if (startupTimer.current) { if (liveStartupDelay({ ...attempt, attempts: Math.max(0, attempt.attempts - 1) }, grant.expiresAt, Date.now(), message, 0) !== null) return true; clearStartupTimer(); return false; }
    const delay = liveStartupDelay(attempt, grant.expiresAt, Date.now(), message);
    if (delay === null) return false;
    attempt.attempts++; setLoading(true); setError(null);
    startupTimer.current = setTimeout(() => {
      startupTimer.current = null;
      const current = () => mounted.current && version === generation.current && scope === auth.current && ticket.current === grant && active.current?.id === value.id && startup.current === attempt;
      if (!current()) return;
      if (attempt.played || callBusy.current) { setLoading(false); return; }
      if (Date.now() >= Math.min(grant.expiresAt, attempt.startedAt + LIVE_STARTUP_WINDOW_MS)) { setLoading(false); setError('The live video is still preparing. Retry to reconnect.'); return; }
      void changeSource(async () => {
        if (!current()) return;
        player.pause();
        await player.replaceAsync(source(value, grant));
      }).then(() => {
        if (!current() || Date.now() >= grant.expiresAt || callBusy.current) return;
        if (!attempt.played && Date.now() >= attempt.startedAt + LIVE_STARTUP_WINDOW_MS) { setLoading(false); setError('The live video is still preparing. Retry to reconnect.'); return; }
        player.play();
      }).catch(reason => {
        if (!current()) return;
        if (!scheduleStartupRetry.current(reason instanceof Error ? reason.message : '')) { setLoading(false); setError('Playback could not connect. Retry when connected.'); }
      });
    }, delay);
    return true;
  };
  const close = useCallback(() => {
    generation.current++; clearTimer(); clearStartupTimer(); startup.current = null; authorizationPending.current = false; swapping.current = false; if(expires.current)clearTimeout(expires.current);expires.current=null; active.current = null; ticket.current = null;
    player.pause(); void changeSource(()=>player.replaceAsync(null)).catch(() => {});
    if (mounted.current) { setSession(null); setExpanded(false); setLoading(false); setError(null); setWatching(false); setPictureInPicture(false); }
  }, [player]);
  const refresh = useRef<(value: LiveSession, reset: boolean, renewal?: boolean) => Promise<void>>(async () => {});
  refresh.current = async (value, reset, renewal = false) => {
    clearTimer(); clearStartupTimer(); const version = ++generation.current, scope = auth.current;
    if (!scope) return;
    authorizationPending.current = true;
    let sourceAuthorized = false;
    setLoading(true); setError(null);
    try {
      const next = await livePlayback(value.id);
      if (!mounted.current || version !== generation.current || scope !== auth.current || active.current?.id !== value.id) return;
      const position = !reset && !next.live ? player.currentTime : null;
      const wasPlaying = !callBusy.current && (reset || player.playing);
      ticket.current = next; authorizationPending.current = false; sourceAuthorized = true;
      if(expires.current)clearTimeout(expires.current);
      expires.current=setTimeout(()=>{if(ticket.current===next){generation.current++;clearStartupTimer();player.pause();ticket.current=null;void changeSource(()=>player.replaceAsync(null)).catch(()=>{});setLoading(false);setError('Playback access expired. Reconnect to continue.');}},Math.max(1000,next.expiresAt-Date.now()));
      timer.current = setTimeout(() => { if (active.current?.id === value.id) void refresh.current(value, false, true); }, Math.max(1000, next.expiresAt - Date.now() - 25000 - Math.random()*5000));
      // The source swap pauses and reloads the player. That pause is the renewal, not the viewer leaving.
      swapping.current = wasPlaying;
      await changeSource(async()=>{
        if(!mounted.current||version!==generation.current||scope!==auth.current)return;
        await player.replaceAsync(source(value, next));
      });
      if (!mounted.current || version !== generation.current || scope !== auth.current) return;
      if (position !== null) player.currentTime = position;
      if (wasPlaying && !callBusy.current) player.play(); else swapping.current = false;
      setLoading(!!startupTimer.current);
    } catch (reason) {
      if (!mounted.current || version !== generation.current || scope !== auth.current) return;
      authorizationPending.current = false;
      if (sourceAuthorized && scheduleStartupRetry.current(reason instanceof Error ? reason.message : '')) return;
      const held = ticket.current;
      // A renewal that failed while the grant in use still works leaves playback alone and asks again before that grant runs out.
      if (renewal && !sourceAuthorized && held && held.expiresAt > Date.now() + 8000) {
        swapping.current = false;
        timer.current = setTimeout(() => { if (active.current?.id === value.id) void refresh.current(value, false, true); }, Math.max(2000, Math.min(10000, held.expiresAt - Date.now() - 6000)));
        setLoading(false); return;
      }
      clearTimer(); clearStartupTimer(); if(expires.current)clearTimeout(expires.current);expires.current=null;
      swapping.current = false; player.pause(); ticket.current = null; setWatching(false);
      await changeSource(async()=>{if(version===generation.current)await player.replaceAsync(null);}).catch(() => {});
      setLoading(false); setError(reason instanceof Error ? reason.message : 'Playback could not connect. Retry to reconnect.');
    }
  };
  const open = useCallback(async (value: LiveSession) => {
    if (active.current?.id === value.id && ticket.current && ticket.current.expiresAt > Date.now() + 1000) { setExpanded(true); return; }
    startup.current = { startedAt: Date.now(), attempts: 0, played: false };
    active.current = value; setSession(value); setExpanded(true);
    await refresh.current(value, true);
  }, []);
  const retry = useCallback(async () => { const value=active.current;if(value){if(startup.current&&!startup.current.played)startup.current={startedAt:Date.now(),attempts:0,played:false};await refresh.current(value,false);if(!callBusy.current&&active.current?.id===value.id&&ticket.current&&ticket.current.expiresAt>Date.now())player.play();} }, [player]);
  useEffect(() => { close(); }, [owner, identityScope, close]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
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
          generation.current++;swapping.current=false;player.pause();clearTimer();clearStartupTimer();ticket.current=null;setLoading(false);setWatching(false);void changeSource(()=>player.replaceAsync(null)).catch(()=>{});
          setError('This live broadcast has ended. Open the stream to check its replay.');
        }
      }
    });
    return()=>{activeChannel=false;unsubscribe();};
  },[owner,session?.id,player]);
  useEffect(() => {
    const markPlaying = () => { if (active.current && ticket.current && player.status === 'readyToPlay' && player.playing) { if (startup.current) startup.current.played = true; clearStartupTimer(); swapping.current = false; setWatching(true); setLoading(false); setError(null); } };
    const listener = player.addListener('statusChange', event => {
      if (event.status === 'readyToPlay') { swapping.current = false; markPlaying(); }
      if (event.status === 'error') { setWatching(false); if (active.current && !scheduleStartupRetry.current(event.error?.message)) { setError('Playback was interrupted. Retry when connected.'); setLoading(false); } }
    });
    // Only the viewer's own pause ends the count. A pause raised by a source swap during renewal is the renewal.
    const playing = player.addListener('playingChange', event => { if (event.isPlaying) { swapping.current = false; markPlaying(); } else if (!swapping.current) setWatching(false); });
    return () => { listener.remove(); playing.remove(); };
  }, [player]);
  useEffect(() => {mounted.current=true;return () => { mounted.current = false; generation.current++; clearTimer();clearStartupTimer();startup.current=null;if(expires.current)clearTimeout(expires.current); active.current = null; ticket.current = null; };}, []);
  return <Context.Provider value={{ player, session, expanded, loading, error, open, close, minimize: () => setExpanded(false), expand: () => setExpanded(true), retry, setPictureInPicture }}>{children}</Context.Provider>;
}

export function MiniLivePlayer({ onOpen }: { onOpen(id: string): void }) {
  const live = useLivePlayback();
  if (!live.session || live.expanded) return null;
  return <View style={styles.mini} accessibilityLabel="Minimized Live player">
    <VideoView player={live.player} style={styles.video} contentFit="contain" nativeControls allowsPictureInPicture startsPictureInPictureAutomatically onPictureInPictureStart={() => live.setPictureInPicture(true)} onPictureInPictureStop={() => live.setPictureInPicture(false)} />
    <View style={styles.bar}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Return to live stream" style={styles.titleButton} onPress={() => onOpen(live.session!.id)}><Text numberOfLines={1} style={styles.title}>{live.session.title}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel="Close live stream" onPress={live.close} style={styles.close}><Feather name="x" size={18} color="#fff" /></TouchableOpacity></View>
    {live.error ? <TouchableOpacity accessibilityRole="button" onPress={() => void live.retry()} style={styles.retry}><Text style={styles.title}>Playback stopped. Retry</Text></TouchableOpacity> : null}
  </View>;
}
const styles = StyleSheet.create({ mini: { position: 'absolute', bottom: 92, right: 12, width: 216, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111', zIndex: 45, elevation: 10 }, video: { width: '100%', aspectRatio: 16 / 9 }, bar: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10 }, titleButton: { flex: 1, minHeight: 44, justifyContent: 'center' }, title: { color: '#fff', fontSize: 12, fontWeight: '600' }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, retry: { minHeight: 44, justifyContent: 'center', padding: 10, backgroundColor: '#512323' } });
