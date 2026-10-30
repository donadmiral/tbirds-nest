'use client';
import { ORIGINAL_AUDIO_ENABLED } from '../../shared/musicAvailability';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bookmark, Check, Music2, Pause, Play, Search } from 'lucide-react';
import { listStorySounds, storyAudioPreview, type StoryAudioDraft, type StorySound } from '@/lib/storyAudio';
import { OriginalAudioUpload } from './OriginalAudioUpload';
import { soundFavorites, saveSoundFavorite } from '@/lib/originalAudio';
import { createClient } from '@/lib/supabase/client';
import { getSoundtrack, listSoundtracks } from '@/lib/soundtrack';
import { loadSoundtrackChoices, soundtrackRead } from '../../shared/soundtrackPicker';
import studio from './StoryStudio.module.css';

type StoryAudioEditorProps = {
  owner: string; value: StoryAudioDraft | null; onChange: (audio: StoryAudioDraft | null) => void;
  mix: { orig?: number; music?: number }; onMixChange: (mix: { orig?: number; music?: number }) => void;
  isVideo: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
};
type EditorSound = Omit<StorySound, 'rights_status'>;

export function StoryAudioEditor(props: StoryAudioEditorProps) {
  if (ORIGINAL_AUDIO_ENABLED) return <EnabledStoryAudioEditor key={props.owner} {...props} />;
  if (!props.isVideo) return null;
  return <section className={studio.musicStudio} aria-label="Original video sound"><div className={studio.musicMix}><label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={props.mix.orig ?? 100} disabled={props.disabled} onChange={event => props.onMixChange({ ...props.mix, orig: Number(event.target.value) })} /></label></div></section>;
}

