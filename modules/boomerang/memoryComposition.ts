import {requireOptionalNativeModule} from 'expo-modules-core';
import {Platform} from 'react-native';
import {validateMemoryMovieRequest,validateMemoryMovieResult,type MemoryMovieNativeRequest,type MemoryMovieNativeResult} from '../../shared/memoryMovieComposition';

export type MemoryMovieImageRequest={id:string;inputUri:string;outputUri:string};
export type MemoryMovieImageResult={uri:string;width:number;height:number;bytes:number};
type NativeMemoryModule={memoryMovieVersion?:number;composeMemoryMovie?:(request:MemoryMovieNativeRequest)=>Promise<unknown>;prepareMemoryMovieImage?:(request:MemoryMovieImageRequest)=>Promise<unknown>;cancelMemoryMovie?:(id:string)=>Promise<void>};
const native=requireOptionalNativeModule<NativeMemoryModule>('Boomerang');
export const memoryMovieCompositionAvailable=(Platform.OS==='ios'||Platform.OS==='android')&&native?.memoryMovieVersion===1&&typeof native.composeMemoryMovie==='function'&&typeof native.prepareMemoryMovieImage==='function'&&typeof native.cancelMemoryMovie==='function';
export async function prepareMemoryMovieImage(request:MemoryMovieImageRequest,signal?:AbortSignal):Promise<MemoryMovieImageResult>{
 if(!memoryMovieCompositionAvailable)throw new Error('Preparing memory photos needs the new app build. Your book is kept.');
 if(request.id.length<8||request.id.length>120||!request.inputUri.startsWith('file://')||!request.outputUri.startsWith('file://')||!/\/pc-memory-image-[^/]+\.png$/.test(request.outputUri))throw new Error('The memory photo request is invalid.');
 if(signal?.aborted)throw new Error('Memory movie export was cancelled.');
 const cancel=()=>{void native!.cancelMemoryMovie!(request.id).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{const value=await native!.prepareMemoryMovieImage!(request);if(signal?.aborted)throw new Error('Memory movie export was cancelled.');
  const result=value as Partial<MemoryMovieImageResult>|null;
  if(!result||result.uri!==request.outputUri||!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.width!<1||result.width!>1440||result.height!<1||result.height!>2560||!Number.isInteger(result.bytes)||result.bytes!<1||result.bytes!>32*1024*1024)throw new Error('The prepared memory photo could not be verified.');
  return result as MemoryMovieImageResult;
 }finally{signal?.removeEventListener('abort',cancel);}
}
export async function composeMemoryMovie(request:MemoryMovieNativeRequest,signal?:AbortSignal):Promise<MemoryMovieNativeResult>{
 if(!memoryMovieCompositionAvailable)throw new Error(`Saving a whole memory movie needs the new ${Platform.OS==='android'?'Android':'iPhone'} build. Your book and soundtrack are kept.`);
 validateMemoryMovieRequest(request);
 if(signal?.aborted)throw new Error('Memory movie export was cancelled.');
 const cancel=()=>{void native!.cancelMemoryMovie!(request.id).catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 try{const result=await native!.composeMemoryMovie!(request);if(signal?.aborted)throw new Error('Memory movie export was cancelled.');return validateMemoryMovieResult(request,result);}
 finally{signal?.removeEventListener('abort',cancel);}
}
