import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import * as Crypto from 'expo-crypto';
import { createPrivateAdaptiveSession } from '../../../shared/privateAdaptiveMedia';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

type Opened = { source: VideoSource; adaptive: boolean; position: number; playing: boolean; key: string };
type Props = {
  messageId: string; userId: string; uri: string; headers?: Record<string, string>;
  requestId?: string; expiresAt?: number; active?: boolean; privateControls?: boolean;
  style?: StyleProp<ViewStyle>; onError?: () => void;
  onClose?: (reason: 'background' | 'account_changed' | 'expired') => void;
  onStopReady?: (stop: (() => void) | null) => void;
};
const enabled = process.env.EXPO_PUBLIC_PRIVATE_HLS === 'true';

/** One visible message, one grant. Nothing is prefetched or persisted. */
export function PrivateChatVideo(props: Props) {
  const { messageId, userId, uri, headers, requestId, expiresAt, active = true, style } = props;
  const callbacks = useRef(props); callbacks.current = props;
  const stopPlayer = useRef<(() => void) | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failed, setFailed] = useState(false);
  const fallback = useRef<(position: number, playing: boolean) => void>(() => {});
  const failedPlayer = useRef<() => void>(() => {});
  // Headers contain credentials. They remain in memory and never become keys,
  // URLs, diagnostic fields, storage entries, or console output.
  const headerAuthorization = headers?.Authorization, headerApiKey = headers?.apikey;
  useEffect(() => {
    let alive = true, closed = false, ownerToken: string | undefined;
    let transport: ReturnType<typeof createPrivateAdaptiveSession> | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let usedFallback = false;
    const current = () => alive && !closed && active && AppState.currentState === 'active'
      && useAuthStore.getState().session?.user.id === userId
      && (!ownerToken || useAuthStore.getState().session?.access_token === ownerToken);
    const finish = () => {
      if (closed) return false;
      closed = true; clearTimeout(expiryTimer); stopPlayer.current?.();
      void transport?.close();
      if (alive) setOpened(null);
      return true;
    };
    const fail = () => { if (finish() && alive) { setFailed(true); callbacks.current.onError?.(); } };
    failedPlayer.current = fail;
    const expire = () => { if (finish() && alive) callbacks.current.onClose?.('expired'); };
    const scheduleExpiry = (deadline?: number) => {
      clearTimeout(expiryTimer);
      if (deadline !== undefined) expiryTimer = setTimeout(expire, Math.max(0, deadline - Date.now()));
    };
    const original: VideoSource = { uri, ...(headers ? { headers } : {}), useCaching: false };
    const showOriginal = (position = 0, playing = true) => {
      if (current()) setOpened({ source: original, adaptive: false, position, playing, key: 'original' });
    };
    fallback.current = (position, playing) => {
      if (!current() || usedFallback) return;
      usedFallback = true; stopPlayer.current?.(); void transport?.close();
      // HLS expiry remains terminal even if an original fallback is selected.
      showOriginal(position, playing);
    };
    callbacks.current.onStopReady?.(finish);
    setOpened(null); setFailed(false);
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active' && finish() && alive) callbacks.current.onClose?.('background');
    });
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId || ownerToken && session.access_token !== ownerToken) {
        if (finish() && alive) callbacks.current.onClose?.('account_changed');
      }
    });
    if (active && current()) {
      if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) expire();
      else {
        scheduleExpiry(expiresAt);
        if (!enabled) showOriginal();
        else void (async () => {
          const { data, error } = await supabase.auth.getSession();
          if (!current()) return;
          if (error || data.session?.user.id !== userId) { fail(); return; }
          ownerToken = data.session.access_token;
          if (!current()) { finish(); return; }
          transport = createPrivateAdaptiveSession({
            endpoint: process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/private-hls',
            token: ownerToken, apiKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
            messageId, requestId: requestId || Crypto.randomUUID(), fetch, current,
          });
          const adaptive = await transport.open();
          if (!current()) { void transport.close(); return; }
          if (!adaptive) { void transport.close(); showOriginal(); return; }
          const deadline = Math.min(adaptive.expiresAt, expiresAt ?? Infinity);
          if (!Number.isFinite(deadline) || deadline <= Date.now()) { expire(); return; }
          scheduleExpiry(deadline);
          setOpened({ source: { uri: adaptive.uri, headers: adaptive.headers, contentType: 'hls', useCaching: false },
            adaptive: true, position: 0, playing: true, key: 'adaptive' });
        })().catch(() => { if (current()) { void transport?.close(); showOriginal(); } });
      }
    }
    return () => {
      alive = false; finish(); clearTimeout(expiryTimer); app.remove(); auth.data.subscription.unsubscribe();
      callbacks.current.onStopReady?.(null);
    };
  }, [messageId, userId, uri, headerAuthorization, headerApiKey, requestId, expiresAt, active]);

  if (!active) return null;
  return <View style={[{ backgroundColor: '#000' }, style]}>
    {opened ? <OpenedChatVideo key={opened.key} opened={opened} privateControls={!!props.privateControls}
      bindStop={stop => { stopPlayer.current = stop; }}
      onFallback={(position, playing) => fallback.current(position, playing)} onError={() => failedPlayer.current()} />
      : failed ? <Text style={{ color: '#fff', textAlign: 'center', padding: 20 }}>This video could not play. Reopen it to try again.</Text>
        : <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />}
  </View>;
}