function EnabledStoryAudioEditor({ owner, value, onChange, mix, onMixChange, isVideo, disabled, onBusyChange }: StoryAudioEditorProps) {
  const [loading, setLoading] = useState(false), [rows, setRows] = useState<EditorSound[]>([]), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [url, setUrl] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'foryou' | 'saved' | 'browse'>('foryou'), [query, setQuery] = useState(''), [saved, setSaved] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ audio: StoryAudioDraft; url: string } | null>(null), [playing, setPlaying] = useState(false);
  const [client] = useState(() => createClient());
  const [savedReady, setSavedReady] = useState(false), [saving, setSaving] = useState(false), [savedError, setSavedError] = useState(''), [savedRetry, setSavedRetry] = useState(0);
  const [savedRows, setSavedRows] = useState<EditorSound[]>([]), [savedRowsLoading, setSavedRowsLoading] = useState(false), [savedRowsError, setSavedRowsError] = useState('');
  const [accountError, setAccountError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null), generation = useRef(0), previewGeneration = useRef(0), operation = useRef<object | null>(null), active = useRef(false);
  const savedRef = useRef<string[]>([]), savedLoaded = useRef(false), saveLock = useRef<object | null>(null), pendingWrites = useRef(new Set<Promise<void>>());
  const isCurrent = useCallback((mine: number) => active.current && generation.current === mine, []);
  const invalidate = useCallback(() => { active.current = false; generation.current++; previewGeneration.current++; savedLoaded.current = false; operation.current = null; }, []);
  const playable = preview?.audio || value;
  useLayoutEffect(() => {
    active.current = true; generation.current++; previewGeneration.current++; savedLoaded.current = false;
    const node = audioRef.current;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (active.current && (event === 'SIGNED_OUT' || session?.user.id !== owner)) {
        active.current = false; generation.current++; previewGeneration.current++; savedLoaded.current = false; operation.current = null;
        node?.pause(); setPreview(null); setUrl(null); setRows([]); setSavedRows([]); setSavedReady(false);
        setAccountError('The account changed. Reopen sound controls for the current account.');
      }
    });
    return () => { invalidate(); subscription.unsubscribe(); node?.pause(); };
  }, [owner, client, invalidate]);
  useEffect(() => {
    let live = true; const mine = generation.current; savedLoaded.current = false;
    queueMicrotask(() => { if (live && isCurrent(mine)) { setSavedReady(false); setSavedError(''); } });
    void Promise.allSettled([...pendingWrites.current]).then(() => live && isCurrent(mine) ? soundFavorites(owner, client) : null).then(ids => {
      if (ids && live && isCurrent(mine)) { savedRef.current = ids; savedLoaded.current = true; setSaved(ids); setSavedReady(true); }
    }).catch(() => { if (live && isCurrent(mine)) setSavedError('Saved sounds could not load. Retry to check your saved selection.'); });
    return () => { live = false; };
  }, [owner, savedRetry, client, isCurrent]);
  useEffect(() => {
    let alive = true; const mine = generation.current; queueMicrotask(()=>{if(alive && isCurrent(mine))setLoading(true);});
    void soundtrackRead(listStorySounds(client)).then(data => { if (alive && isCurrent(mine)) { setRows(data); setError(null); } }).catch(e => { if (alive && isCurrent(mine)) setError(e instanceof Error ? e.message : 'Sounds could not load.'); }).finally(() => { if (alive && isCurrent(mine)) setLoading(false); });
    return () => { alive = false; };
  }, [owner, retry, client, isCurrent]);
  useEffect(() => {
    if (tab !== 'saved' || !savedReady) return;
    let live = true; const mine = generation.current;
    queueMicrotask(() => { if (live && isCurrent(mine)) { setSavedRowsLoading(true); setSavedRowsError(''); } });
    // Saved preferences may lie outside the first page of the browse library.
    // Resolve every ID independently and recheck its current story permission.
    void loadSoundtrackChoices('story', '', 'Saved', saved, listSoundtracks, getSoundtrack, () => {
      if (live && isCurrent(mine)) setSavedRowsError('Some saved sounds could not be checked. Retry to refresh their availability.');
    }).then(data => {
      if (live && isCurrent(mine)) setSavedRows(data);
    }).catch(() => { if (live && isCurrent(mine)) setSavedRowsError('Saved sounds could not be checked. Retry.'); })
      .finally(() => { if (live && isCurrent(mine)) setSavedRowsLoading(false); });
    return () => { live = false; };
  }, [tab, saved, savedReady, retry, isCurrent]);
  useEffect(() => {
    let alive = true, request = 0; const mine = generation.current; previewGeneration.current += 1; audioRef.current?.pause();queueMicrotask(()=>{if(alive&&isCurrent(mine)){setUrl(null);setPreview(null);}});
    const load = async () => { const id = ++request; if (!value || !isCurrent(mine)) return; try { const next = await soundtrackRead(storyAudioPreview(value, client)); if (alive && isCurrent(mine) && id === request) { setUrl(next); setError(next ? null : 'Sound is unavailable. Choose another recording.'); } } catch(e) { if (alive && isCurrent(mine) && id === request) { setUrl(null); setError(e instanceof Error ? e.message : 'Sound could not load.'); } } };
    void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 240000);
    return () => { alive = false; request++; clearInterval(timer); };
  }, [value, retry, owner, client, isCurrent]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, (mix.music ?? 100) / 100)); }, [mix.music, url, preview]);
  useEffect(() => { const mine=generation.current;let live=true;if (preview?.url&&isCurrent(mine)) void audioRef.current?.play().catch(() => {if(live&&isCurrent(mine))setPlaying(false);});return()=>{live=false;}; }, [preview,isCurrent]);
  useEffect(() => {
    const pause = () => { if (document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') { previewGeneration.current += 1; audioRef.current?.pause(); } };
    const stop = () => { previewGeneration.current += 1; audioRef.current?.pause(); };
    if (disabled) stop(); pause(); window.addEventListener('platinum:stop-media', stop); document.addEventListener('visibilitychange', pause);
    return () => { document.removeEventListener('visibilitychange', pause); window.removeEventListener('platinum:stop-media', stop); };
  }, [disabled]);
  const draftFor = (row: EditorSound): StoryAudioDraft => ({ kind: 'sound', soundId: row.id, title: row.title, durationSec: Math.min(30, row.duration_sec, row.max_excerpt_sec || 30), startSec: 0 });
  async function previewSound(row: EditorSound) {
    if (!isCurrent(generation.current) || operation.current || busy || disabled) return;
    if (preview?.audio.soundId === row.id && playing) { audioRef.current?.pause(); return; }
    const current = generation.current, request = ++previewGeneration.current; audioRef.current?.pause(); setError(null);
    try { const audio = draftFor(row), next = await soundtrackRead(storyAudioPreview(audio, client)); if (!isCurrent(current) || request !== previewGeneration.current) return; if (!next) throw new Error('This sound is unavailable.'); setPreview({ audio, url: next }); }
    catch (failure) { if (isCurrent(current) && request === previewGeneration.current) setError(failure instanceof Error ? failure.message : 'Sound could not play.'); }
  }
  async function selectSound(row: EditorSound) {
    if (!isCurrent(generation.current) || operation.current || disabled) return;
    const token={};operation.current = token; const current = generation.current; setBusy(true); onBusyChange(true); audioRef.current?.pause();
    try { const audio = draftFor(row); if (!await soundtrackRead(storyAudioPreview(audio, client))) throw new Error('This sound is unavailable.'); if (isCurrent(current) && operation.current===token) onChange(audio); }
    catch (failure) { if (isCurrent(current) && operation.current===token) setError(failure instanceof Error ? failure.message : 'Sound could not be selected.'); }
    finally { if(operation.current===token){operation.current = null; if (isCurrent(current)) { setBusy(false); onBusyChange(false); } } }
  }
  const toggleSaved = async(id: string) => {
    const mine=generation.current;if(!isCurrent(mine)||disabled||!savedLoaded.current||saveLock.current)return;
    const token={},next=!savedRef.current.includes(id);saveLock.current=token;setSaving(true);setSavedError('');
    const work=saveSoundFavorite(id,next,owner,client);pendingWrites.current.add(work);
    try{await work;if(isCurrent(mine)&&saveLock.current===token){savedRef.current=next?[...savedRef.current.filter(item=>item!==id),id]:savedRef.current.filter(item=>item!==id);setSaved(savedRef.current);}}
    catch{if(isCurrent(mine)&&saveLock.current===token){savedLoaded.current=false;setSavedReady(false);setSavedError('The saved selection could not be confirmed. Retry to check its status.');}}
    finally{pendingWrites.current.delete(work);if(saveLock.current===token){saveLock.current=null;if(isCurrent(mine))setSaving(false);}}
  };
  const visibleRows = (tab==='saved'?(savedReady?savedRows:[]):rows).filter(row => row.title.toLowerCase().includes(query.toLowerCase())).sort((a,b) => tab === 'browse' ? a.title.localeCompare(b.title) : 0);
  return <section className={studio.musicStudio} aria-label="Story sound">
    <label className={studio.search}><Search size={18} /><input aria-label="Search story sounds" placeholder="Search music and original audio" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div role="tablist" aria-label="Sound collection" className={studio.tabs}>{([['foryou','For you'],['saved','Saved'],['browse','Browse']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={studio.tab} onClick={() => setTab(id)}>{label}</button>)}</div>
    {value ? <div className={studio.currentSound}><Music2 size={20} /><span><strong>{value.title}</strong><small>Added to this clip</small></span><button type="button" className={studio.button} disabled={disabled || busy || !!accountError} onClick={() => {if(isCurrent(generation.current))onChange(null);}}>Remove</button></div> : null}
    <audio ref={audioRef} src={preview?.url || url || undefined} controls={!!playable} className={studio.musicPlayer} onTimeUpdate={event => { if (playable?.durationSec && event.currentTarget.currentTime >= (playable.startSec||0)+playable.durationSec) { event.currentTarget.pause(); event.currentTarget.currentTime = playable?.startSec||0; } }} onSeeking={event => { if (playable?.durationSec && event.currentTarget.currentTime >= (playable.startSec||0)+playable.durationSec) event.currentTarget.currentTime = playable?.startSec||0; }} onPlay={() => { if(audioRef.current&&playable&&audioRef.current.currentTime<(playable.startSec||0))audioRef.current.currentTime=playable.startSec||0;if (disabled || document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') audioRef.current?.pause(); else setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { if (playable) setError('Sound could not play. Retry to refresh it.'); }} />
    {preview ? <p className={studio.note}>Previewing {preview.audio.title}</p> : null}
    <div className={studio.musicList}>{visibleRows.map(row => <div key={row.id} className={studio.musicRow}><button type="button" aria-label={`Preview ${row.title}`} disabled={busy || disabled || !!accountError} className={studio.musicArtwork} onClick={() => void previewSound(row)}>{preview?.audio.soundId === row.id && playing ? <Pause size={20} /> : <Play size={20} />}</button><span><strong>{row.title}</strong><small>{row.source === 'original' ? 'Original audio' : 'Approved sound'} · {row.duration_sec}s</small></span><button type="button" aria-label={`${saved.includes(row.id) ? 'Unsave' : 'Save'} ${row.title}`} aria-pressed={saved.includes(row.id)} className={studio.musicSave} disabled={disabled || !!accountError || !savedReady || saving} onClick={() => toggleSaved(row.id)}><Bookmark size={18} fill={saved.includes(row.id) ? 'currentColor' : 'none'} /></button><button type="button" className={studio.musicUse} disabled={busy || disabled || !!accountError} onClick={() => void selectSound(row)}>{value?.soundId === row.id ? <Check size={17} /> : 'Use'}</button></div>)}
      {!visibleRows.length ? <p className={studio.empty}>{(tab==='saved'?(!savedReady||savedRowsLoading):loading) ? 'Loading sounds…' : (tab==='saved'?savedRowsError:error) ? 'The sound list could not load.' : query ? 'No sounds match your search.' : tab === 'saved' ? 'Save a sound to find it here.' : 'No approved sounds are available yet. Add your own original recording.'}</p> : null}
    </div>
    <OriginalAudioUpload owner={owner} disabled={disabled||busy||!!accountError} onBusyChange={next=>{if(isCurrent(generation.current))onBusyChange(next);}} onAdded={track=>{if(!isCurrent(generation.current))return;setRows(previous=>[{...track,rights_status:'creator_attested'},...previous.filter(row=>row.id!==track.id)]);onChange({kind:'sound',soundId:track.id,title:track.title,durationSec:Math.min(30,track.duration_sec),startSec:0});}}/>
    {value&&rows.some(row=>row.id===value.soundId)?<div className={studio.musicMix}>
      <label>Excerpt start<input aria-label="Music excerpt start" type="range" min="0" max={Math.max(0,(rows.find(row=>row.id===value.soundId)?.duration_sec||value.durationSec)-value.durationSec)} step="0.1" value={value.startSec||0} disabled={disabled||busy||!!accountError} onChange={event=>onChange({...value,startSec:Number(event.target.value)})}/><output>{(value.startSec||0).toFixed(1)}s</output></label>
      <label>Excerpt length<input aria-label="Music excerpt length" type="range" min="1" max={Math.min(30,rows.find(row=>row.id===value.soundId)?.max_excerpt_sec||30,(rows.find(row=>row.id===value.soundId)?.duration_sec||value.durationSec)-(value.startSec||0))} step="0.1" value={value.durationSec} disabled={disabled||busy||!!accountError} onChange={event=>onChange({...value,durationSec:Number(event.target.value)})}/><output>{value.durationSec.toFixed(1)}s</output></label>
    </div>:null}
    {(value || isVideo) && <div className={studio.musicMix}>{isVideo && <label>Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={mix.orig ?? 100} disabled={disabled || busy || !!accountError} onChange={e => onMixChange({ ...mix, orig: Number(e.target.value) })} /></label>}{value && <label>Added sound<input aria-label="Added sound volume" type="range" min="0" max="100" value={mix.music ?? 100} disabled={disabled || busy || !!accountError} onChange={e => onMixChange({ ...mix, music: Number(e.target.value) })} /></label>}</div>}
    {accountError ? <p role="alert" className={studio.musicError}>{accountError}</p> : null}
    {savedError ? <p role="alert" className={studio.musicError}>{savedError} <button type="button" disabled={!!accountError} onClick={()=>{savedLoaded.current=false;setSavedReady(false);setSavedRetry(n=>n+1);}}>Check saved status</button></p> : null}
    {savedRowsError && tab==='saved' ? <p role="alert" className={studio.musicError}>{savedRowsError} <button type="button" disabled={!!accountError} onClick={()=>setRetry(n=>n+1)}>Retry saved sounds</button></p> : null}
    {error && <p role="alert" className={studio.musicError}>{error} <button type="button" onClick={() => { setPreview(null); setRetry(n => n + 1); }}>Retry</button></p>}
  </section>;
}
