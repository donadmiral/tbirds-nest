'use client';
import { ORIGINAL_AUDIO_ENABLED } from '../../shared/musicAvailability';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Music2, Pause, Play, Search } from 'lucide-react';
import { listStorySounds, storyAudioPreview, type StoryAudioDraft, type StorySound } from '@/lib/storyAudio';
import { OriginalAudioUpload } from './OriginalAudioUpload';
import { soundFavorites, saveSoundFavorite } from '@/lib/originalAudio';
import studio from './StoryStudio.module.css';

type StoryAudioEditorProps = {
  owner: string; value: StoryAudioDraft | null; onChange: (audio: StoryAudioDraft | null) => void;
  mix: { orig?: number; music?: number }; onMixChange: (mix: { orig?: number; music?: number }) => void;
  isVideo: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
};

export function StoryAudioEditor(props: StoryAudioEditorProps) {
  if (ORIGINAL_AUDIO_ENABLED) return <EnabledStoryAudioEditor key={props.owner} {...props} />;
  if (!props.isVideo) return null;
  return <section className={studio.musicStudio} aria-label="Original video sound"><div className={studio.musicMix}><label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={props.mix.orig ?? 100} disabled={props.disabled} onChange={event => props.onMixChange({ ...props.mix, orig: Number(event.target.value) })} /></label></div></section>;
}

