import {contentObject,CONTENT_UUID} from './contentMedia';
import {memoryAlbumStoryLayers} from './memoryStoryPresentation';
import {memoryFilmSettings} from './memoryBookCreative';
import {readSoundtrack} from './soundtrack';
import type {MemoryBook} from './memoryBookModels';
import type {MemoryMoviePage} from './memoryMoviePlan';

type MovieAccessClient={
 rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
 auth:{getUser:(jwt?:string)=>PromiseLike<{data:{user:{id:string}|null};error:unknown}>;
 getSession:()=>PromiseLike<{data:{session:{user:{id:string};access_token:string}|null};error:unknown}>;
 onAuthStateChange:(callback:(event:string,session:{user:{id:string}}|null)=>void)=>{data:{subscription:{unsubscribe:()=>void}}}};
};
export type MemoryMovieSnapshot={title:string;pages:readonly MemoryMoviePage[];filmSettings?:unknown;soundtrack?:unknown;revision?:number};
function canonical(value:unknown,base:string,depth=0):unknown{
 if(depth>20)throw new Error('A memory contains artwork that is too deeply nested to export.');
 if(typeof value==='string')return contentObject(value,base)?.key??value;
 if(Array.isArray(value))return value.map(item=>canonical(item,base,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key],base,depth+1)]));
 return value??null;
}
export function memoryMovieContentStamp(snapshot:MemoryMovieSnapshot,base:string):string{
 return JSON.stringify(canonical({title:snapshot.title,film:memoryFilmSettings(snapshot.filmSettings),soundtrack:readSoundtrack(snapshot.soundtrack),pages:snapshot.pages.map(page=>{
  const value=page as MemoryMoviePage&{dual_front_url?:unknown};
  return {id:page.id,story:page.story_id??null,media:page.media_url??null,type:page.media_type??null,caption:page.caption??null,storyCaption:page.story_caption??null,date:page.taken_at??page.created_at??null,duration:page.duration_sec??null,transform:page.media_transform??null,filter:page.filter_id??null,background:page.text_background??null,stickers:memoryAlbumStoryLayers({pages:[page]}).pages[0].stickers??[],audio:page.audio_sound_id??null,audioDuration:page.audio_duration_sec??null,dual:value.dual_front_url??null};
 })},base));
}
function bounded<T>(work:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(fn:()=>void)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);fn();};
  const cancel=()=>finish(()=>reject(new Error('Memory movie export was cancelled.')));
  const timer=setTimeout(()=>finish(()=>reject(new Error('The book’s current access could not be checked. Reconnect and retry.'))),15000);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  Promise.resolve(work).then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
 });
}
/** A signed URL is never enough to keep an export alive after its book or account changes. */
export async function openMemoryMovieAccess(options:{client:MovieAccessClient;base:string;bookId:string;expected:MemoryMovieSnapshot;signal:AbortSignal;onInvalid:(error:Error)=>void}){
 const {client,base,bookId,expected,signal,onInvalid}=options;
 if(!CONTENT_UUID.test(bookId))throw new Error('Reopen the saved book before making a movie.');
 const session=await bounded(client.auth.getSession(),signal),token=session.data.session?.access_token;
 if(session.error||!token)throw new Error('Sign in again before making a memory movie.');
 const initial=await bounded(client.auth.getUser(token),signal),viewer=initial.data.user?.id;
 if(initial.error||!viewer||viewer!==session.data.session?.user.id)throw new Error('Sign in again before making a memory movie.');
 const stamp=memoryMovieContentStamp(expected,base);let live=true,invalid=false,pending:Promise<MemoryBook>|null=null;
 const fail=(error:unknown)=>{if(invalid)return;invalid=true;if(live&&!signal.aborted)onInvalid(error instanceof Error?error:new Error('The book’s access changed. Reopen it before exporting.'));};
 const {data:{subscription}}=client.auth.onAuthStateChange((event,session)=>{if(live&&(event==='SIGNED_OUT'||session?.user.id!==viewer))fail(new Error('Your account changed. The movie export was cancelled.'));});
 const check=()=>{
  if(!live||invalid||signal.aborted)return Promise.reject(new Error('Memory movie export was cancelled.'));
  if(pending)return pending;
  const work=(async()=>{
   const currentSession=await bounded(client.auth.getSession(),signal);
   if(currentSession.error||currentSession.data.session?.user.id!==viewer||!currentSession.data.session.access_token)throw new Error('Your account changed. The movie export was cancelled.');
   const user=await bounded(client.auth.getUser(currentSession.data.session.access_token),signal);
   if(user.error||user.data.user?.id!==viewer||!live||invalid)throw new Error('Your account changed. The movie export was cancelled.');
   const {data,error}=await bounded(client.rpc('get_memory_book',{p_album:bookId}),signal);
   const book=data as MemoryBook|null;
   if(error||!book||book.id!==bookId||book.can_view!==true||!Array.isArray(book.pages))throw new Error('This book is no longer available. No movie was saved.');
   if(expected.revision!=null&&book.presentation_revision!==expected.revision||memoryMovieContentStamp({title:book.title,pages:book.pages,filmSettings:book.film_settings,soundtrack:book.soundtrack},base)!==stamp)throw new Error('This book changed during export. Reopen it to make the current movie.');
   if(!live||invalid||signal.aborted)throw new Error('Memory movie export was cancelled.');return memoryAlbumStoryLayers(book);
  })();
  pending=work;void work.catch(fail).finally(()=>{if(pending===work)pending=null;});return work;
 };
 const stop=()=>{live=false;subscription.unsubscribe();};
 try{const book=await check();return {book,check,stop,viewer};}catch(error){stop();throw error;}
}
