'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import Link from 'next/link';
import {ArrowLeft,ExternalLink,Link2,RefreshCw} from 'lucide-react';
import {createClient} from '@/lib/supabase/client';
import {getNavigationStore} from '@/lib/navigationCache';
import {liveInvoke,record} from '@/lib/liveApi';
import {connectionStatus,connectionError,socialNames,socialPlatforms,socialPlatform,validAuthorizationUrl,parseConnectionSelection,type SocialConnection,type SocialPlatform,type ConnectionSelection} from '@/lib/liveConnections';
const storageKey='platinum-live-oauth-attempt';
function useConnectionIdentity(){const [client]=useState(createClient),[store]=useState(getNavigationStore);const identity=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);return{client,identity};}
export function LiveConnections(){
 const {client,identity}=useConnectionIdentity(),[items,setItems]=useState<SocialConnection[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const generation=useRef(0),locked=useRef(false);
 const refresh=useCallback(async()=>{if(!identity.owner||locked.current)return;const current=generation.current;locked.current=true;setBusy(true);setError('');try{const result=await connectionStatus(client);if(current===generation.current)setItems(result);}catch(cause){if(current===generation.current)setError(connectionError(cause));}finally{if(current===generation.current){locked.current=false;setBusy(false);}}},[client,identity.owner]);
 useEffect(()=>{generation.current++;locked.current=false;setItems([]);setError('');setNotice('');void refresh();return()=>{generation.current++;locked.current=false;};},[refresh,identity.scope]);
 async function action(platform:SocialPlatform,kind:'begin'|'disconnect'){
  if(locked.current||!identity.owner)return;locked.current=true;setBusy(true);setError('');setNotice('');const current=generation.current;
  try{const result=await liveInvoke(client,'live-connect',{action:kind,platform});if(current!==generation.current)return;
   if(kind==='begin'){const url=validAuthorizationUrl(result.authorization_url,platform,window.location.origin);sessionStorage.setItem(storageKey,JSON.stringify({platform,state:url.searchParams.get('state'),owner:identity.owner,createdAt:Date.now()}));window.location.assign(url.href);return;}
   setNotice('Disconnected from Platinum Circles. You can also remove the app’s permission in your provider account settings.');
   setItems(previous=>previous.map(item=>item.platform===platform?{...item,state:'disconnected',account_name:null,can_publish:false}:item));
  }catch(cause){if(current===generation.current)setError(connectionError(cause));}finally{if(current===generation.current){locked.current=false;setBusy(false);}}
 }
 return <div className="mx-auto max-w-3xl pb-24"><Link href="/live/settings" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted"><ArrowLeft size={17}/>Platform settings</Link><header className="mb-7"><p className="mb-2 text-xs uppercase tracking-widest text-muted">Optional connections</p><h1 className="text-3xl font-semibold text-ink">Connected platforms</h1><p className="mt-3 text-sm text-muted">Choose the account you want to connect. Connecting an account does not post a clip. Each publication requires a separate review and confirmation.</p></header>
  {!identity.initialized?<p role="status" className="text-sm text-muted">Checking your session…</p>:!identity.owner?<p className="text-sm text-muted"><Link href="/login?next=%2Flive%2Fconnections" className="underline">Sign in</Link> to manage your connections.</p>:<>
   {error?<p role="alert" className="mb-5 rounded-xl border border-ink/15 p-4 text-sm text-ink">{error}</p>:null}{notice?<p role="status" className="mb-5 rounded-xl bg-surface p-4 text-sm text-ink">{notice}</p>:null}
   <div className="space-y-3">{socialPlatforms.map(platform=>{const item=items.find(row=>row.platform===platform),connected=item?.state==='connected';return <section key={platform} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-surface p-5"><div><h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Link2 size={17}/>{socialNames[platform]}</h2><p className="mt-2 text-sm text-muted">{connected?item.account_name||'Connected account':item?.state==='reconnect_required'?'Please reconnect this account':item?.enabled?'Ready to connect':'Connection setup is not available yet'}</p>{connected?<p className="mt-1 text-xs text-muted">{item.can_publish?'Publishing is available after clip confirmation.':'Device export is available. Direct publishing is not active.'}</p>:null}</div><div className="flex gap-2">{item?.enabled?<button type="button" disabled={busy} onClick={()=>void action(platform,'begin')} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm text-[var(--canvas)] disabled:opacity-40">{connected?'Reconnect':'Connect'}<ExternalLink size={14}/></button>:null}{item&&item.state!=='disconnected'?<button type="button" disabled={busy} onClick={()=>void action(platform,'disconnect')} className="min-h-11 rounded-full border border-ink/15 px-4 text-sm text-ink disabled:opacity-40">Disconnect</button>:null}</div></section>;})}</div>
   <button type="button" onClick={()=>void refresh()} disabled={busy} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/15 px-5 text-sm text-ink disabled:opacity-40"><RefreshCw size={16} className={busy?'animate-spin':''}/>Refresh connections</button>
  </>}
 </div>;
}
type CallbackInput={platform:SocialPlatform;state:string;code:string;owner:string};
export function LiveConnectionCallback(){
 const {client,identity}=useConnectionIdentity(),[error,setError]=useState(''),[message,setMessage]=useState('Completing your connection…'),[selection,setSelection]=useState<ConnectionSelection|null>(null),[busy,setBusy]=useState(false);
 const input=useRef<CallbackInput|null>(null),captured=useRef(false),operation=useRef<Promise<Record<string,unknown>>|null>(null),generation=useRef(0),locked=useRef(false);
 useEffect(()=>{
  if(captured.current)return;captured.current=true;
  const url=new URL(window.location.href),code=url.searchParams.get('code'),state=url.searchParams.get('state');window.history.replaceState(null,'','/live/connections/callback');
  try{const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');sessionStorage.removeItem(storageKey);
   if(url.searchParams.has('error'))throw Error('PROVIDER_REJECTED');
   if(!record(stored)||!socialPlatform(stored.platform)||stored.state!==state||typeof stored.owner!=='string'||typeof stored.createdAt!=='number'||Date.now()-stored.createdAt>600000||Date.now()<stored.createdAt||!code||code.length>8000||!state||!/^[A-Za-z0-9_-]{43}$/.test(state))throw Error('STATE_EXPIRED');
   input.current={platform:stored.platform,state,code,owner:stored.owner};
  }catch(cause){setError(connectionError(cause));setMessage('Connection not completed.');}
 },[]);
 useEffect(()=>{
  const current=++generation.current;setSelection(null);locked.current=false;
  if(!identity.initialized||!input.current)return;
  if(identity.owner!==input.current.owner){setError('Sign in with the account that started this connection, then start a new connection.');setMessage('Connection not completed.');return;}
  // Reuse the same promise across Strict Mode effect checks; a code is exchanged once.
  const flow=input.current;if(!operation.current)operation.current=liveInvoke(client,'live-connect',{action:'complete',platform:flow.platform,state:flow.state,code:flow.code});
  setBusy(true);void operation.current.then(result=>{if(current!==generation.current)return;const choices=parseConnectionSelection(result);if(choices){setSelection(choices);setMessage('Choose the account to connect.');}else if(result.state==='connected'){setMessage('Your account is connected. No clip has been posted.');setError('');}else throw Error('PROVIDER_RESPONSE_INVALID');}).catch(cause=>{if(current===generation.current){setError(connectionError(cause));setMessage('Connection not completed.');}}).finally(()=>{if(current===generation.current)setBusy(false);});
  return()=>{generation.current++;};
 },[client,identity.owner,identity.scope,identity.initialized]);
 async function choose(accountId:string){
  if(!selection||!input.current||locked.current||identity.owner!==input.current.owner)return;locked.current=true;setBusy(true);const current=generation.current;
  try{const result=await liveInvoke(client,'live-connect',{action:'select',platform:input.current.platform,selection_id:selection.id,account_id:accountId});if(current!==generation.current)return;if(result.state!=='connected')throw Error('PROVIDER_RESPONSE_INVALID');setSelection(null);setMessage('Your account is connected. No clip has been posted.');setError('');}
  catch(cause){if(current===generation.current){setError(connectionError(cause));setSelection(null);}}
  finally{if(current===generation.current){locked.current=false;setBusy(false);}}
 }
 return <div className="mx-auto max-w-xl pb-24"><h1 className="text-3xl font-semibold text-ink">Platform connection</h1><p role="status" className="mt-4 text-sm text-muted">{message}</p>{error?<p role="alert" className="mt-4 rounded-xl border border-ink/15 p-4 text-sm text-ink">{error}</p>:null}{selection?<div className="mt-5 space-y-2">{selection.accounts.map(account=><button type="button" key={account.id} disabled={busy} onClick={()=>void choose(account.id)} className="block min-h-12 w-full rounded-xl bg-surface px-5 text-left text-sm text-ink disabled:opacity-40">{account.name}</button>)}</div>:null}<Link href="/live/connections" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full border border-ink/15 px-5 text-sm text-ink"><ArrowLeft size={16}/>Back to connections</Link></div>;
}
