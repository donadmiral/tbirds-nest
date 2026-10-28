'use client';
import { useEffect, useRef, useState } from 'react';
import { listStorySounds, storyAudioPreview, uploadStoryAudio, type StoryAudioDraft, type StorySound } from '@/lib/storyAudio';

export function StoryAudioEditor({ owner, value, onChange, mix, onMixChange, isVideo, disabled, onBusyChange }: {
  owner: string; value: StoryAudioDraft | null; onChange: (audio: StoryAudioDraft | null) => void;
  mix: { orig?: number; music?: number }; onMixChange: (mix: { orig?: number; music?: number }) => void;
  isVideo: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false), [rows, setRows] = useState<StorySound[]>([]), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [attested, setAttested] = useState(false), [url, setUrl] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null), generation = useRef(0), input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { generation.current++; setUrl(null); setRows([]); setAttested(false); return () => { generation.current++; }; }, [owner]);
  useEffect(() => {
    let alive = true;
    if (open) { setLoading(true); void listStorySounds().then(data => { if (alive) { setRows(data); setError(null); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); }
    return () => { alive = false; };
  }, [open, retry]);
  useEffect(() => {
    let alive = true, request = 0; setUrl(null);
    const load = async () => { const id = ++request; if (!value) return; try { const next = await storyAudioPreview(value); if (alive && id === request) { setUrl(next); setError(next ? null : 'Sound is unavailable. Choose another recording.'); } } catch(e) { if (alive && id === request) { setUrl(null); setError(e instanceof Error ? e.message : 'Sound could not load.'); } } };
    void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 240000);
    return () => { alive = false; request++; clearInterval(timer); };
  }, [value, retry, owner]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, (mix.music ?? 100) / 100)); }, [mix.music, url]);
  useEffect(() => { if (disabled || document.hidden) audioRef.current?.pause(); const pause = () => { if (document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') audioRef.current?.pause(); }; const stop = () => audioRef.current?.pause(); window.addEventListener('platinum:stop-media', stop); document.addEventListener('visibilitychange', pause); return () => { document.removeEventListener('visibilitychange', pause); window.removeEventListener('platinum:stop-media', stop); }; }, [disabled]);
  async function upload(file?: File) {
    if (!file || !attested || busy || disabled) return;
    const current = generation.current; setBusy(true); onBusyChange(true); setError(null); audioRef.current?.pause();
    try { const next = await uploadStoryAudio(file, owner); if (current === generation.current) onChange(next); }
    catch(e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Sound could not upload.'); }
    finally { if (current === generation.current) { setBusy(false); onBusyChange(false); } }
  }
  return <section className="mt-3 rounded-xl border border-ink/10 p-3 text-sm text-ink" aria-label="Story sound">
    <div className="flex items-center justify-between gap-2"><span className="font-semibold">{value?.title || 'Story sound'}</span><button type="button" disabled={disabled || busy} className="rounded-lg border border-ink/15 px-3 py-2" onClick={() => setOpen(v => !v)}>{open ? 'Close sounds' : 'Add or change sound'}</button></div>
    {value && <><audio onTimeUpdate={event => { const limit = Number(value.durationSec); if (limit > 0 && event.currentTarget.currentTime >= limit) event.currentTarget.currentTime = 0; }}
      onSeeking={event => { const limit = Number(value.durationSec); if (limit > 0 && event.currentTarget.currentTime >= limit) event.currentTarget.currentTime = 0; }} onPlay={() => { if (disabled || document.hidden || document.documentElement?.dataset?.platinumCallActive === 'true') audioRef.current?.pause(); }} ref={audioRef} src={url ?? undefined} controls className="mt-3 w-full" onError={() => setError('Sound could not play. Retry to refresh it.')} /><button type="button" className="mt-2 underline" disabled={disabled || busy} onClick={() => onChange(null)}>Remove sound</button>
      {value.kind === 'voiceover' && <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={!!value.addToSounds} onChange={e => onChange({ ...value, addToSounds: e.target.checked })} disabled={disabled || busy} />Allow others to reuse this original recording</label>}
    </>}
    {(value || isVideo) && <div className="mt-3 space-y-2">{isVideo && <label className="flex items-center justify-between gap-3">Video sound<input aria-label="Video sound volume" type="range" min="0" max="100" value={mix.orig ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, orig: Number(e.target.value) })} /></label>}{value && <label className="flex items-center justify-between gap-3">Added sound<input aria-label="Added sound volume" type="range" min="0" max="100" value={mix.music ?? 100} disabled={disabled || busy} onChange={e => onMixChange({ ...mix, music: Number(e.target.value) })} /></label>}</div>}
    {open && <div className="mt-4 space-y-3"><p className="text-xs text-muted">Use your own recording, or a sound approved for reuse. Recordings must be 1–30 seconds.</p><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} disabled={busy || disabled} />I own this recording and have permission to publish its music, voice and other content.</label><input ref={input} hidden type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void upload(file); }} /><button type="button" className="rounded-lg border border-ink/15 px-3 py-2 disabled:opacity-40" disabled={!attested || busy || disabled} onClick={() => input.current?.click()}>{busy ? 'Uploading recording…' : 'Upload own recording'}</button>
      {rows.length ? <ul className="max-h-48 space-y-2 overflow-auto">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-2"><span>{row.title} <span className="text-xs text-muted">{row.duration_sec}s</span></span><button type="button" className="rounded-lg border border-ink/15 px-3 py-2" disabled={busy || disabled} onClick={() => onChange({ kind: 'sound', soundId: row.id, title: row.title, durationSec: row.duration_sec })}>Use sound</button></li>)}</ul> : <p className="text-xs text-muted">{loading ? 'Loading sounds…' : error ? 'The sound list could not load.' : 'No approved reusable sounds are available yet.'}</p>}
    </div>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
  </section>;
}
