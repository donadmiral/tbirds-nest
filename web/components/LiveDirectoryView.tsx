'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { CalendarDays, MoreHorizontal, RefreshCw, Search, Users } from 'lucide-react';
import { LiveIcon } from './LiveIcon';
import { LiveEntry } from './LiveEntry';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { withTimeout } from '@/lib/withTimeout';
import { LIVE_TOPICS, NO_LIVE_CAPABILITIES, isLiveSetupMissing, liveStateLabel, parseLiveDirectory, safeLiveImage,
  type LiveCapabilities, type LiveCursor, type LiveFilter, type LiveSession, type LiveView } from '../../shared/liveDirectory';

type State = { key: string; items: LiveSession[]; cursor: LiveCursor | null; capabilities: LiveCapabilities; loading: boolean; error: string | null; setup: boolean };
const relations: [LiveFilter,string][] = [['for_you','Recommended'],['following','Following'],['followers','Followers'],['celebrities','Celebrities'],['mine','My streams']];
const views: [LiveView,string][] = [['live','Live now'],['scheduled','Upcoming'],['replay','Replays']];
function Thumbnail({ session }: { session: LiveSession }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl bg-surface-elevated text-ink">
    {session.thumbnail_url && failed !== session.thumbnail_url ? <img src={session.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(session.thumbnail_url)} /> : <LiveIcon size={48} className="text-muted" />}
    <span className={'absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-bold tracking-wide ' + (session.state === 'live' ? 'bg-red-600 text-white' : 'bg-[var(--canvas)] text-ink')}>{liveStateLabel(session)}</span>
    {session.state === 'live' && session.viewer_count !== null ? <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs text-white"><Users size={12} />{session.viewer_count.toLocaleString()} watching</span> : null}
  </div>;
}
export function LiveDirectoryView() {
  const [supabase] = useState(createClient), [navigation] = useState(getNavigationStore);
  const identity = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const [filter, setFilter] = useState<LiveFilter>('for_you');
  const [view, setView] = useState<LiveView>('live');
  const [topic, setTopic] = useState('all');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const request = useRef(0), lock = useRef(false);
  const key = `${identity.scope}:${filter}:${view}:${topic}`;
  const keyRef = useRef(key); keyRef.current = key;
  const [state, setState] = useState<State>({ key: '', items: [], cursor: null, capabilities: NO_LIVE_CAPABILITIES, loading: false, error: null, setup: false });
  const load = useCallback(async (cursor: LiveCursor | null = null) => {
    if (!identity.owner || !identity.initialized || (cursor && lock.current)) return;
    const version = ++request.current;
    lock.current = true;
    setState(previous => ({ key, items: cursor && previous.key === key ? previous.items : [], cursor: null,
      capabilities: previous.key === key ? previous.capabilities : NO_LIVE_CAPABILITIES, loading: true, error: null, setup: false }));
    try {
      const { data, error } = await withTimeout(supabase.rpc('live_directory', { p_filter: filter, p_topic: topic === 'all' ? null : topic, p_state: view, p_cursor: cursor, p_limit: 24 }));
      if (error) {
        if (isLiveSetupMissing(error)) {
          if (version === request.current && keyRef.current === key) setState({ key, items: [], cursor: null, capabilities: NO_LIVE_CAPABILITIES, loading: false, error: null, setup: true });
          return;
        }
        throw error;
      }
      const page = parseLiveDirectory(data);
      const covers = page.items.filter(item => item.has_cover).map(item => item.id);
      if (covers.length) {
        try {
          const { data: signed, error: coverError } = await withTimeout(supabase.functions.invoke('live-cover', { body: { action: 'read', sessionIds: covers } }), 4000);
          if (!coverError && Array.isArray(signed?.items)) {
            const urls = new Map(signed.items.slice(0,24).map((item: { session_id: string; thumbnail_url: string }) => [item.session_id, safeLiveImage(item.thumbnail_url)]));
            page.items.forEach(item => { if (urls.has(item.id)) item.thumbnail_url = urls.get(item.id) as string | null; });
          }
        } catch { /* A cover must never block the directory or expose a public URL. */ }
      }
      if (version !== request.current || keyRef.current !== key) return;
      setState(previous => {
        const prior = cursor && previous.key === key ? previous.items : [];
        const known = new Set(prior.map(item => item.id));
        return { key, items: [...prior, ...page.items.filter(item => !known.has(item.id))].slice(-96), cursor: page.next_cursor,
          capabilities: page.capabilities, loading: false, error: null, setup: false };
      });
    } catch {
      if (version === request.current && keyRef.current === key) setState(previous => ({ ...previous, loading: false, cursor, error: 'Live streams could not load. Please try again.' }));
    } finally { if (version === request.current) lock.current = false; }
  }, [supabase, identity.owner, identity.initialized, key, filter, topic, view]);
  useEffect(() => { void load(); return () => { request.current++; lock.current = false; }; }, [load, revision]);
  const current = state.key === key ? state : { ...state, items: [], cursor: null, capabilities: NO_LIVE_CAPABILITIES, loading: !!identity.owner, error: null, setup: false };
  const items = current.items.filter(item => `${item.title} ${item.host.full_name ?? ''} ${item.host.username ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="mx-auto max-w-6xl pb-24" data-live-directory>
    <nav aria-label="Feed destinations" className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-ink/10 pb-1">
      <Link href="/home?feed=for_you" className="min-w-0 flex-1 whitespace-nowrap px-1 py-3 text-center text-[13px] text-muted sm:flex-none sm:px-3 sm:text-sm">For You</Link>
      <Link href="/home?feed=latest" className="min-w-0 flex-1 whitespace-nowrap px-1 py-3 text-center text-[13px] text-muted sm:flex-none sm:px-3 sm:text-sm">Latest</Link>
      <Link href="/discover" className="min-w-0 flex-1 whitespace-nowrap px-1 py-3 text-center text-[13px] text-muted sm:flex-none sm:px-3 sm:text-sm">Discover</Link>
      <Link href="/home?feed=trending" className="min-w-0 flex-1 whitespace-nowrap px-1 py-3 text-center text-[13px] text-muted sm:flex-none sm:px-3 sm:text-sm">Trending</Link><LiveEntry active />
    </nav>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted"><LiveIcon size={17} />Platinum Live</div><h1 className="text-3xl font-semibold tracking-tight text-ink">Live streams</h1><p className="mt-2 max-w-xl text-sm text-muted">Creators, conversations and events. Find your people, live.</p></div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Link href="/live/new" className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-[var(--canvas)] sm:flex-none"><LiveIcon size={20} />Start live</Link>
        <Link href="/live/new?mode=schedule" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-ink/15 px-4 text-sm font-semibold text-ink"><CalendarDays size={18} />Schedule</Link>
        <details className="relative"><summary aria-label="Your Live tools" className="grid min-h-12 min-w-11 cursor-pointer list-none place-items-center rounded-xl text-ink hover:bg-surface [&::-webkit-details-marker]:hidden"><MoreHorizontal size={22} /></summary><div className="absolute right-0 top-full z-20 mt-2 min-w-44 rounded-xl border border-ink/15 bg-[var(--canvas)] p-2 shadow-lg"><Link href="/live/clips" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface">Clip library</Link><button type="button" onClick={event => { setFilter('mine'); setView('live'); event.currentTarget.closest('details')?.removeAttribute('open'); }} className="flex min-h-11 w-full items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface">My streams</button></div></details>
      </div>
    </header>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-3">
      <div className="flex gap-1" aria-label="Broadcast status">{views.map(([id,label]) => <button type="button" key={id} onClick={() => setView(id)} aria-pressed={view === id} className={'min-h-11 px-3 text-sm ' + (view === id ? 'font-semibold text-ink underline decoration-pearl decoration-2 underline-offset-8' : 'text-muted')}>{label}</button>)}</div>
      <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-surface px-3"><Search size={16} className="text-muted" /><input value={query} onChange={e => setQuery(e.target.value)} aria-label="Filter loaded streams" placeholder="Filter loaded streams" maxLength={120} className="w-40 min-w-0 bg-transparent text-sm text-ink outline-none sm:w-48" /></label>
    </div>
    <div className="mb-6 flex items-center gap-2" aria-label="Stream filters">
      <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">People and relationships</span><select value={filter} onChange={event => setFilter(event.target.value as LiveFilter)} className="min-h-11 w-full rounded-lg border border-ink/15 bg-[var(--canvas)] pl-3 pr-7 text-sm text-ink sm:w-40">{relations.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Live topics</span><select value={topic} onChange={event => setTopic(event.target.value)} className="min-h-11 w-full rounded-lg border border-ink/15 bg-[var(--canvas)] pl-3 pr-7 text-sm text-ink sm:w-44">{LIVE_TOPICS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <button type="button" aria-label="Refresh live streams" disabled={current.loading} onClick={() => setRevision(v => v+1)} className="ml-auto grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface disabled:opacity-50"><RefreshCw size={18} className={current.loading ? 'animate-spin motion-reduce:animate-none' : ''} /></button>
    </div>
    {!identity.initialized ? <p role="status" className="py-16 text-center text-muted">Loading your live directory…</p> : !identity.owner ? <section className="rounded-2xl border border-ink/10 p-10 text-center"><h2 className="text-xl font-semibold text-ink">Join the conversation</h2><p className="my-3 text-sm text-muted">Sign in to find people you follow and discover live streams.</p><Link href="/login?next=%2Flive" className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm text-[var(--canvas)]">Sign in</Link></section> : <>
      {current.setup || (!current.loading && !current.error && !current.capabilities.broadcast) ? <div role="status" className="mb-5 rounded-xl border border-ink/10 bg-surface p-4 text-sm text-ink"><p className="font-semibold">Broadcasting is not connected yet</p><p className="mt-1 text-muted">The Live page is available. Starting and watching broadcasts will open when the video service is connected.</p></div> : null}
      {current.error ? <div role="alert" className="mb-4 rounded-xl border border-ink/10 p-4 text-sm text-ink">{current.error}<button type="button" className="ml-3 min-h-11 font-semibold underline" onClick={() => void load(current.cursor)}>Try again</button></div> : null}
      {current.loading && !items.length ? <div aria-label="Loading streams" role="status" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0,1,2].map(id => <div key={id} className="animate-pulse motion-reduce:animate-none"><div className="aspect-video rounded-xl bg-surface" /><div className="mt-3 h-4 w-2/3 rounded bg-surface" /></div>)}</div> : items.length ? <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">{items.map(session => <Link href={'/live/' + session.id} key={session.id} className="group min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4">
        <Thumbnail session={session} /><div className="mt-3"><h2 className="line-clamp-2 text-base font-semibold text-ink group-hover:underline">{session.title}</h2><p className="mt-1 truncate text-sm text-muted">{session.host.full_name || session.host.username || 'Creator'}{session.host.is_verified ? <span aria-label="Verified identity" className="ml-1 text-ink">✓</span> : null}</p><p className="mt-1 text-xs capitalize text-muted">{session.topic} · {session.language}{session.audience !== 'public' ? ' · ' + session.audience : ''}</p>{session.state === 'scheduled' && session.scheduled_at ? <p className="mt-2 flex items-center gap-1 text-xs text-muted"><CalendarDays size={13} />{new Date(session.scheduled_at).toLocaleString()}</p> : null}</div>
      </Link>)}</div> : !current.error ? <section className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 px-6 py-12 text-center"><LiveIcon size={40} className="mb-4 text-muted" /><h2 className="text-lg font-semibold text-ink">{query ? 'No matching streams on this page' : view === 'scheduled' ? 'No upcoming streams here yet' : view === 'replay' ? 'No replays here yet' : 'No live streams here yet'}</h2><p className="mt-2 max-w-md text-sm text-muted">{filter === 'following' ? 'Streams from people you follow will appear here.' : filter === 'followers' ? 'Streams hosted by your followers will appear here.' : 'Explore another topic or check back for a live session.'}</p></section> : null}
      {current.cursor ? <div className="mt-6 text-center"><button type="button" disabled={current.loading} onClick={() => void load(current.cursor)} className="min-h-11 rounded-full border border-ink/15 px-6 text-sm font-semibold text-ink">{current.loading ? 'Loading…' : 'Load more streams'}</button></div> : null}
    </>}
  </div>;
}
