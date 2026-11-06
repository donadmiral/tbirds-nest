'use client';
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {createHostFollow,emptyHostFollow,followHostAction,followHostLabel} from '../../shared/liveHostFollow';
import type {LiveClient} from '@/lib/liveApi';
export function LiveHostFollow({client,owner,host,sessionId,onChange}:{client:LiveClient;owner:string;host:string;sessionId:string;onChange():void}) {
  const model=useMemo(()=>createHostFollow(owner,host,sessionId,(fn,args)=>client.rpc(fn,args),async()=>(await client.auth.getSession()).data.session?.user.id??null),[client,owner,host,sessionId]);
  const s=useSyncExternalStore(model.subscribe,model.snapshot,()=>emptyHostFollow);
  useEffect(()=>model.mount(),[model]);
  if(s.status==='hidden'||s.status==='loading')return null;
  return <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={s.busy} aria-busy={s.busy} aria-label={followHostAction(s.status)} className="min-h-11 rounded-full border border-ink/20 px-4 text-sm font-semibold text-ink" onClick={async()=>{if(await model.toggle())onChange();}}>{followHostLabel(s.status)}</button>{s.error?<span role="status" className="text-xs text-muted">Could not confirm the follow status.</span>:null}</div>;
}