function EnabledStoryAudioEditor({ owner, value, onChange, mix, onMixChange, isVideo, disabled, onBusyChange }: StoryAudioEditorProps) {
  const [loading, setLoading] = useState(false), [rows, setRows] = useState<StorySound[]>([]), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [url, setUrl] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'foryou' | 'saved' | 'browse'>('foryou'), [query, setQuery] = useState(''), [saved, setSaved] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ audio: StoryAudioDraft; url: string } | null>(null), [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null), generation = useRef(0), previewGeneration = useRef(0), operation = useRef(false);
  const playable = preview?.audio || value;
  useEffect(() => {
    generation.current += 1; previewGeneration.current += 1;
    const current=generation.current;void soundFavorites().then(ids=>{if(current===generation.current)setSaved(ids);}).catch(()=>{if(current===generation.current)setError('Saved sounds could not load. Retry.');});
    const node=audioRef.current;
    return () => { generation.current += 1; previewGeneration.current += 1; node?.pause(); };
  }, [owner, retry]);
  useEffect(() => {
    let alive = true; queueMicrotask(()=>{if(alive)setLoading(true);});
    void listStorySounds().then(data => { if (alive) { setRows(data); setError(null); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [owner, retry]);
  useEffect(() => {
    let alive = true, request = 0; previewGeneration.current += 1; audioRef.current?.pause();queueMicrotask(()=>{if(alive){setUrl(null);setPreview(null);}});
    const load = async () => { const id = ++request; if (!value) return; try { const next = await storyAudioPreview(value); if (alive && id === request) { setUrl(next); setError(next ? null : 'Sound is unavailable. Choose another recording.'); } } catch(e) { if (alive && id === request) { setUrl(null); setError(e instanceof Error ? e.message : 'Sound could not load.'); } } };
    void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 240000);
    return () => { alive = false; request++; clearInterval(timer); };
  }, [value, retry, owner]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, (mix.music ?? 100) / 100)); }, [mix.music, url, preview]);
  useEffect(() => { if (preview?.url) void audioRef.current?.play().catch(() => setPlaying(false)); }, [preview]);
  useEffect(() => {
    const pause = () => { if (document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') { previewGeneration.current += 1; audioRef.current?.pause(); } };
    const stop = () => { previewGeneration.current += 1; audioRef.current?.pause(); };
    if (disabled) stop(); pause(); window.addEventListener('platinum:stop-media', stop); document.addEventListener('visibilitychange', pause);
    return () => { document.removeEventListener('visibilitychange', pause); window.removeEventListener('platinum:stop-media', stop); };
  }, [disabled]);
  const draftFor = (row: StorySound): StoryAudioDraft => ({ kind: 'sound', soundId: row.id, title: row.title, durationSec: Math.min(30, row.duration_sec, row.max_excerpt_sec || 30), startSec: 0 });
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
  const toggleSaved = async(id: string) => { const current=generation.current;try{const next=!saved.includes(id);await saveSoundFavorite(id,next);if(current===generation.current)setSaved(previous=>next?[...previous.filter(item=>item!==id),id]:previous.filter(item=>item!==id));}catch{if(current===generation.current)setError('This sound could not be saved. Retry.');} };
  const visibleRows = rows.filter(row => (tab !== 'saved' || saved.includes(row.id)) && row.title.toLowerCase().includes(query.toLowerCase())).sort((a,b) => tab === 'browse' ? a.title.localeCompare(b.title) : 0);
  return <section className={studio.musicStudio} aria-label="Story sound">
    <label className={studio.search}><Search size={18} /><input aria-label="Search story sounds" placeholder="Search music and original audio" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div role="tablist" aria-label="Sound collection" className={studio.tabs}>{([['foryou','For you'],['saved','Saved'],['browse','Browse']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={studio.tab} onClick={() => setTab(id)}>{label}</button>)}</div>
    {value ? <div className={studio.currentSound}><Music2 size={20} /><span><strong>{value.title}</strong><small>Added to this clip</small></span><button type="button" className={studio.button} disabled={disabled || busy} onClick={() => onChange(null)}>Remove</button></div> : null}
    <audio ref={audioRef} src={preview?.url || url || undefined} controls={!!playable} className={studio.musicPlayer} onTimeUpdate={event => { if (playable?.durationSec && event.currentTarget.currentTime >= (playable.startSec||0)+playable.durationSec) { event.currentTarget.pause(); event.currentTarget.currentTime = playable?.startSec||0; } }} onSeeking={event => { if (playable?.durationSec && event.currentTarget.currentTime >= (playable.startSec||0)+playable.durationSec) event.currentTarget.currentTime = playable?.startSec||0; }} onPlay={() => { if(audioRef.current&&playable&&audioRef.current.currentTime<(playable.startSec||0))audioRef.current.currentTime=playable.startSec||0;if (disabled || document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') audioRef.current?.pause(); else setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (playable) setError('Sound could not play. Retry to refresh it.'); }} />
    {preview ? <p className={studio.note}>Previewing {preview.audio.title}</p> : null}
    <div className={studio.musicList}>{visibleRows.map(row => <div key={row.id} className={studio.musicRow}><button type="button" aria-label={`Preview ${row.title}`} disabled={busy || disabled} className={studio.musicArtwork} onClick={() => void previewSound(row)}>{preview?.audio.soundId === row.id && playing ? <Pause size={20} /> : <Play size={20} />}</button><span><strong>{row.title}</strong><small>{row.source === 'original' ? 'Original audio' : 'Approved sound'} · {row.duration_sec}s</small></span><button type="button" aria-label={`${saved.includes(row.id) ? 'Unsave' : 'Save'} ${row.title}`} aria-pressed={saved.includes(row.id)} className={studio.musicSave} onClick={() => toggleSaved(row.id)}><Bookmark size={18} fill={saved.includes(row.id) ? 'currentColor' : 'none'} /></button><button type="button" className={studio.musicUse} disabled={busy || disabled} onClick={() => void selectSound(row)}>{value?.soundId === row.id ? <Check size={17} /> : 'Use'}</button></div>)}
      {!visibleRows.length ? <p className={studio.empty}>{loading ? 'Loading sounds…' : error ? 'The sound list could not load.' : query ? 'No sounds match your search.' : tab === 'saved' ? 'Save a sound to find it here.' : 'No approved sounds are available yet. Add your own original recording.'}</p> : null}
    </div>
    <OriginalAudioUpload owner={owner} disabled={disabled||busy} onBusyChange={onBusyChange} onAdded={track=>{setRows(previous=>[{...track,rights_status:'creator_attested'},...previous.filter(row=>row.id!==track.id)]);onChange({kind:'sound',soundId:track.id,title:track.title,durationSec:Math.min(30,track.duration_sec),startSec:0});}}/>
    {value&&rows.some(row=>row.id===value.soundId)?<div className={studio.musicMix}>
      <label>Excerpt start<input aria-label="Music excerpt start" type="range" min="0" max={Math.max(0,(rows.find(row=>row.id===value.soundId)?.duration_sec||value.durationSec)-value.durationSec)} step="0.1" value={value.startSec||0} disabled={disabled||busy} onChange={event=>onChange({...value,startSec:Number(event.target.value)})}/><output>{(value.startSec||0).toFixed(1)}s</output></label>
      <label>Excerpt length<input aria-label="Music excerpt length" type="range" min="1" max={Math.min(30,rows.find(row=>row.id===value.soundId)?.max_excerpt_sec||30,(rows.find(row=>row.id===value.soundId)?.duration_sec||value.durationSec)-(value.startSec||0))} step="0.1" value={value.durationSec} disabled={disabled||busy} onChange={event=>onChange({...value,durationSec:Number(event.target.value)})}/><output>{value.durationSec.toFixed(1)}s</output></label>
    </div>:null}
    {(value || isVideo) && <div className={studio.musicMix}>{isVideo && <label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={mix.orig ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, orig: Number(e.target.value) })} /></label>}{value && <label>Added sound<input aria-label="Added sound volume" type="range" min="0" max="100" value={mix.music ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, music: Number(e.target.value) })} /></label>}</div>}
    {error && <p role="alert" className={studio.musicError}>{error} <button type="button" onClick={() => { setPreview(null); setRetry(n => n + 1); }}>Retry</button></p>}
  </section>;
}
