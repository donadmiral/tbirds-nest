import {Directory,File,Paths} from 'expo-file-system';
import {fetch as expoFetch} from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import {isContentCapability} from '../../shared/contentMedia';
import {SUPABASE_URL} from './supabase';

export const MEMORY_MOVIE_FILE_BUDGET=512*1024*1024;
const CHUNK=64*1024;
export async function memoryMovieStep<T>(work:PromiseLike<T>,signal:AbortSignal,label:string,timeout=20000):Promise<T>{
 if(signal.aborted)throw new Error('Memory movie export was cancelled.');
 let timer:ReturnType<typeof setTimeout>|undefined;let stop=()=>{};
 try{return await Promise.race([Promise.resolve(work),new Promise<never>((_,reject)=>{stop=()=>reject(new Error('Memory movie export was cancelled.'));signal.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>reject(new Error(label)),timeout);if(signal.aborted)stop();})]);}
 finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',stop);}
}

/** Every byte is counted before it is written. Abort closes the network reader. */
export class MemoryMovieFiles{
 readonly directory:Directory;
 private bytes=0;
 private closed=false;
 constructor(private readonly signal:AbortSignal){
  this.directory=new Directory(Paths.cache,'pc-memory-work-'+Crypto.randomUUID());
  if(Paths.availableDiskSpace<128*1024*1024)throw new Error('Free some space on this device before making a memory movie.');
  this.directory.create();
 }
 check(){if(this.closed||this.signal.aborted)throw new Error('Memory movie export was cancelled.');}
 private target(extension:string){this.check();const file=new File(this.directory,Crypto.randomUUID()+'.'+extension);file.create();return file;}
 private write(handle:ReturnType<File['open']>,chunk:Uint8Array,limit:number,used:number){
  this.check();if(used+chunk.byteLength>limit||this.bytes+chunk.byteLength>MEMORY_MOVIE_FILE_BUDGET)throw new Error('The movie’s source files exceed the device export limit. Choose a shorter cut.');
  if(Paths.availableDiskSpace<chunk.byteLength+64*1024*1024)throw new Error('The device is running out of space. No incomplete movie was saved.');
  for(let offset=0;offset<chunk.byteLength;offset+=CHUNK){this.check();const part=chunk.subarray(offset,offset+CHUNK);handle.writeBytes(part);this.bytes+=part.byteLength;}
 }
 async download(url:string,limit:number,extension='bin',publicAvatar=false):Promise<string>{
  this.check();let avatar=false;try{const parsed=new URL(url),base=new URL(SUPABASE_URL);avatar=publicAvatar&&parsed.origin===base.origin&&!parsed.username&&!parsed.password&&!parsed.hash&&!parsed.search&&/^\/storage\/v1\/object\/public\/avatars\/[A-Za-z0-9/_\-.]+$/.test(parsed.pathname)&&!parsed.pathname.includes('..');}catch{}
  if(!isContentCapability(url,SUPABASE_URL)&&!avatar)throw new Error('A memory needs a fresh private media link. Reopen the book and retry.');
  const file=this.target(extension),controller=new AbortController();let handle:ReturnType<File['open']>|null=null,reader:ReadableStreamDefaultReader<Uint8Array>|null=null,used=0,complete=false;
  const cancel=()=>{controller.abort();void reader?.cancel().catch(()=>{});};
  this.signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,120000);if(this.signal.aborted)cancel();
  try{
   handle=file.open();
   const response=await memoryMovieStep(expoFetch(url,{signal:controller.signal,credentials:'omit',redirect:'error'}),controller.signal,'A memory took too long to download.');
   const length=Number(response.headers.get('content-length'));
   if(!response.ok||!response.body||Number.isFinite(length)&&length>limit)throw new Error('A memory source is missing or too large. Refresh the book and retry.');
   reader=response.body.getReader();
   while(true){const next=await memoryMovieStep(reader.read(),controller.signal,'A memory download stopped responding.');this.check();if(next.done)break;this.write(handle,next.value,limit,used);used+=next.value.byteLength;}
   if(!used||file.size!==used)throw new Error('The memory download could not be verified.');complete=true;return file.uri;
  }finally{clearTimeout(timer);this.signal.removeEventListener('abort',cancel);cancel();try{reader?.releaseLock();}catch{}try{handle?.close();}catch{}if(!complete){try{file.delete();}catch{}}}
 }
 async copy(uri:string,limit:number,extension='png'):Promise<string>{
  this.check();if(!uri.startsWith('file://'))throw new Error('The movie’s temporary artwork is not a local file.');
  const source=new File(uri);if(!source.exists||source.size<=0||source.size>limit)throw new Error('A movie source is missing or too large.');
  const file=this.target(extension);let input:ReturnType<File['open']>|null=null,output:ReturnType<File['open']>|null=null,used=0,complete=false;
  try{input=source.open();output=file.open();while(true){this.check();const chunk=input.readBytes(CHUNK);if(!chunk.length)break;this.write(output,chunk,limit,used);used+=chunk.length;if(used%(1024*1024)===0)await memoryMovieStep(new Promise<void>(resolve=>setTimeout(resolve,0)),this.signal,'Preparing a memory took too long.');}if(used!==source.size||file.size!==used)throw new Error('A movie source changed while copying.');complete=true;return file.uri;}
  finally{try{input?.close();}catch{}try{output?.close();}catch{}if(!complete){try{file.delete();}catch{}}}
 }
 dispose(){if(this.closed)return;this.closed=true;try{this.directory.delete();}catch{}}
}
