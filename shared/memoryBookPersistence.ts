import {
  memoryBookCreativeAvailable,parseMemoryCoverArtwork,parseMemoryFilmSettings,
  parseMemoryCreativeSaveResult,type MemoryCoverArtwork,type MemoryFilmSettings,type MemoryCreativeSaveResult,
} from './memoryBookCreative';

type RpcResult={data:unknown;error:unknown};
type RpcRequest=PromiseLike<RpcResult>&{setHeader:(name:string,value:string)=>RpcRequest;abortSignal:(signal:AbortSignal)=>RpcRequest};
export type MemoryCreativeClient={
  rpc:(name:string,args?:Record<string,unknown>)=>RpcRequest;
  auth:{getUser:(jwt?:string)=>PromiseLike<{data:{user:{id:string}|null};error:unknown}>;getSession:()=>PromiseLike<{data:{session:{user:{id:string};access_token:string}|null};error:unknown}>;
   onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{data:{subscription:{unsubscribe:()=>void}}}};
};
export type MemoryCreativeDraft={
  title:string;subtitle:string;color:string;design:string;coverStoryId:string|null;
  artwork:MemoryCoverArtwork;film:MemoryFilmSettings;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireMemoryCreativeBackend(client:MemoryCreativeClient):Promise<void>{
  const {data,error}=await client.rpc('get_memory_book_creative_capabilities');
  if(!memoryBookCreativeAvailable(data,error))throw new Error('Creative book saving is unavailable. Your draft is kept. Retry after reconnecting.');
}
async function requireOwner(client:MemoryCreativeClient,ownerId:string,isCurrent:()=>boolean){
  if(!uuid.test(ownerId)||!isCurrent())throw new Error('The book session changed. Reopen the book before saving.');
  const session=await client.auth.getSession();
  if(session.error||session.data.session?.user.id!==ownerId||!session.data.session.access_token||!isCurrent())throw new Error('The book session changed. Reopen the book before saving.');
  const {data,error}=await client.auth.getUser(session.data.session.access_token);
  if(error||data.user?.id!==ownerId||!isCurrent())throw new Error('The book session changed. Reopen the book before saving.');
  return session.data.session.access_token;
}
async function mutate(client:MemoryCreativeClient,ownerId:string,isCurrent:()=>boolean,name:string,args:Record<string,unknown>,confirm:(data:unknown)=>MemoryCreativeSaveResult){
 let changed=false;const controller=new AbortController(),current=()=>!changed&&!controller.signal.aborted&&isCurrent();
 const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||session?.user.id!==ownerId){changed=true;controller.abort();}});
 let timeout:ReturnType<typeof setTimeout>|undefined;
 const bound=<T,>(work:PromiseLike<T>)=>Promise.race([Promise.resolve(work),new Promise<never>((_,reject)=>{const stop=()=>reject(new Error(changed?'The book session changed. Reopen the book before saving.':'The book save could not be confirmed. Your draft is kept; reload before retrying.'));controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();})]);
 try{
  timeout=setTimeout(()=>controller.abort(),30000);
  await bound(requireMemoryCreativeBackend(client));const token=await bound(requireOwner(client,ownerId,current));
  if(!current())throw new Error('The book session changed. Reopen the book before saving.');
  const {data,error}=await bound(client.rpc(name,args).setHeader('Authorization',`Bearer ${token}`).abortSignal(controller.signal));
  if(!current())throw new Error('The book session changed. Reopen the book before saving.');if(error)throw error;
  const result=confirm(data);await bound(requireOwner(client,ownerId,current));return result;
 }finally{if(timeout)clearTimeout(timeout);subscription.unsubscribe();controller.abort();}
}
function payload(draft:MemoryCreativeDraft){
  const artwork=parseMemoryCoverArtwork(draft.artwork),film=parseMemoryFilmSettings(draft.film);
  if(!artwork||!film||!draft.title.trim()||Array.from(draft.title.trim()).length>30||Array.from(draft.subtitle).length>120)throw new Error('Check the book title and creative settings before saving.');
  return {p_title:draft.title.trim(),p_subtitle:draft.subtitle.trim(),p_cover_color:draft.color,p_cover_design:draft.design,p_cover_story_id:draft.coverStoryId,p_cover_artwork:artwork,p_film_settings:film};
}
export async function saveMemoryCreativeBook(client:MemoryCreativeClient,options:{ownerId:string;albumId:string;revision:number;audience:string;draft:MemoryCreativeDraft;isCurrent:()=>boolean}):Promise<MemoryCreativeSaveResult>{
  const {ownerId,albumId,revision,audience,draft,isCurrent}=options;
  if(!uuid.test(albumId)||!Number.isSafeInteger(revision)||revision<0)throw new Error('Reload the book before saving its design.');
  const args={...payload(draft),p_album:albumId,p_expected_revision:revision,p_audience:audience};
  return mutate(client,ownerId,isCurrent,'save_memory_book_creative_presentation',args,data=>{
  const result=parseMemoryCreativeSaveResult(data,albumId);
  if(!result||result.presentation_revision<=revision)throw new Error('The book save could not be confirmed. Reload the saved book before retrying. Your draft is kept.');
  return result;});
}
export async function createMemoryCreativeBook(client:MemoryCreativeClient,options:{ownerId:string;requestId:string;storyIds:string[];draft:MemoryCreativeDraft;isCurrent:()=>boolean}):Promise<MemoryCreativeSaveResult>{
  const {ownerId,requestId,storyIds,draft,isCurrent}=options;
  if(!uuid.test(requestId)||storyIds.length>80||new Set(storyIds).size!==storyIds.length||storyIds.some(id=>!uuid.test(id)))throw new Error('Choose up to 80 different memories for your book.');
  const args={...payload(draft),p_request_id:requestId,p_story_ids:[...storyIds]};
  return mutate(client,ownerId,isCurrent,'create_memory_book_creative_presentation',args,data=>{
  const result=parseMemoryCreativeSaveResult(data,requestId);
  if(!result)throw new Error('The book save could not be confirmed. Your draft is kept; retry to confirm it.');
  return result;});
}
