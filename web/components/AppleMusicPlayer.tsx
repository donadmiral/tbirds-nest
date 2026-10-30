'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { appleMusic, type MusicKitInstance } from '@/lib/appleMusic';
import { createClient } from '@/lib/supabase/client';
import type { AppleMusicTrack } from '../../shared/appleMusic';

/** Apple's player handles subscription entitlement and protected media. No media is downloaded or mixed. */
export default function AppleMusicPlayer({ track }: { track: AppleMusicTrack }) {
  const instance = useRef<MusicKitInstance | null>(null);
  const generation = useRef(0);
  const expiresAt = useRef(0);
  const activeTrack = useRef<string | null>(null);
  const previousTrack = useRef(track.id);
  const busy = useRef(false);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  const prepare = useCallback(async () => {
    const mine = generation.current += 1;
    setReady(false); setError('');
    try {
      const credentials = await appleMusic.developerToken();
      if (mine !== generation.current) return;
      if (!window.MusicKit) throw new Error('Apple Music did not load. Open the song in Apple Music or try again.');
      const player = await window.MusicKit.configure({ developerToken: credentials.token, app: { name: 'Platinum Circles', build: '1.0' } });
      if (mine !== generation.current) { await player.stop(); return; }
      instance.current = player; expiresAt.current = credentials.expiresAt; setReady(true);
    } catch (e) { if (mine === generation.current) setError(e instanceof Error ? e.message : 'Apple Music is unavailable.'); }
  }, []);

  useEffect(() => {
    let account: string | null | undefined;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (account !== undefined && next !== account) {
        generation.current += 1; setReady(false); setPlaying(false);
        void instance.current?.stop().catch(() => {});
        void instance.current?.unauthorize().catch(() => {});
        instance.current = null;
        setError('Your account changed. Reload this page to connect Apple Music.');
      }
      account = next;
    });
    return () => { generation.current += 1; data.subscription.unsubscribe(); void instance.current?.stop().catch(() => {}); void instance.current?.unauthorize().catch(() => {}); };
  }, []);

  useEffect(() => {
    const player = instance.current;
    if (!ready || !player) return;
    const changed = () => setPlaying(player.isPlaying);
    player.addEventListener('playbackStateDidChange', changed);
    return () => player.removeEventListener('playbackStateDidChange', changed);
  }, [ready]);

  useEffect(() => {
    if (previousTrack.current === track.id) return;
    previousTrack.current = track.id;
    generation.current += 1;
    activeTrack.current = null; setPlaying(false);
    void instance.current?.stop().catch(() => {});
  }, [track.id]);

  useEffect(() => {
    const stop = () => { generation.current += 1; setPlaying(false); void instance.current?.stop().catch(() => {}); };
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener('platinum:stop-media', stop); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('platinum:stop-media', stop); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  async function toggle() {
    if (document.hidden || document.documentElement.dataset.platinumCallActive === 'true') return;
    const player = instance.current;
    if (!player || busy.current) return;
    if (Date.now() >= expiresAt.current - 10000) { await prepare(); return; }
    const mine = generation.current;
    busy.current = true; setWorking(true); setError('');
    try {
      // Called directly from a user gesture so Apple's authorization popup is allowed.
      if (!player.isAuthorized) await player.authorize();
      if (mine !== generation.current) { await player.unauthorize(); return; }
      if (player.isPlaying && activeTrack.current === track.id) { await player.pause(); setPlaying(false); return; }
      if (activeTrack.current !== track.id) { await player.setQueue({ song: track.id }); activeTrack.current = track.id; }
      if (mine !== generation.current || document.hidden || document.documentElement.dataset.platinumCallActive === 'true') return;
      await player.play();
      if (mine === generation.current) setPlaying(true);
      else await player.stop();
    } catch {
      if (mine === generation.current) setError('Playback could not start. Allow Apple Music access and check your subscription and song availability, or open the song in Apple Music.');
    } finally { busy.current = false; setWorking(false); }
  }

  return <section className="rounded-xl border border-ink/10 p-4" aria-label="Apple Music player">
    <Script id="apple-musickit" src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" strategy="afterInteractive" onReady={() => { void prepare(); }} onError={() => setError('Apple Music did not load. You can open the song in Apple Music.')} />
    <p className="font-semibold">{track.title}</p><p className="text-sm text-muted">{track.artist}</p>
    <p className="mt-2 text-sm text-muted">Full playback requires Apple Music authorization, an eligible subscription and availability in your region.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="min-h-11 rounded-full bg-pearl px-5 font-semibold text-on-pearl disabled:opacity-50" disabled={!ready || working} onClick={() => { void toggle(); }}>{working ? 'Connecting…' : playing ? 'Pause' : 'Listen with Apple Music'}</button>
      <a className="inline-flex min-h-11 items-center text-accent" href={track.url} target="_blank" rel="noopener noreferrer">Open in Apple Music</a>
    </div>
    {error ? <div role="alert" className="mt-3 text-sm"><p>{error}</p><button type="button" onClick={() => { void prepare(); }} className="min-h-11 font-semibold text-accent">Retry connection</button></div> : null}
  </section>;
}
