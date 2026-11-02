'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Video } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { withTimeout } from '@/lib/withTimeout';
import { LIVE_TOPICS, isLiveSetupMissing, parseLiveDirectory } from '../../../../shared/liveDirectory';
export default function NewLivePage() {
  const [client] = useState(createClient), [navigation] = useState(getNavigationStore);
  const identity = useSyncExternalStore(navigation.subscribe,navigation.getSnapshot,navigation.getServerSnapshot);
  const [ready,setReady] = useState(false),[busy,setBusy] = useState(false),[checked,setChecked] = useState(false);
  const [title,setTitle] = useState(''),[topic,setTopic] = useState('irl'),[audience,setAudience] = useState('public');
  const [error,setError] = useState(''),[requestId] = useState(() => typeof crypto !== 'undefined' ? crypto.randomUUID() : '');
  const router = useRouter();
  useEffect(() => {
    let active=true;setReady(false);setChecked(false);setError('');
    if (!identity.owner) return;
    void withTimeout(client.rpc('live_directory',{p_filter:'mine',p_topic:null,p_state:'live',p_cursor:null,p_limit:1})).then(({data,error})=>{
      if(!active)return;
      if(error){if(!isLiveSetupMissing(error))setError('Could not check stream creation. Please return to Live and retry.');}
      else setReady(parseLiveDirectory(data).capabilities.create);
      setChecked(true);
    }).catch(()=>{if(active){setError('Could not check stream creation. Please try again.');setChecked(true);}});
    return()=>{active=false;};
  },[client,identity.owner]);
  return <div className="mx-auto max-w-xl pb-24"><Link href="/live" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted"><ArrowLeft size={18}/>Back to Live</Link>
    <h1 className="text-3xl font-semibold text-ink">Create a stream</h1><p className="mt-2 text-sm text-muted">Set up your title and audience before going on air.</p>
    {!identity.owner ? <p className="mt-6 text-sm text-muted"><Link href="/login?next=%2Flive%2Fnew" className="underline">Sign in</Link> to create a stream.</p> : <form className="mt-6 space-y-5" onSubmit={async event=>{
      event.preventDefault();if(!ready||busy||!title.trim())return;setBusy(true);setError('');
      try{const {data,error}=await withTimeout(client.rpc('live_command',{p_action:'create',p_session_id:null,p_payload:{title:title.trim(),topic,audience,recording_enabled:false},p_request_id:requestId}));if(error||!data?.session_id)throw error;router.push('/live/'+data.session_id);}
      catch{setError('The stream draft could not be saved. Your title is still here.');}finally{setBusy(false);}
    }}>
      <label className="block text-sm font-semibold text-ink">Stream title<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required className="mt-2 min-h-12 w-full rounded-lg border border-ink/15 bg-surface px-3 font-normal" placeholder="What are you going live about?"/></label>
      <label className="block text-sm font-semibold text-ink">Topic<select value={topic} onChange={e=>setTopic(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-ink/15 bg-surface px-3 font-normal">{LIVE_TOPICS.filter(([id])=>id!=='all').map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold text-ink">Audience<select value={audience} onChange={e=>setAudience(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-ink/15 bg-surface px-3 font-normal"><option value="public">Public</option><option value="followers">Followers</option><option value="invite">Invitation only</option></select></label>
      {checked&&!ready?<div role="status" className="rounded-xl bg-surface p-4 text-sm text-muted">Stream creation is not connected in this environment yet. No camera or microphone will start.</div>:null}
      {error?<p role="alert" className="text-sm text-ink">{error}</p>:null}
      <button type="submit" disabled={!ready||busy||!title.trim()} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-[var(--canvas)] disabled:opacity-40"><Video size={18}/>{busy?'Saving…':'Save stream draft'}</button>
      <p className="text-xs text-muted">Saving a draft does not start a broadcast. Payments and gifts are not included.</p>
    </form>}
  </div>;
}
