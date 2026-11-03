'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Download, RefreshCw, Share2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { liveError } from '@/lib/liveApi';
import { clipDownload, getLiveClip, type ClipDetail } from '@/lib/liveClips';
import { isLiveUuid } from '../../shared/liveDirectory';
import { ClipActions } from './LiveClipLibrary';

export function LiveClipView({ id }: { id: string }) {
  const [client] = useState(createClient), [navigation] = useState(getNavigationStore);
  const identity = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const [detail, setDetail] = useState<ClipDetail | null>(null), [format, setFormat] = useState(''), [asset, setAsset] = useState<{ url: string; expires_at: string } | null>(null), [poster, setPoster] = useState(''), [captions, setCaptions] = useState('');
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [mediaError, setMediaError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0), [manage, setManage] = useState(false);
  const version = useRef(0), lock = useRef(false), video = useRef<HTMLVideoElement>(null), resume = useRef({ time: 0, playing: false });
  const load = useCallback(async () => { if (!identity.owner || !isLiveUuid(id) || lock.current) return; const current = version.current; lock.current = true; setLoading(true); try { const value = await getLiveClip(client, id); if (current !== version.current) return; setDetail(value); setFormat(previous => value.clip.formats.includes(previous) ? previous : value.clip.formats.includes('vertical') ? 'vertical' : value.clip.formats[0] || 'horizontal'); setError(''); } catch (cause) { if (current === version.current) { video.current?.pause(); setDetail(null); setAsset(null); setError(liveError(cause)); } } finally { if (current === version.current) { lock.current = false; setLoading(false); } } }, [client, id, identity.owner]);
  useEffect(() => { version.current++; lock.current = false; setDetail(null); setAsset(null); setPoster(''); setCaptions(''); setManage(false); setFormat(''); setError(isLiveUuid(id) ? '' : 'This clip link is not valid.'); void load(); return () => { version.current++; lock.current = false; video.current?.pause(); }; }, [load, identity.scope, id]);
  const playable = !!detail && (['ready', 'published'].includes(detail.clip.state) || detail.can_review && detail.clip.state === 'review');
  useEffect(() => {
    if (!identity.owner || !playable || !format) return;
    let alive = true, inFlight = false, timer: ReturnType<typeof setTimeout> | undefined;
    setAsset(null); setMediaError(''); resume.current = { time: 0, playing: false };
    const refresh = async () => {
      if (!alive || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true; clearTimeout(timer);
      try { const result = await clipDownload(client, id, format); if (!alive) return; const current = video.current; if (current) resume.current = { time: current.currentTime, playing: !current.paused }; setAsset(result); setMediaError(''); timer = setTimeout(() => void refresh(), Math.max(5000, Math.min(90000, Date.parse(result.expires_at) - Date.now() - 20000 - Math.random() * 5000))); }
      catch (cause) { if (alive) { video.current?.pause(); setAsset(null); setMediaError(liveError(cause)); } }
      finally { inFlight = false; }
    };
    const visible = () => { if (document.visibilityState === 'hidden') { clearTimeout(timer); video.current?.pause(); } else void refresh(); };
    void refresh(); document.addEventListener('visibilitychange', visible);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); video.current?.pause(); };
  }, [client, id, identity.scope, identity.owner, playable, format, retry]);
  useEffect(() => {
    if (!identity.owner || !playable) return;
    let alive = true; setPoster(''); setCaptions('');
    void clipDownload(client, id, 'thumbnail').then(result => { if (alive) setPoster(result.url); }).catch(() => {});
    if (detail?.subtitles.length) void clipDownload(client, id, 'captions').then(result => { if (alive) setCaptions(result.url); }).catch(() => {});
    return () => { alive = false; };
  }, [client, id, identity.scope, identity.owner, playable, detail?.subtitles.length, retry]);
  const link = typeof window === 'undefined' ? '' : window.location.origin + '/live/clips/' + id;
  return <div className="mx-auto max-w-5xl pb-24"><Link href="/live/clips" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted"><ArrowLeft size={17}/>Clip library</Link>
    {!identity.owner ? <p className="rounded-xl bg-surface p-6 text-sm text-muted"><Link href={'/login?next=' + encodeURIComponent('/live/clips/' + id)} className="underline">Sign in</Link> to watch this clip.</p> : error ? <p role="alert" className="rounded-xl border border-ink/10 p-5 text-sm text-ink">{error}<button type="button" onClick={() => void load()} className="ml-3 min-h-11 underline">Retry</button></p> : !detail ? <p role="status" className="py-16 text-center text-muted">Loading clip…</p> : <>
      <header className="mb-5"><p className="mb-2 text-xs uppercase tracking-widest text-muted">Live moment · {Math.round((detail.clip.end_ms - detail.clip.start_ms) / 1000)} seconds</p><h1 className="text-2xl font-semibold text-ink sm:text-3xl">{detail.clip.title}</h1></header>
      <div className="overflow-hidden rounded-2xl bg-black"><div className={format === 'vertical' ? 'mx-auto aspect-[9/16] max-h-[72vh] max-w-full' : 'aspect-video'}>{playable && asset ? <video ref={video} key={format} src={asset.url} poster={poster || undefined} controls playsInline preload="metadata" crossOrigin="anonymous" className="h-full max-h-[72vh] w-full object-contain" aria-label={detail.clip.title} onLoadedMetadata={event => { if (resume.current.time > 0) event.currentTarget.currentTime = Math.min(resume.current.time, event.currentTarget.duration || resume.current.time); if (resume.current.playing) void event.currentTarget.play().catch(() => {}); }} onError={() => setMediaError('Playback could not load. Refresh the video to try again.')}><track key={captions} src={captions || undefined} kind="subtitles" label="Subtitles" srcLang="en"/></video> : <div className="flex h-full min-h-64 items-center justify-center p-7 text-center text-sm text-white">{mediaError || (playable ? 'Loading video…' : detail.clip.state === 'failed' ? 'This clip needs to be rendered again.' : detail.clip.state === 'blocked' ? 'This clip is unavailable.' : 'This clip is still processing or awaiting review.')}</div>}</div></div>
      {mediaError ? <p role="alert" className="mt-3 text-sm text-ink">{mediaError}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 min-h-11 underline">Refresh video</button></p> : null}
      {notice ? <p role="status" className="mt-3 rounded-xl bg-surface p-3 text-sm text-ink">{notice}</p> : null}
      <div className="my-5 flex flex-wrap items-center gap-3">{detail.clip.formats.length > 1 ? <select aria-label="Clip viewing format" value={format} onChange={event => setFormat(event.target.value)} className="min-h-11 rounded-full bg-surface px-4 text-sm text-ink">{detail.clip.formats.map(value => <option value={value} key={value}>{value === 'vertical' ? 'Vertical, 9:16' : 'Horizontal, 16:9'}</option>)}</select> : null}{detail.can_share_link ? <button type="button" onClick={async () => { try { const canShare = typeof navigator.share === 'function'; if (canShare) await navigator.share({ title: detail.clip.title, url: link }); else await navigator.clipboard.writeText(link); setNotice(canShare ? 'Clip handed to your device share menu.' : 'Clip link copied.'); } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setNotice('This browser could not share the link.'); } }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/15 px-4 text-sm text-ink"><Share2 size={16}/>Share clip</button> : null}<button type="button" disabled={!playable} onClick={async () => { try { const current = version.current; const result = await clipDownload(client, id, format); if (current !== version.current) return; const anchor = document.createElement('a'); anchor.href = result.url; anchor.download = result.filename; anchor.rel = 'noopener'; anchor.target = '_blank'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setNotice('The video download is opening.'); } catch (cause) { setNotice(liveError(cause)); } }} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/15 px-4 text-sm text-ink disabled:opacity-40"><Download size={16}/>Download</button>{detail.can_manage ? <button type="button" onClick={() => setManage(true)} className="min-h-11 rounded-full bg-ink px-5 text-sm font-semibold text-[var(--canvas)]">Manage and share</button> : null}<button type="button" disabled={loading} aria-label="Refresh clip" onClick={() => void load()} className="ml-auto grid min-h-11 min-w-11 place-items-center text-muted"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button></div>
      {detail.clip.caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{detail.clip.caption}</p> : null}{detail.clip.tags.length ? <p className="mt-3 text-sm text-muted">{detail.clip.tags.map(tag => '#' + tag).join(' ')}</p> : null}<Link href={'/live/' + detail.clip.session_id} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline">Watch the original stream</Link>
      {manage && detail.can_manage ? <ClipActions client={client} clip={detail.clip} onClose={() => setManage(false)} onRefresh={() => void load()}/> : null}
    </>}
  </div>;
}
