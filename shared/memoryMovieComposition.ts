import type {StoryVideoRecipe} from './storyVideoComposition';

export type MemoryMovieAudio={uri:string;start:number;duration:number;volume:number;loop:boolean};
export type MemoryMovieMotion={fromScale:number;toScale:number;x:number;y:number};
export type MemoryMovieNativeScene={
  id:string;inputUri:string;inputKind:'image'|'video';recipe:StoryVideoRecipe;
  backgroundUri?:string;layers:{uri:string;start:number;end:number}[];audio?:MemoryMovieAudio;
  transition:{fadeSec:number};motion:MemoryMovieMotion;
};
export type MemoryMovieNativeRequest={
  id:string;outputUri:string;width:720;height:1280;scenes:MemoryMovieNativeScene[];
  soundtrack?:MemoryMovieAudio & {gain:{start:number;end:number;volume:number}[]};
};
export type MemoryMovieNativeResult={uri:string;duration:number;width:number;height:number;bytes:number;sceneCount:number;soundtrackMixed:boolean};
const finite=(value:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const local=(uri:string)=>typeof uri==='string'&&uri.startsWith('file://');
const identity=(id:string)=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,120}$/.test(id);
function audio(value:MemoryMovieAudio){return local(value.uri)&&finite(value.start,0,600)&&finite(value.duration,1,600)&&finite(value.volume,0,1)&&typeof value.loop==='boolean';}

/** Native code repeats these bounds before opening files or allocating frames. */
export function validateMemoryMovieRequest(request:MemoryMovieNativeRequest):number{
 if(!request||!identity(request.id)||!local(request.outputUri)||request.width!==720||request.height!==1280||!Array.isArray(request.scenes)||request.scenes.length<1||request.scenes.length>82)throw new Error('The memory movie request is invalid. Reopen the book and try again.');
 const ids=new Set<string>();let duration=0,layers=0;
 for(const scene of request.scenes){
  if(!scene||!identity(scene.id)||ids.has(scene.id)||!local(scene.inputUri)||!['image','video'].includes(scene.inputKind))throw new Error('A movie scene is invalid. Prepare the book again.');ids.add(scene.id);
  const r=scene.recipe;
  if(!r||r.width!==720||r.height!==1280||!finite(r.trimStart,0,600)||!finite(r.trimEnd,r.trimStart+.05,660)||r.trimEnd-r.trimStart>60.001||!finite(r.speed,.25,4)||!finite(r.volume,0,1)||!['contain','cover'].includes(r.fit)||!finite(r.scale,.35,5)||!finite(r.x,-2,2)||!finite(r.y,-2,2)||!Array.isArray(r.matrix)||r.matrix.length!==20||r.matrix.some(n=>!finite(n,-16,16)))throw new Error('A movie scene has an unsupported edit.');
  const seconds=(r.trimEnd-r.trimStart)/r.speed;
  if(!finite(seconds,.05,120)||scene.inputKind==='image'&&(r.trimStart!==0||r.speed!==1||seconds<1||seconds>30))throw new Error('A movie scene is too long. Choose a shorter cut.');
  const m=scene.motion;
  if(!scene.transition||!finite(scene.transition.fadeSec,0,Math.min(.5,seconds/2))||!m||!finite(m.fromScale,1,1.1)||!finite(m.toScale,1,1.1)||!finite(m.x,-.05,.05)||!finite(m.y,-.05,.05))throw new Error('The movie movement is invalid.');
  if(scene.backgroundUri&&!local(scene.backgroundUri)||!Array.isArray(scene.layers)||scene.layers.length>24||scene.layers.some(layer=>!local(layer.uri)||!finite(layer.start,0,seconds)||!finite(layer.end,layer.start+.001,seconds+.001))||scene.audio&&!audio(scene.audio))throw new Error('A movie artwork or audio layer is invalid.');
  layers+=scene.layers.length;duration+=seconds;
 }
 if(duration>300.001||layers>240)throw new Error('This movie exceeds its time or artwork limit. Choose a shorter cut.');
 if(request.soundtrack){
  const sound=request.soundtrack;
  if(!audio(sound)||!Array.isArray(sound.gain)||sound.gain.length!==request.scenes.length)throw new Error('The book soundtrack is invalid. Choose it again.');
  let cursor=0;
  for(const [index,window]of sound.gain.entries()){
   const r=request.scenes[index].recipe,expected=(r.trimEnd-r.trimStart)/r.speed;
   if(!finite(window.start,0,duration)||Math.abs(window.start-cursor)>.002||!finite(window.end,window.start+.01,duration+.002)||Math.abs(window.end-window.start-expected)>.002||!finite(window.volume,0,1))throw new Error('The book soundtrack timing is invalid.');cursor=window.end;
  }
 }
 return duration;
}
export function validateMemoryMovieResult(request:MemoryMovieNativeRequest,result:unknown):MemoryMovieNativeResult{
 const duration=validateMemoryMovieRequest(request),value=result as MemoryMovieNativeResult|null;
 if(!value||value.uri!==request.outputUri||value.width!==720||value.height!==1280||value.sceneCount!==request.scenes.length||!finite(value.duration,Math.max(.01,duration-.15),duration+.2)||!Number.isSafeInteger(value.bytes)||!finite(value.bytes,1024,256*1024*1024)||typeof value.soundtrackMixed!=='boolean'||!!request.soundtrack!==value.soundtrackMixed)throw new Error('The exported memory movie could not be verified. No file was saved.');
 return value;
}
