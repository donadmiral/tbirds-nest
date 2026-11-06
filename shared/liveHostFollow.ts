// The profile is the follow target, including when the host is a business.
// The scoped server command decides whether to follow or request.
type Rpc = (fn: string, args: Record<string,string|boolean>) => PromiseLike<{ data: unknown; error: unknown }>;
type Relation = 'none' | 'following' | 'requested';
type Status = Relation | 'hidden' | 'loading' | 'retry';
export type FollowHostSnapshot = {status:Status; busy:boolean; error:boolean};
export const emptyHostFollow:FollowHostSnapshot={status:'loading',busy:false,error:false};
export function createHostFollow(owner:string,host:string,sessionId:string,rpc:Rpc,currentOwner:()=>Promise<string|null>) {
  let state=emptyHostFollow, epoch=0, mounted=false;
  const listeners=new Set<()=>void>();
  const emit=(status:Status,busy=false,error=false)=>{state={status,busy,error};listeners.forEach(fn=>fn());};
  const authenticated=async(g:number)=>mounted&&epoch===g&&!!owner&&!!host&&owner!==host&&await currentOwner()===owner&&mounted&&epoch===g;
  const relation=async(g:number):Promise<Relation|'hidden'>=>{
    if(!await authenticated(g))return 'hidden';
    const blocked=await rpc('feed_block_exists',{p_author:host});
    if(blocked.error||typeof blocked.data!=='boolean')throw Error('Unavailable');
    if(blocked.data || !mounted || epoch!==g)return 'hidden';
    const profile=await rpc('get_profile',{p_profile_id:host});
    const d=profile.data as {id?:string;viewer_follows?:boolean;viewer_requested?:boolean}|null;
    if(profile.error||!d||d.id!==host||typeof d.viewer_follows!=='boolean'||typeof d.viewer_requested!=='boolean')throw Error('Unavailable');
    return d.viewer_follows?'following':d.viewer_requested?'requested':'none';
  };
  const refresh=async(g:number,error=false)=>{
    try {const next=await relation(g);if(mounted&&epoch===g)emit(next,false,error);}
    catch {if(mounted&&epoch===g)emit('retry',false,true);}
  };
  return {snapshot:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
    mount(){mounted=true;const g=++epoch;emit('loading');void refresh(g);return()=>{mounted=false;epoch++;};},
    async toggle(){
      if(!mounted||state.busy||state.status==='hidden'||state.status==='loading')return false;
      const expected=state.status,g=epoch;emit(expected,true);
      if(expected==='retry'){await refresh(g);return false;}
      let issued=false;
      try {
        // The server repeats the room/host, block and identity checks atomically.
        // Send the desired state directly; an already-satisfied action is harmless.
        if(!await authenticated(g)){if(mounted&&g===epoch)emit('hidden');return false;}
        issued=true;
        const result=await rpc('set_live_host_follow_v1',{p_session_id:sessionId,p_host_id:host,p_follow:expected==='none'});
        if(!mounted||epoch!==g)return false;
        if(result.error && /AUTH_REQUIRED|ACCESS_DENIED|BLOCKED|LIVE_NOT_AVAILABLE|FORBIDDEN|42501/i.test(JSON.stringify(result.error))){emit('hidden');return true;}
        const status=(result.data as {state?:Relation}|null)?.state;
        if(result.error||!(status==='none'||status==='requested'||status==='following'))throw Error('Unconfirmed');
        emit(status);return true;
      }catch{await refresh(g,true);return issued&&mounted&&epoch===g;}
    }};
}
export function followHostLabel(s:Status){return s==='following'?'Following':s==='requested'?'Requested':s==='retry'?'Retry follow status':'Follow';}
export function followHostAction(s:Status){return s==='following'?'Unfollow host':s==='requested'?'Cancel follow request':s==='retry'?'Retry follow status':'Follow host';}
