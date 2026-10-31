import {Asset} from 'expo-asset';
import * as Crypto from 'expo-crypto';
import {File,Paths} from 'expo-file-system';
import {createVideoPlayer} from 'expo-video';
import {composeMemoryMovie,prepareMemoryMovieImage} from '../../modules/boomerang/memoryComposition';
import {contentObject} from '../../shared/contentMedia';
import {MEMORY_SCORE_DUCK,memoryFilmItems,memoryFilmVideoWindow,memoryPageSoundtrack} from '../../shared/memoryFilm';
import {openMemoryMovieAccess,type MemoryMovieSnapshot} from '../../shared/memoryMovieAccess';
import {planMemoryMovie,memoryMovieTimeline,type MemoryMovieTimelineItem} from '../../shared/memoryMoviePlan';
import {memoryMovieLimit} from '../../shared/memoryMovieSupport';
import {validateMemoryMovieRequest,type MemoryMovieAudio,type MemoryMovieNativeRequest,type MemoryMovieNativeScene} from '../../shared/memoryMovieComposition';
import {memoryStoryStickers} from '../../shared/memoryStoryPresentation';
import {authorizeLibraryAudioExport} from '../../shared/musicExportAuthorization';
import {inspectOriginalAudio,ORIGINAL_AUDIO_MAX_BYTES} from '../../shared/originalAudio';
import {readSoundtrack,type SoundtrackSelection} from '../../shared/soundtrack';
import {storyPhotoColorMatrix} from '../../shared/storyColorMatrix';
import {storyVideoLayerWindows,type StoryVideoRecipe} from '../../shared/storyVideoComposition';
import {hydrateMemoryAlbumMedia,hydrateSoundMedia} from './contentMedia';
import {MemoryMovieFiles,memoryMovieStep} from './memoryMovieFiles';
import {supabase,SUPABASE_URL} from './supabase';

export type NativeMemoryCapture={item:MemoryMovieTimelineItem;layer:'background'|'overlay';clock:number};
export type NativeMemoryProgress={message:string;percent:number};
const imageFields=new Set(['photoUrl','photoUri','storyMediaUrl','storyThumbUrl','storyAuthorAvatar','postMediaUrl','postThumbnailUrl','postAuthorAvatar','entityImage']);
const imageLimit=32*1024*1024;
const identity=storyPhotoColorMatrix(null);
const remove=(uri:string)=>{try{const file=new File(uri);if(file.exists)file.delete();}catch{}};

async function videoDuration(uri:string,signal:AbortSignal):Promise<number>{
 const player=createVideoPlayer(uri);player.muted=true;player.pause();
 let success:ReturnType<typeof player.addListener>|undefined,failure:ReturnType<typeof player.addListener>|undefined;
 try{return await memoryMovieStep(new Promise<number>((resolve,reject)=>{
  const ready=()=>{if(Number.isFinite(player.duration)&&player.duration>0)resolve(player.duration);};
  success=player.addListener('sourceLoad',ready);failure=player.addListener('statusChange',event=>{if(event.status==='error')reject(new Error('A memory video could not be read.'));else if(event.status==='readyToPlay')ready();});if(player.status==='readyToPlay')ready();
 }),signal,'A memory video’s duration could not be read.');}
 finally{success?.remove();failure?.remove();player.release();}
}

/** All sources are private, bounded, and disposable. A finished file retains its
 * access monitor until the caller completes the explicit Photos save. */
