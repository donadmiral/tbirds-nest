'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, ImagePlus } from 'lucide-react';
import { LiveIcon } from '@/components/LiveIcon';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { liveCommand, liveInvoke, liveError } from '@/lib/liveApi';
import { withTimeout } from '@/lib/withTimeout';
import { LIVE_TOPICS, isLiveUuid, parseLiveDirectory } from '../../../../shared/liveDirectory';
import { defaultLiveSchedule, liveScheduledAt, liveLocalTimeZone, type LiveStartMode } from '../../../../shared/liveSetup';
async function jpegCover(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw Error('Choose an image smaller than 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw Error('Your browser could not prepare the cover.');
    context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Could not prepare cover.')), 'image/jpeg', 0.86));
    if (blob.size > 2 * 1024 * 1024) throw Error('Choose a smaller cover image.'); return blob;
  } finally { bitmap.close(); }
}
export default function NewLivePage() {
  const [client] = useState(createClient), [navigation] = useState(getNavigationStore), router = useRouter();
  const identity = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const [ready, setReady] = useState(false), [broadcastReady, setBroadcastReady] = useState(false), [recordingReady, setRecordingReady] = useState(false), [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<LiveStartMode>('now'), [schedule, setSchedule] = useState(defaultLiveSchedule), [more, setMore] = useState(false);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [topic, setTopic] = useState('irl'), [audience, setAudience] = useState('public'), [language, setLanguage] = useState('en'), [recording, setRecording] = useState(false);
  const [cover, setCover] = useState<File | null>(null), [preview, setPreview] = useState(''), [error, setError] = useState(''), [draftId, setDraftId] = useState<string | null>(null), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const request = useRef<{ id: string; payload: string } | null>(null), lock = useRef(false), scope = useRef(identity.scope); scope.current = identity.scope;
  useEffect(() => { if (new URLSearchParams(window.location.search).get('mode') === 'schedule') setMode('later'); }, []);
  useEffect(() => { setDraftId(null); request.current = null; lock.current = false; setBusy(false); }, [identity.scope]);
  useEffect(() => {
    let active = true; setReady(false); setBroadcastReady(false); setRecordingReady(false); setChecked(false); setError('');
    if (!identity.owner) return;
    void withTimeout(client.rpc('live_directory', { p_filter: 'mine', p_topic: null, p_state: 'live', p_cursor: null, p_limit: 1 })).then(({ data, error }) => {
      if (!active) return; if (error) throw error;
      const capabilities = parseLiveDirectory(data).capabilities;
      setReady(capabilities.create); setBroadcastReady(capabilities.broadcast); setRecordingReady(data?.capabilities?.recording === true);
    }).catch(() => { if (active) setError('Could not check Live availability. Retry setup.'); }).finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, [client, identity.owner, identity.scope, revision]);
  useEffect(() => { if (!cover) { setPreview(''); return; } const url = URL.createObjectURL(cover); setPreview(url); return () => URL.revokeObjectURL(url); }, [cover]);
  const scheduled = mode === 'later', allowed = ready && (scheduled || broadcastReady), frozen = busy || !!draftId;
  const input = 'mt-2 min-h-12 w-full rounded-lg border border-ink/15 bg-surface px-3 font-normal text-ink disabled:opacity-60';
  const destination = (id: string) => '/live/' + id + (scheduled ? '?scheduled=1' : '?studio=1&preview=1');
  return <div className="mx-auto max-w-2xl pb-24">
    <Link href="/live" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted"><ArrowLeft size={18} />Back to Live</Link>
    <h1 className="text-3xl font-semibold text-ink">{scheduled ? 'Schedule live' : 'Start live'}</h1>
    {!identity.owner ? <p className="mt-6 text-sm text-muted"><Link href="/login?next=%2Flive%2Fnew" className="underline">Sign in</Link> to start or schedule a live.</p> : <form className="mt-6 space-y-5" onSubmit={async event => {
      event.preventDefault(); if (!allowed || lock.current) return;
      let scheduledAt: string | null;
      try { scheduledAt = liveScheduledAt(mode, schedule.date, schedule.time); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Choose a valid date and time.'); return; }
      lock.current = true; setBusy(true); setError(''); const ownerScope = identity.scope;
      const current = () => scope.current === ownerScope;
      try {
        const payload = { title: title.trim() || 'Live stream', description: description.trim(), topic, audience, language, recording_enabled: recordingReady && recording, scheduled_at: scheduledAt };
        const serialized = JSON.stringify(payload); if (request.current?.payload !== serialized) request.current = { id: crypto.randomUUID(), payload: serialized };
        let id = draftId;
        if (!id) { const result = await liveCommand(client, null, 'create', payload, request.current.id); if (!isLiveUuid(result.session_id)) throw Error('INVALID_SERVICE_RESPONSE'); id = result.session_id; if (!current()) return; setDraftId(id); }
        if (cover) {
          const image = await jpegCover(cover); if (!current()) return;
          const grant = await liveInvoke(client, 'live-cover', { action: 'authorize', sessionId: id, requestId: crypto.randomUUID() });
          if (!current()) return;
          if (typeof grant.object_path !== 'string' || typeof grant.token !== 'string') throw Error('INVALID_SERVICE_RESPONSE');
          const upload = await withTimeout(client.storage.from('live-covers').uploadToSignedUrl(grant.object_path, grant.token, image, { contentType: 'image/jpeg' }));
          if (upload.error) throw upload.error; if (!current()) return;
          await liveInvoke(client, 'live-cover', { action: 'finalize', sessionId: id, objectPath: grant.object_path });
        }
        if (current()) router.push(destination(id));
      } catch (reason) { if (current()) setError(reason instanceof Error && /^(Choose|Your browser|Could not prepare)/.test(reason.message) ? reason.message : liveError(reason)); }
      finally { if (current()) { lock.current = false; setBusy(false); } }
    }}>
      <div role="tablist" aria-label="When to go live" className="flex gap-1 rounded-xl bg-surface p-1">{([['now', 'Live now'], ['later', 'Schedule for later']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={frozen} onClick={() => { setMode(value); setError(''); }} className={'min-h-12 flex-1 rounded-lg px-3 text-sm font-semibold ' + (mode === value ? 'bg-ink text-[var(--canvas)]' : 'text-ink')}>{label}</button>)}</div>
      <p className="text-sm text-muted">{scheduled ? 'Choose a future time. Your camera stays off when scheduling.' : 'No schedule needed. Preview your camera, then choose Go live.'}</p>
      {scheduled ? <label className="block text-sm font-semibold text-ink"><CalendarDays size={16} className="mr-2 inline" />Date and time<input aria-label="Scheduled date and time" disabled={frozen} type="datetime-local" required step={60} value={schedule.date + 'T' + schedule.time} onChange={event => { const [date = '', time = ''] = event.target.value.split('T'); setSchedule({ date, time }); }} className={input} /><span className="mt-2 block text-xs font-normal text-muted">Time zone: {liveLocalTimeZone()}</span></label> : null}
      <label className="block text-sm font-semibold text-ink">Title, optional<input aria-label="Stream title, optional" disabled={frozen} value={title} onChange={event => setTitle(event.target.value)} maxLength={120} className={input} placeholder="What are you sharing?" /></label>
      <label className="block text-sm font-semibold text-ink">Who can watch<select disabled={frozen} value={audience} onChange={event => setAudience(event.target.value)} className={input}><option value="public">Public</option><option value="followers">Followers</option><option value="invite">Invitation only</option></select></label>
      <button type="button" aria-expanded={more} disabled={busy} onClick={() => setMore(!more)} className="min-h-11 text-sm font-semibold text-ink">{more ? 'Fewer options' : 'More options'}</button>
      {more ? <div className="space-y-5">
        <label className="block text-sm font-semibold text-ink">Description<textarea disabled={frozen} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={3} className={input + ' py-3'} /></label>
        <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-semibold text-ink">Topic<select disabled={frozen} value={topic} onChange={event => setTopic(event.target.value)} className={input}>{LIVE_TOPICS.filter(([id]) => id !== 'all').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="block text-sm font-semibold text-ink">Language<select disabled={frozen} value={language} onChange={event => setLanguage(event.target.value)} className={input}><option value="en">English</option><option value="sn">Shona</option><option value="nd">Ndebele</option><option value="fr">French</option><option value="es">Spanish</option><option value="pt">Portuguese</option><option value="ar">Arabic</option><option value="other">Other</option></select></label></div>
        <label className="block rounded-xl border border-dashed border-ink/20 p-5 text-sm font-semibold text-ink"><span className="inline-flex items-center gap-2"><ImagePlus size={18} />Cover image, optional</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label="Stream cover image" onChange={event => setCover(event.target.files?.[0] || null)} className="mt-3 block max-w-full text-xs text-muted" />{preview ? <img src={preview} alt="Cover preview" className="mt-4 max-h-48 rounded-lg object-contain" /> : null}</label>
        <label className="flex items-start gap-3 rounded-xl bg-surface p-4 text-sm text-ink"><input type="checkbox" checked={recordingReady && recording} disabled={!recordingReady || frozen} onChange={event => setRecording(event.target.checked)} className="mt-1" /><span>Save replay and enable clips<span className="mt-1 block text-xs text-muted">{recordingReady ? 'Keep the broadcast for replays and highlights.' : 'Recording is not enabled in this environment.'}</span></span></label>
      </div> : null}
      <div className="sticky bottom-3 space-y-3 rounded-xl border border-ink/10 bg-[var(--canvas)] p-4 shadow-sm">
        {checked && !allowed ? <p role="status" className="text-sm text-muted">{ready ? 'Broadcasting is not enabled in this environment. You can still select Schedule for later.' : 'Stream creation is unavailable.'}</p> : null}
        {error ? <p role="alert" className="text-sm text-ink">{draftId ? 'Your stream is saved. ' : ''}{error}</p> : null}
        {checked && (!allowed || error) ? <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)} className="min-h-11 text-sm font-semibold text-ink underline">Retry setup</button> : null}
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={!allowed || busy} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-[var(--canvas)] disabled:opacity-40"><LiveIcon size={20} />{busy ? scheduled ? 'Scheduling…' : 'Opening preview…' : draftId ? 'Retry cover upload' : scheduled ? 'Schedule stream' : 'Preview camera'}</button>{draftId ? <Link href={destination(draftId)} className="inline-flex min-h-12 items-center px-4 text-sm font-semibold text-ink underline">Open saved stream</Link> : null}</div>
      </div>
    </form>}
  </div>;
}
