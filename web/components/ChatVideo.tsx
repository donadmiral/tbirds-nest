'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { openPrivateAdaptiveVideo, type PrivateAdaptiveVideo, type PrivatePlaybackPosition } from '@/lib/privateAdaptiveVideo';

type Props = { messageId: string; userId: string | null; source: string; poster?: string; onError: () => void };
export function ChatVideo(props: Props) {
  if (process.env.NEXT_PUBLIC_PRIVATE_HLS !== 'true') return <video key={props.messageId + ':' + props.source} src={props.source} poster={props.poster} onError={props.onError} controls preload="metadata" className="mb-1 max-h-72 rounded-lg" />;
  return <PrivateChatVideo {...props} />;
}
function PrivateChatVideo({ messageId, userId, source, poster, onError }: Props) {
  const [client] = useState(createClient);
  const video = useRef<HTMLVideoElement>(null), player = useRef<PrivateAdaptiveVideo | null>(null);
  const generation = useRef(0), live = useRef(false), owner = useRef(userId), error = useRef(onError), wantsPlay = useRef(true);
  const removeMetadata = useRef<(() => void) | null>(null);
  const [started, setStarted] = useState(false), [busy, setBusy] = useState(false);
  useLayoutEffect(() => { error.current = onError; }, [onError]);
  const clear = useCallback(() => {
    generation.current += 1;
    player.current?.close(); player.current = null;
    removeMetadata.current?.(); removeMetadata.current = null;
    const element = video.current;
    if (element) { element.pause(); element.removeAttribute('src'); element.load(); }
  }, []);
  useEffect(() => {
    live.current = true; owner.current = userId;
    const hide = () => { if (document.visibilityState !== 'visible') { clear(); setStarted(false); setBusy(false); } };
    const auth = client.auth.onAuthStateChange((_event, session) => {
      owner.current = session?.user.id || null;
      if (owner.current !== userId) { clear(); setStarted(false); setBusy(false); }
    });
    document.addEventListener('visibilitychange', hide);
    return () => { live.current = false; clear(); auth.data.subscription.unsubscribe(); document.removeEventListener('visibilitychange', hide); };
  }, [client, messageId, userId, source, clear]);
  const start = async () => {
    if (busy || !userId) return;
    clear(); wantsPlay.current = true; const run = generation.current;
    const current = () => live.current && run === generation.current && owner.current === userId && document.visibilityState === 'visible';
    setBusy(true);
    const original = (position: PrivatePlaybackPosition = { time: 0, playing: true }) => {
      player.current = null;
      const element = video.current;
      if (!current() || !element) return;
      const loaded = () => {
        if (!current()) return;
        if (position.time > 0) element.currentTime = Math.min(position.time, element.duration || position.time);
        if (position.playing) void element.play().catch(() => {});
      };
      element.addEventListener('loadedmetadata', loaded, { once: true });
      removeMetadata.current = () => element.removeEventListener('loadedmetadata', loaded);
      element.src = source; element.load(); setStarted(true); setBusy(false);
    };
    try {
      const auth = await client.auth.getSession();
      if (!current()) return;
      if (auth.error || auth.data.session?.user.id !== userId) { error.current(); return; }
      const prepared = await openPrivateAdaptiveVideo({ token: auth.data.session.access_token, messageId, requestId: crypto.randomUUID(), current });
      if (!current()) { prepared?.close(); return; }
      if (!prepared || !video.current) { original(); return; }
      player.current = prepared;
      prepared.attach(video.current, { onFallback: original, shouldPlay: () => current() && wantsPlay.current, onExpired: () => { clear(); setStarted(false); setBusy(false); } });
      setStarted(true); setBusy(false);
    } catch { if (current()) original(); }
    finally { if (current()) setBusy(false); }
  };
  return <div className="relative mb-1">
    <video ref={video} poster={poster} controls={started} playsInline preload="none" disablePictureInPicture disableRemotePlayback
      onPlay={() => { wantsPlay.current = true; }} onPause={() => { wantsPlay.current = false; }}
      onError={() => { if (started && !player.current) error.current(); }} className="max-h-72 rounded-lg" />
    {!started && <button type="button" disabled={busy || !userId} onClick={() => void start()} className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30 text-white">{busy ? 'Opening…' : 'Play video'}</button>}
  </div>;
}