export async function exportNativeMemoryMovie(options:{bookId:string;expected:MemoryMovieSnapshot;signal:AbortSignal;
 originalAudio:boolean;scoreVolume:number|null;reduceMotion:boolean;capture:(value:NativeMemoryCapture,signal:AbortSignal)=>Promise<string>;
 progress:(value:NativeMemoryProgress)=>void;onInvalid:(error:Error)=>void}){
 const controller=new AbortController(),signal=controller.signal,abort=()=>controller.abort();
 options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();
 let files:MemoryMovieFiles;
 try{files=new MemoryMovieFiles(signal);}catch(error){options.signal.removeEventListener('abort',abort);controller.abort();throw error;}
 const temporary=new Set<string>(),localSources=new Map<string,string>(),audioFiles=new Map<string,MemoryMovieAudio>(),rights=new Map<string,SoundtrackSelection>();
 let access:Awaited<ReturnType<typeof openMemoryMovieAccess>>|null=null,timer:ReturnType<typeof setInterval>|undefined,finished=false,disposed=false;
 let output='';
 const fail=(error:unknown)=>{if(signal.aborted||disposed)return;const value=error instanceof Error?error:new Error('This memory movie is no longer available.');options.onInvalid(value);controller.abort();};
 const assertRights=async()=>{files.check();await access!.check();for(const selection of rights.values())await memoryMovieStep(authorizeLibraryAudioExport(supabase,selection,'memory_album'),signal,'The soundtrack’s export permission could not be checked.');files.check();};
 const release=()=>{if(disposed)return;disposed=true;controller.abort();if(timer)clearInterval(timer);access?.stop();options.signal.removeEventListener('abort',abort);files.dispose();temporary.forEach(remove);remove(output);};
 const normalize=async(uri:string)=>{
  const key=contentObject(uri,SUPABASE_URL)?.key??uri,known=localSources.get(key);if(known)return known;
  const downloaded=await files.download(uri,imageLimit,'image',true),target=new File(Paths.cache,'pc-memory-image-'+Crypto.randomUUID()+'.png').uri;temporary.add(target);
  const prepared=await prepareMemoryMovieImage({id:Crypto.randomUUID(),inputUri:downloaded,outputUri:target},signal);
  const counted=await files.copy(prepared.uri,imageLimit);remove(prepared.uri);temporary.delete(target);localSources.set(key,counted);return counted;
 };
 const artwork=async<T,>(value:T,depth=0):Promise<T>=>{
  if(depth>20)throw new Error('The memory artwork is too deeply nested.');
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value)){const values=[];for(const child of value)values.push(await artwork(child,depth+1));return values as T;}
  const result:Record<string,unknown>={};
  for(const [key,child]of Object.entries(value))result[key]=imageFields.has(key)&&typeof child==='string'&&child?await normalize(child):await artwork(child,depth+1);
  return result as T;
 };
 const audio=async(selection:SoundtrackSelection):Promise<MemoryMovieAudio>=>{
  const key=[selection.soundId,selection.startSec,selection.durationSec].join(':');rights.set(key,selection);const known=audioFiles.get(key);if(known)return {...known,volume:selection.volume};
  const track=await memoryMovieStep(authorizeLibraryAudioExport(supabase,selection,'memory_album'),signal,'The soundtrack’s export permission could not be checked.');
  const [safe]=await memoryMovieStep(hydrateSoundMedia([track]),signal,'The soundtrack could not be prepared.');
  if(!safe?.url)throw new Error('The soundtrack’s private file is unavailable.');
  const downloaded=await files.download(safe.url,ORIGINAL_AUDIO_MAX_BYTES,'audio'),file=new File(downloaded);
  const info=inspectOriginalAudio(await memoryMovieStep(file.bytes(),signal,'The soundtrack could not be inspected.'));files.check();
  if(selection.startSec+selection.durationSec>info.durationSec+.01)throw new Error('The saved soundtrack excerpt exceeds its recording.');
  const verified=await files.copy(downloaded,ORIGINAL_AUDIO_MAX_BYTES,info.extension);remove(downloaded);
  const value={uri:verified,start:selection.startSec,duration:selection.durationSec,volume:selection.volume,loop:true};audioFiles.set(key,value);return value;
 };
 try{
  output=new File(Paths.cache,'pc-memory-export-'+Crypto.randomUUID()+'.mp4').uri;
  access=await openMemoryMovieAccess({client:supabase,base:SUPABASE_URL,bookId:options.bookId,expected:options.expected,signal,onInvalid:fail});
  let checking=false;timer=setInterval(()=>{if(checking||disposed)return;checking=true;void assertRights().catch(fail).finally(()=>{checking=false;});},30000);
  const initial=planMemoryMovie(access.book.pages,access.book.film_settings),sourceItems=memoryFilmItems(access.book.pages),durations:Record<string,number>={};
  const selected=initial.scenes.map(scene=>access!.book.pages[scene.sourceIndex]),problem=memoryMovieLimit(selected,access.book.soundtrack);if(problem)throw new Error(problem);
  for(const scene of initial.scenes){if(scene.kind!=='video')continue;files.check();
   options.progress({message:'Reading the movie’s video timing…',percent:0});
   const current=await access.check(),[safe]=await memoryMovieStep(hydrateMemoryAlbumMedia([current]),signal,'A memory’s private media could not be prepared.');
   const item=memoryFilmItems(safe.pages)[scene.sourceIndex],key=item.uri&&contentObject(item.uri,SUPABASE_URL)?.key;
   if(!item.uri||!key)throw new Error('The original memory video is unavailable.');
   let uri=localSources.get(key);if(!uri){uri=await files.download(item.uri,512*1024*1024,'mp4');localSources.set(key,uri);}
   durations[sourceItems[scene.sourceIndex].id]=await videoDuration(uri,signal);
  }
  const plan=planMemoryMovie(access.book.pages,access.book.film_settings,durations);if(plan.estimated)throw new Error('A memory video’s timing could not be verified.');
  const timeline=memoryMovieTimeline(access.book.pages,plan,access.book.title),scenes:MemoryMovieNativeScene[]=[],gain:{start:number;end:number;volume:number}[]=[];let elapsed=0,rasters=0;
  for(const [index,planned]of timeline.entries()){
   files.check();await assertRights();options.progress({message:`Preparing scene ${index+1} of ${timeline.length}…`,percent:Math.round(index/timeline.length*70)});
   let item=planned;
   if(!planned.movie.titleCard){
    const current=await access.check(),[safe]=await memoryMovieStep(hydrateMemoryAlbumMedia([current]),signal,'A memory’s private artwork could not be prepared.');
    const page=safe.pages.find(page=>page.id===planned.page.id);if(!page)throw new Error('A memory changed during export.');
    const hydrated=memoryFilmItems([page])[0],pageArt=await artwork({...page,stickers:memoryStoryStickers(page.stickers).filter(sticker=>sticker.kind!=='post')});
    if(hydrated.kind==='image'&&hydrated.uri){pageArt.media_url=await normalize(hydrated.uri);pageArt.media_type='image';}
    else if(hydrated.kind==='video'&&hydrated.uri){pageArt.media_url=localSources.get(contentObject(hydrated.uri,SUPABASE_URL)?.key??'')??null;pageArt.media_type='video';}
    item={...planned,page:{...pageArt,media_transform:planned.page.media_transform},uri:pageArt.media_url??null,poster:null};
   }
   const seconds=item.movie.durationSec,recipe:StoryVideoRecipe={width:720,height:1280,trimStart:0,trimEnd:seconds,speed:1,volume:0,fit:'contain',scale:1,x:0,y:0,matrix:identity};
   if(item.kind==='video'){
    const window=memoryFilmVideoWindow(item.page,durations[item.id]);if(window.end==null||window.seconds==null||Math.abs(window.seconds-seconds)>.05)throw new Error('A memory’s video timing changed during preparation.');
    Object.assign(recipe,{trimStart:window.start,trimEnd:window.end,speed:window.speed,volume:options.originalAudio?window.volume:0,fit:window.fit,scale:window.scale,x:window.x,y:window.y,matrix:storyPhotoColorMatrix({filterId:item.page.filter_id,filterAmt:window.filterAmt,adjust:window.adjust})});
   }
   const capture=async(layer:'background'|'overlay',clock:number)=>{const uri=await options.capture({item,layer,clock},signal);temporary.add(uri);const copied=await files.copy(uri,imageLimit);remove(uri);temporary.delete(uri);return copied;};
   const background=await capture('background',recipe.trimStart),windows=storyVideoLayerWindows(memoryStoryStickers(item.page.stickers),recipe),layers=[];
   rasters+=windows.length;if(rasters>240)throw new Error('This movie has too many timed artwork changes. Choose a shorter cut.');
   for(const window of windows)layers.push({uri:await capture('overlay',window.clock),start:window.start,end:window.end});
   const pageSound=memoryPageSoundtrack(item.page),pageAudio=pageSound?await audio(pageSound):undefined;
   scenes.push({id:Crypto.randomUUID(),inputUri:item.kind==='video'?item.uri!:background,inputKind:item.kind==='video'?'video':'image',recipe,backgroundUri:item.kind==='video'?background:undefined,layers,audio:pageAudio,
    transition:{fadeSec:options.reduceMotion?0:item.movie.fadeSec},motion:options.reduceMotion?{fromScale:1,toScale:1,x:0,y:0}:item.movie.motion});
   gain.push({start:elapsed,end:elapsed+seconds,volume:recipe.volume>0||pageSound?MEMORY_SCORE_DUCK:1});elapsed+=seconds;
  }
  let soundtrack:MemoryMovieNativeRequest['soundtrack'];const saved=readSoundtrack(access.book.soundtrack);
  if(saved)soundtrack={...await audio(saved),gain};
  else if(options.scoreVolume!=null){
   if(!Number.isFinite(options.scoreVolume)||options.scoreVolume<0||options.scoreVolume>1)throw new Error('Choose a background music level between 0 and 100%.');
   const asset=Asset.fromModule(require('../../assets/audio/platinum-memory-score.m4a'));await memoryMovieStep(asset.downloadAsync(),signal,'The original memory score could not be loaded.');
   if(!asset.localUri?.startsWith('file://'))throw new Error('The original memory score is unavailable in this build.');
   const uri=await files.copy(asset.localUri,12*1024*1024,'m4a'),info=inspectOriginalAudio(await new File(uri).bytes());
   soundtrack={uri,start:0,duration:info.durationSec,volume:options.scoreVolume,loop:true,gain};
  }
  const request:MemoryMovieNativeRequest={id:Crypto.randomUUID(),outputUri:output,width:720,height:1280,scenes,soundtrack};validateMemoryMovieRequest(request);await assertRights();
  options.progress({message:'Encoding your memory movie…',percent:75});const result=await composeMemoryMovie(request,signal);await assertRights();
  options.progress({message:'The movie is ready to save.',percent:100});finished=true;
  return {result,memories:plan.selectedCount,assertRights,release};
 }catch(error){release();throw error;}finally{if(!finished)release();}
}
