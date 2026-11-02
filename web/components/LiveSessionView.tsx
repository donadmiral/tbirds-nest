'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getNavigationStore } from '@/lib/navigationCache';
import { withTimeout } from '@/lib/withTimeout';
import { LiveIcon } from './LiveIcon';
import { isLiveUuid, liveStateLabel, parseLiveSession, type LiveSession } from '../../shared/liveDirectory';
export function LiveSessionView({ id }: { id: string }) {
  const [client] = useState(createClient),[navigation] = useState(getNavigationStore);
  const identity=useSyncExternalStore(navigation.subscribe,navigation.getSnapshot,navigation.getServerSnapshot);
  const [state,setState]=useState<{scope:string|null;session:LiveSession|null;error:string|null}>({scope:null,session:null,error:null});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let alive=true;
    setState({scope:identity.scope,session:null,error:null});
    if(!isLiveUuid(id)){setState({scope:identity.scope,session:null,error:'This stream link is not valid.'});return;}
    if(!identity.owner)return;
    void withTimeout(client.rpc('live_session',{p_session_id:id})).then(({data,error})=>{
      const session=!error?parseLiveSession(data?.session):null;
      if(alive)setState({scope:identity.scope,session,error:session?null:'This stream is unavailable or you do not have access.'});
    }).catch(()=>{if(alive)setState({scope:identity.scope,session:null,error:'This stream could not load. Please try again.'});});
    return()=>{alive=false;};
  },[client,id,identity.owner,identity.scope,retry]);
  const session=state.scope===identity.scope?state.session:null;
  return <div className="mx-auto max-w-4xl pb-24"><Link href="/live" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted"><ArrowLeft size={18}/>Back to Live</Link>
    {!identity.owner?<p className="text-sm text-muted"><Link href="/login" className="underline">Sign in</Link> to view this stream.</p>:state.error?<div role="alert" className="rounded-xl border border-ink/10 p-6 text-sm text-ink">{state.error}<button type="button" onClick={()=>setRetry(v=>v+1)} className="ml-3 min-h-11 underline">Retry</button></div>:!session?<p role="status" className="py-12 text-center text-muted">Loading stream…</p>:<>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-muted"><LiveIcon size={17}/>{liveStateLabel(session)}<span className="capitalize">· {session.topic}</span></div>
      <h1 className="text-2xl font-semibold text-ink">{session.title}</h1><p className="mt-2 text-sm text-muted">{session.host.full_name||session.host.username||'Creator'}</p>
      <div className="mt-5 grid aspect-video place-items-center rounded-2xl bg-surface p-6 text-center"><div><LiveIcon size={44} className="mx-auto mb-4 text-muted"/><p className="font-semibold text-ink">{session.state==='scheduled'?'This stream has not started':session.state==='draft'||session.state==='backstage'?'Stream draft saved':'Live playback is not connected yet'}</p><p className="mt-2 text-sm text-muted">{session.state==='scheduled'?'Return when the host goes live.':'The video service must be connected before broadcasting or viewing.'}</p></div></div>
      {session.scheduled_at?<p className="mt-4 flex items-center gap-2 text-sm text-muted"><CalendarDays size={16}/>{new Date(session.scheduled_at).toLocaleString()}</p>:null}
      {session.description?<p className="mt-5 whitespace-pre-wrap text-sm text-ink">{session.description}</p>:null}
    </>}
  </div>;
}
