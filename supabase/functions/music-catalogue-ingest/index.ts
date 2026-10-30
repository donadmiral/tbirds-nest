import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createCatalogueIngestHandler } from './handler.ts';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const client=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}});
const objectUrl=(path:string)=>`${base}/storage/v1/object/music-audio/${path.split('/').map(encodeURIComponent).join('/')}`;
Deno.serve(createCatalogueIngestHandler({
 async reserve(token,track,bytes,mime,sha256,signal){const{data,error}=await client.rpc('reserve_catalogue_audio',{p_token:token,p_track:track,p_bytes:bytes,p_mime:mime,p_sha256:sha256,p_origin:base}).abortSignal(signal);return error?null:data;},
 async store(asset,bytes,signal){
  const response=await fetch(objectUrl(asset.path),{method:'POST',headers:{Authorization:`Bearer ${key}`,apikey:key,'Content-Type':asset.mime,'x-upsert':'false','Cache-Control':'no-store'},body:bytes,signal,redirect:'error'});
  void response.body?.cancel().catch(()=>{});return response.ok||response.status===409;
 },
 async read(token,asset,signal){
  const{data,error}=await client.rpc('catalogue_audio_object',{p_token:token,p_track:asset.trackId}).abortSignal(signal);
  if(error||!data?.version||Number(data.bytes)!==asset.bytes)return null;
  const response=await fetch(objectUrl(asset.path).replace('/object/','/object/authenticated/'),{headers:{Authorization:`Bearer ${key}`,apikey:key,'Cache-Control':'no-store'},cache:'no-store',signal,redirect:'error'});
  return{response,version:String(data.version)};
 },
 async finish(token,asset,duration,sha256,version,signal){const{data,error}=await client.rpc('finish_catalogue_audio',{p_token:token,p_track:asset.trackId,p_duration:duration,p_sha256:sha256,p_object_version:version}).abortSignal(signal);return error?null:data;},
 async digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');},
}));