function OpenedChatVideo({ opened, privateControls, bindStop, onFallback, onError }: {
  opened: Opened; privateControls: boolean; bindStop: (stop: (() => void) | null) => void;
  onFallback: (position: number, playing: boolean) => void; onError: () => void;
}) {
  const player = useVideoPlayer(opened.source, p => {
    p.loop = false; p.allowsExternalPlayback = false; p.staysActiveInBackground = false; p.showNowPlayingNotification = false;
    if (opened.position > 0) p.currentTime = opened.position;
  });
  const [playing, setPlaying] = useState(opened.playing);
  const state = useRef({ bindStop, onFallback, onError }); state.current = { bindStop, onFallback, onError };
  const terminal = useRef(false), intent = useRef(opened.playing);
  useEffect(() => {
    terminal.current = false;
    // This synchronous replace only clears an item, it never loads network media.
    const stop = () => { terminal.current = true; try { player.pause(); player.replace(null, true); } catch {} };
    state.current.bindStop(stop);
    const checkStatus = (event: { status: string }) => {
      if (terminal.current || event.status !== 'error') return;
      const position = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : opened.position;
      const wanted = intent.current;
      stop();
      if (opened.adaptive) state.current.onFallback(position, wanted); else state.current.onError();
    };
    const status = player.addListener('statusChange', checkStatus);
    const playback = player.addListener('playingChange', event => {
      if (terminal.current || AppState.currentState !== 'active') { try { player.pause(); } catch {} return; }
      if (player.status !== 'error') { intent.current = event.isPlaying; setPlaying(event.isPlaying); }
    });
    checkStatus({ status: player.status });
    try { if (!terminal.current && opened.playing) player.play(); } catch { checkStatus({ status: 'error' }); }
    return () => { stop(); status.remove(); playback.remove(); state.current.bindStop(null); };
  }, [player, opened]);
  return <>
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain"
      nativeControls={!privateControls} allowsPictureInPicture={false} surfaceType="textureView" />
    {privateControls && <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause private video' : 'Play private video'}
      onPress={() => { if (terminal.current) return; try { intent.current = !playing; if (playing) player.pause(); else { if (player.currentTime >= player.duration) player.currentTime = 0; player.play(); } } catch {} }}
      style={{ position: 'absolute', bottom: 24, alignSelf: 'center', padding: 14, borderRadius: 24, backgroundColor: '#000b' }}>
      <Text style={{ color: '#fff' }}>{playing ? 'Pause' : 'Play'}</Text>
    </Pressable>}
  </>;
}
