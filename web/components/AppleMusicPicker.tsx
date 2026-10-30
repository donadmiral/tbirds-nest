'use client';

import { useEffect, useRef, useState } from 'react';
import { appleMusic } from '@/lib/appleMusic';
import { parseAppleMusicLink, type AppleMusicTrack } from '../../shared/appleMusic';
import AppleMusicPlayer from './AppleMusicPlayer';

export default function AppleMusicPicker({ onSelect }: { onSelect: (track: AppleMusicTrack) => void }) {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('zw');
  const [tracks, setTracks] = useState<AppleMusicTrack[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<AppleMusicTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  const parsed = parseAppleMusicLink(query);
  const reset = () => { generation.current += 1; busy.current = false; setLoading(false); setTracks([]); setOffset(null); setSearched(false); setError(''); };
  async function search(more = false) {
    if (busy.current || (!parsed && (query.trim().length < 2 || country.length !== 2))) return;
    const mine = generation.current += 1;
    busy.current = true; setLoading(true); setError('');
    try {
      const result = parsed ? await appleMusic.track(parsed.id, parsed.storefront) : await appleMusic.search(query.trim(), country, more ? offset ?? 0 : 0);
      if (mine !== generation.current) return;
      setTracks(old => [...new Map([...(more ? old : []), ...result.tracks].map(track => [track.id, track])).values()]);
      setOffset(result.nextOffset); setSearched(true);
    } catch (e) { if (mine === generation.current) setError(e instanceof Error ? e.message : 'Could not search Apple Music.'); }
    finally { if (mine === generation.current) { busy.current = false; setLoading(false); } }
  }
  const button = 'min-h-11 rounded-full bg-pearl px-4 text-sm font-semibold text-on-pearl disabled:opacity-50';
  return <div className="space-y-4">
    <p className="text-sm text-muted">Discover and share songs. Apple Music links open separately and do not add a soundtrack to your photos or videos.</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
      <input aria-label="Song, artist or Apple Music song link" className="min-h-11 min-w-40 flex-1 rounded-xl border border-ink/20 bg-transparent px-3" value={query} onChange={event => { reset(); setQuery(event.target.value); }} placeholder="Song, artist or Apple Music link" maxLength={2048} />
      <label className="flex items-center gap-2 text-sm">Catalog country<input aria-label="Two-letter catalog country" className="min-h-11 w-14 rounded-xl border border-ink/20 bg-transparent px-2" value={country} maxLength={2} onChange={event => { reset(); setCountry(event.target.value.replace(/[^a-z]/gi, '').toLowerCase()); }} /></label>
      <button className={button} disabled={loading || (!parsed && (query.trim().length < 2 || country.length !== 2))}>{loading ? 'Searching…' : 'Search'}</button>
    </form>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    {parsed ? <button type="button" className="min-h-11 text-sm font-semibold text-accent" onClick={() => onSelect({ ...parsed, title: 'Apple Music song', artist: '', album: '', artworkUrl: null, explicit: false })}>Share this song link</button> : null}
    {searched && !tracks.length && !loading ? <p role="status" className="text-sm text-muted">No songs found. Try another search or catalog country.</p> : null}
    <ul aria-busy={loading} className="divide-y divide-ink/10">{tracks.map(track => <li key={track.id} className="flex items-center gap-3 py-3">
      {/* Provider artwork is already hostname-validated and may use expiring URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {track.artworkUrl ? <img alt="" src={track.artworkUrl} width={52} height={52} loading="lazy" className="rounded-lg" /> : null}
      <div className="min-w-0 flex-1"><p className="font-semibold">{track.title}{track.explicit ? <span className="ml-2 text-xs text-muted">Explicit</span> : null}</p><p className="text-sm text-muted">{track.artist}</p></div>
      <button type="button" className="min-h-11 px-2 text-sm font-semibold text-accent" onClick={() => setSelected(track)} aria-label={`Listen to ${track.title}`}>Listen</button>
      <button type="button" className={button} onClick={() => onSelect(track)} aria-label={`Share ${track.title}`}>Share</button>
    </li>)}</ul>
    {offset !== null ? <button type="button" className={button} disabled={loading} onClick={() => { void search(true); }}>{loading ? 'Loading…' : 'More songs'}</button> : null}
    {selected ? <AppleMusicPlayer track={selected} /> : null}
  </div>;
}
