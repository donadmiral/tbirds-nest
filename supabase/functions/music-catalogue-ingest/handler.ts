import { inspectOriginalAudio, ORIGINAL_AUDIO_MAX_BYTES } from '../../../shared/originalAudio.ts';
type Asset = { trackId:string;providerId:string;path:string;mime:string;bytes:number;sha256:string;status:'reserved'|'ready';soundId:string|null };
type Dependencies = {
 reserve(token:string,track:string,bytes:number,mime:string,sha256:string,signal:AbortSignal):Promise<Asset|null>;
 store(asset:Asset,bytes:Uint8Array,signal:AbortSignal):Promise<boolean>;
 read(token:string,asset:Asset,signal:AbortSignal):Promise<{response:Response;version:string}|null>;
 finish(token:string,asset:Asset,duration:number,sha256:string,version:string,signal:AbortSignal):Promise<string|null>;
 digest(bytes:Uint8Array):Promise<string>;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>reject(new Error('Deadline'));if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
async function bytesFrom(body:ReadableStream<Uint8Array>|null,expected:number,signal:AbortSignal):Promise<Uint8Array>{
 if(!body)throw new Error('Body required');
 const reader=body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){const next=await bounded(reader.read(),signal);if(next.done)break;total+=next.value.byteLength;if(total>expected||total>ORIGINAL_AUDIO_MAX_BYTES)throw new Error('Size exceeded');chunks.push(next.value);}
  if(total!==expected)throw new Error('Size mismatch');
  const output=new Uint8Array(total);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.byteLength;}return output;
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createCatalogueIngestHandler(deps:Dependencies){
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return reply(405,{error:'Use POST'});
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,''),track=request.headers.get('X-Catalogue-Track')||'',sha=request.headers.get('X-Audio-Sha256')||'';
  const count=request.headers.get('Content-Length')||'',size=Number(count),mime=request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()||'';
  if(!/^pc_catalogue_[0-9a-f]{64}$/.test(token))return reply(401,{error:'Provider authentication required'});
  if(!UUID.test(track)||!/^\d+$/.test(count)||!Number.isSafeInteger(size)||size<44||size>ORIGINAL_AUDIO_MAX_BYTES||!['audio/wav','audio/mpeg','audio/mp4'].includes(mime)||!/^[a-f0-9]{64}$/.test(sha))return reply(400,{error:'Valid track, digest, content type and bounded byte length required'});
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,45000);
  request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  const signal=controller.signal;
  try{
   const asset=await bounded(deps.reserve(token,track,size,mime,sha,signal),signal);
   const ext=mime==='audio/wav'?'wav':mime==='audio/mpeg'?'mp3':'m4a';
   if(!asset||asset.trackId!==track||!/^[a-z0-9_-]{1,60}$/.test(asset.providerId)||asset.path!==`catalogue/${asset.providerId}/${track}/${sha}.${ext}`||asset.bytes!==size||asset.mime!==mime||asset.sha256!==sha)return reply(403,{error:'Catalogue ingestion is unavailable or its verified licence is missing'});
   if(asset.status==='ready'&&UUID.test(asset.soundId||'')){void request.body?.cancel().catch(()=>{});return reply(200,{soundId:asset.soundId,replayed:true});}
   if(asset.status!=='reserved')return reply(409,{error:'Catalogue asset unavailable'});
   const incoming=await bytesFrom(request.body,size,signal),inspected=inspectOriginalAudio(incoming);
   if(inspected.mime!==mime||await bounded(deps.digest(incoming),signal)!==sha)return reply(422,{error:'Audio verification failed'});
   if(!await bounded(deps.store(asset,incoming,signal),signal))return reply(503,{error:'Private storage is unavailable. Retry the same track revision.'});
   // Read the actual persisted object. A retry cannot adopt arbitrary existing
   // bytes just because Storage answered conflict for its immutable path.
   const stored=await bounded(deps.read(token,asset,signal),signal);
   if(!stored||!stored.response.ok||!stored.version){void stored?.response.body?.cancel().catch(()=>{});return reply(409,{error:'Stored asset is not ready for verification'});}
   const actual=await bytesFrom(stored.response.body,size,signal),verified=inspectOriginalAudio(actual),digest=await bounded(deps.digest(actual),signal);
   if(verified.mime!==mime||digest!==sha)return reply(409,{error:'Stored audio does not match this catalogue revision'});
   const soundId=await bounded(deps.finish(token,asset,verified.durationSec,digest,stored.version,signal),signal);
   if(!soundId||!UUID.test(soundId))return reply(409,{error:'The licence or stored audio changed before verification completed'});
   return reply(200,{soundId,replayed:false});
  }catch{return reply(controller.signal.aborted?408:422,{error:controller.signal.aborted?'Verification timed out. Retry this track revision.':'The catalogue audio could not be verified.'});}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);controller.abort();}
 };
}
