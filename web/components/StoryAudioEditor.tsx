'use client';
import { MUSIC_CATALOG_ENABLED } from '../../shared/musicAvailability';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Music2, Pause, Play, Search, Upload } from 'lucide-react';
import { listStorySounds, storyAudioPreview, uploadStoryAudio, type StoryAudioDraft, type StorySound } from '@/lib/storyAudio';
import studio from './StoryStudio.module.css';

type StoryAudioEditorProps = {
  owner: string; value: StoryAudioDraft | null; onChange: (audio: StoryAudioDraft | null) => void;
  mix: { orig?: number; music?: number }; onMixChange: (mix: { orig?: number; music?: number }) => void;
  isVideo: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
};

export function StoryAudioEditor(props: StoryAudioEditorProps) {
  if (MUSIC_CATALOG_ENABLED) return <EnabledStoryAudioEditor {...props} />;
  if (!props.isVideo) return null;
  return <section className={studio.musicStudio} aria-label="Original video sound"><div className={studio.musicMix}><label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={props.mix.orig ?? 100} disabled={props.disabled} onChange={event => props.onMixChange({ ...props.mix, orig: Number(event.target.value) })} /></label></div></section>;
}

function EnabledStoryAudioEditor({ owner, value, onChange, mix, onMixChange, isVideo, disabled, onBusyChange }: StoryAudioEditorProps) {
  const [loading, setLoading] = useState(false), [rows, setRows] = useState<StorySound[]>([]), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [attested, setAttested] = useState(false), [url, setUrl] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'foryou' | 'saved' | 'browse'>('foryou'), [query, setQuery] = useState(''), [saved, setSaved] = useState<string[]>([]), [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<{ audio: StoryAudioDraft; url: string } | null>(null), [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null), generation = useRef(0), previewGeneration = useRef(0), input = useRef<HTMLInputElement | null>(null), operation = useRef(false);
  const playable = preview?.audio || value;
  const storageKey = 'pc.story.sounds.saved.v1:' + owner;
  useEffect(() => {
    generation.current++; previewGeneration.current++; setUrl(null); setRows([]); setAttested(false); setPreview(null); setQuery('');
    try { const items: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]'); setSaved(Array.isArray(items) ? items.filter((id): id is string => typeof id === 'string').slice(0, 200) : []); } catch { setSaved([]); }
    return () => { generation.current++; previewGeneration.current++; audioRef.current?.pause(); };
  }, [owner, storageKey]);
  useEffect(() => {
    let alive = true; setLoading(true);
    void listStorySounds().then(data => { if (alive) { setRows(data); setError(null); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [owner, retry]);
  useEffect(() => {
    let alive = true, request = 0; setUrl(null); setPreview(null); previewGeneration.current++; audioRef.current?.pause();
    const load = async () => { const id = ++request; if (!value) return; try { const next = await storyAudioPreview(value); if (alive && id === request) { setUrl(next); setError(next ? null : 'Sound is unavailable. Choose another recording.'); } } catch(e) { if (alive && id === request) { setUrl(null); setError(e instanceof Error ? e.message : 'Sound could not load.'); } } };
    void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 240000);
    return () => { alive = false; request++; clearInterval(timer); };
  }, [value, retry, owner]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, (mix.music ?? 100) / 100)); }, [mix.music, url, preview]);
  useEffect(() => { if (preview?.url) void audioRef.current?.play().catch(() => setPlaying(false)); }, [preview]);
  useEffect(() => {
    const pause = () => { if (document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') { previewGeneration.current++; audioRef.current?.pause(); } };
    const stop = () => { previewGeneration.current++; audioRef.current?.pause(); };
    if (disabled) stop(); pause(); window.addEventListener('platinum:stop-media', stop); document.addEventListener('visibilitychange', pause);
    return () => { document.removeEventListener('visibilitychange', pause); window.removeEventListener('platinum:stop-media', stop); };
  }, [disabled]);
  const draftFor = (row: StorySound): StoryAudioDraft => ({ kind: 'sound', soundId: row.id, title: row.title, durationSec: row.duration_sec });
  async function previewSound(row: StorySound) {
    if (busy || disabled) return;
    if (preview?.audio.soundId === row.id && playing) { audioRef.current?.pause(); return; }
    const current = generation.current, request = ++previewGeneration.current; audioRef.current?.pause(); setError(null);
    try { const audio = draftFor(row), next = await storyAudioPreview(audio); if (current !== generation.current || request !== previewGeneration.current) return; if (!next) throw new Error('This sound is unavailable.'); setPreview({ audio, url: next }); }
    catch (failure) { if (current === generation.current && request === previewGeneration.current) setError(failure instanceof Error ? failure.message : 'Sound could not play.'); }
  }
  async function selectSound(row: StorySound) {
    if (operation.current || disabled) return;
    operation.current = true; const current = generation.current; setBusy(true); onBusyChange(true); audioRef.current?.pause();
    try { const audio = draftFor(row); if (!await storyAudioPreview(audio)) throw new Error('This sound is unavailable.'); if (current === generation.current) onChange(audio); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Sound could not be selected.'); }
    finally { operation.current = false; if (current === generation.current) { setBusy(false); onBusyChange(false); } }
  }
  async function upload(file?: File) {
    if (!file || !attested || operation.current || disabled) return;
    operation.current = true; const current = generation.current; setBusy(true); onBusyChange(true); setError(null); audioRef.current?.pause();
    try { const next = await uploadStoryAudio(file, owner); if (current === generation.current) { onChange(next); setUploadOpen(false); } }
    catch(e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Sound could not upload.'); }
    finally { operation.current = false; if (current === generation.current) { setBusy(false); onBusyChange(false); } }
  }
  const toggleSaved = (id: string) => setSaved(current => { const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id].slice(-200); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} return next; });
  const visibleRows = rows.filter(row => (tab !== 'saved' || saved.includes(row.id)) && row.title.toLowerCase().includes(query.toLowerCase())).sort((a,b) => tab === 'browse' ? a.title.localeCompare(b.title) : 0);
  return <section className={studio.musicStudio} aria-label="Story sound">
    <label className={studio.search}><Search size={18} /><input aria-label="Search story sounds" placeholder="Search music and original audio" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div role="tablist" aria-label="Sound collection" className={studio.tabs}>{([['foryou','For you'],['saved','Saved'],['browse','Browse']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={studio.tab} onClick={() => setTab(id)}>{label}</button>)}</div>
    {value ? <div className={studio.currentSound}><Music2 size={20} /><span><strong>{value.title}</strong><small>Added to this clip</small></span><button type="button" className={studio.button} disabled={disabled || busy} onClick={() => onChange(null)}>Remove</button></div> : null}
    <audio ref={audioRef} src={preview?.url || url || undefined} controls={!!playable} className={studio.musicPlayer} onTimeUpdate={event => { if (playable?.durationSec && event.currentTarget.currentTime >= playable.durationSec) { event.currentTarget.pause(); event.currentTarget.currentTime = 0; } }} onSeeking={event => { if (playable?.durationSec && event.currentTarget.currentTime >= playable.durationSec) event.currentTarget.currentTime = 0; }} onPlay={() => { if (disabled || document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') audioRef.current?.pause(); else setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (playable) setError('Sound could not play. Retry to refresh it.'); }} />
    {preview ? <p className={studio.note}>Previewing {preview.audio.title}</p> : null}
    <div className={studio.musicList}>{visibleRows.map(row => <div key={row.id} className={studio.musicRow}><button type="button" aria-label={`Preview ${row.title}`} disabled={busy || disabled} className={studio.musicArtwork} onClick={() => void previewSound(row)}>{preview?.audio.soundId === row.id && playing ? <Pause size={20} /> : <Play size={20} />}</button><span><strong>{row.title}</strong><small>{row.source === 'original' ? 'Original audio' : 'Approved sound'} · {row.duration_sec}s</small></span><button type="button" aria-label={`${saved.includes(row.id) ? 'Unsave' : 'Save'} ${row.title}`} aria-pressed={saved.includes(row.id)} className={studio.musicSave} onClick={() => toggleSaved(row.id)}><Bookmark size={18} fill={saved.includes(row.id) ? 'currentColor' : 'none'} /></button><button type="button" className={studio.musicUse} disabled={busy || disabled} onClick={() => void selectSound(row)}>{value?.soundId === row.id ? <Check size={17} /> : 'Use'}</button></div>)}
      {!visibleRows.length ? <p className={studio.empty}>{loading ? 'Loading sounds…' : error ? 'The sound list could not load.' : query ? 'No sounds match your search.' : tab === 'saved' ? 'Save a sound to find it here.' : 'No approved sounds are available yet. Add your own original recording.'}</p> : null}
    </div>
    <button type="button" className={`${studio.button} ${studio.musicUpload}`} onClick={() => setUploadOpen(open => !open)}><Upload size={17} />Your original audio</button>
    {uploadOpen ? <div className={studio.musicOriginal}><p className={studio.note}>Upload a recording you own, between 1 and 30 seconds.</p><label><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} disabled={busy || disabled} />I own this recording and have permission to publish its music, voice and other content.</label><input ref={input} hidden type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file); }} /><button type="button" className={studio.primary} disabled={!attested || busy || disabled} onClick={() => input.current?.click()}>{busy ? 'Uploading recording…' : 'Choose recording'}</button></div> : null}
    {value?.kind === 'voiceover' ? <label className={studio.musicConsent}><input type="checkbox" checked={!!value.addToSounds} onChange={e => onChange({ ...value, addToSounds: e.target.checked })} disabled={disabled || busy} />Allow others to reuse this original recording</label> : null}
    {(value || isVideo) && <div className={studio.musicMix}>{isVideo && <label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={mix.orig ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, orig: Number(e.target.value) })} /></label>}{value && <label>Added sound<input aria-label="Added sound volume" type="range" min="0" max="100" value={mix.music ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, music: Number(e.target.value) })} /></label>}</div>}
    {error && <p role="alert" className={studio.musicError}>{error} <button type="button" onClick={() => { setPreview(null); setRetry(n => n + 1); }}>Retry</button></p>}
  </section>;
}
