'use client';

import { useEffect, useRef, useState } from 'react';
import { FileAudio, X } from 'lucide-react';
import { inspectExportAudio, type LocalExportAudio } from '../lib/videoExportAudio';
import s from './ExportAudioPicker.module.css';

export function ExportAudioPicker({ value, onChange, disabled = false, onBusyChange }: { value: LocalExportAudio | null; onChange: (value: LocalExportAudio | null) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const pending = useRef<AbortController | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { const request = pending.current; pending.current = null; request?.abort(); }, []);
  const pick = async (file?: File) => {
    if (!file) return;
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    onChange(null); setLoading(true); onBusyChange?.(true); setError('');
    try { const selected = await inspectExportAudio(file, abort.signal); if (!abort.signal.aborted) onChange(selected); }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'The audio could not load. Choose another recording.'); }
    finally { if (pending.current === abort) { pending.current = null; setLoading(false); onBusyChange?.(false); } }
  };
  return <fieldset className={s.root} disabled={disabled || loading}>
    <legend><FileAudio size={18} aria-hidden /> Your audio or voiceover</legend>
    <p>Optional · Used only in this download. Choose a recording you own or have permission to use. It stays in this browser.</p>
    <label className={s.file}>{value ? 'Change audio file' : 'Choose audio file'}<input type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/flac" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {loading && <p role="status">Checking audio…</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {value && <><div className={s.selected}><div><strong>{value.file.name}</strong><span>{Number(value.duration.toFixed(1))} seconds · Local file</span></div><button type="button" aria-label="Remove export audio" onClick={() => { onChange(null); setError(''); }}><X size={18} /></button></div>
      <div className={s.fields}><label>Audio level · {Math.round(value.volume * 100)}%<input aria-label="Export audio level" type="range" min="0" max="1" step=".01" value={value.volume} onChange={event => onChange({ ...value, volume: Number(event.target.value) })} /></label><label>Start at (seconds)<input type="number" min="0" max={Math.max(0, Math.floor((value.duration - .1) * 10) / 10)} step=".1" value={value.startSec} onChange={event => onChange({ ...value, startSec: Number(event.target.value) })} /></label></div>
      <label className={s.check}><input type="checkbox" checked={value.loop} onChange={event => onChange({ ...value, loop: event.target.checked })} />Loop the selected excerpt until the movie ends</label>
      <p>The audio starts with the movie. With looping off, it plays once from the selected start point.</p>
    </>}
  </fieldset>;
}
