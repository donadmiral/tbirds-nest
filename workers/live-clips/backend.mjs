import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
const proof=job=>({id:job.id,lease_id:job.lease_id});
export function clipBackend({base,secret,cdnOrigin,fetcher=fetch,now=Date.now}){
 const origin=new URL(base),cdn=new URL(cdnOrigin);
 if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash
  ||cdn.protocol!=='https:'||cdn.pathname!=='/'||cdn.username||cdn.password||cdn.search||cdn.hash||typeof secret!=='string'||secret.length<32)throw Error('clip_backend_invalid');
 const endpoint=origin.origin+'/functions/v1/live-clip-worker';
 async function call(action,args,signal){
  const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({action,...args}),signal,redirect:'error'});
  if(!response.ok){await response.body?.cancel();const error=Error(response.status===409?'clip_lease_lost':'clip_backend_unavailable');error.permanent=response.status===409;throw error;}
  const reader=response.body?.getReader();if(!reader)throw Error('clip_backend_unavailable');const chunks=[];let bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>1048576)throw Error('clip_backend_response_limit');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')).data;
 }
 return{
  async maintain(signal){return call('maintain',{},signal);},
  async claim(signal){const result=await call('claim',{},signal);if(!Array.isArray(result?.items)||result.items.length>1)throw Error('clip_claim_invalid');return result.items[0]||null;},
  async check(job,signal){return (await call('check',proof(job),signal))?.ok===true;},
  async source(job,signal){const result=await call('source',proof(job),signal),url=new URL(result.url),expires=Date.parse(result.expires_at),time=now();
   if(url.origin!==cdn.origin||!url.pathname.startsWith('/_live/')||!url.pathname.endsWith('/'+job.source_path)||url.username||url.password||url.hash
    ||!Number.isFinite(expires)||expires<=time||expires>time+120000)throw Error('clip_source_grant_invalid');return url.href;},
  async upload(job,asset,file,signal){
   const result=await call('upload',{...proof(job),asset},signal),url=new URL(result.url),path=job.output_prefix+asset.name;
   if(result.bucket!=='live-clips'||result.path!==path||result.bytes!==asset.bytes||result.content_type!==asset.content_type
    ||result.metadata?.live_clip_id!==job.clip_id||result.metadata?.live_clip_job_id!==job.id||result.metadata?.live_clip_lease_id!==job.lease_id||result.metadata?.sha256!==asset.sha256
    ||url.origin!==origin.origin||url.pathname!==`/storage/v1/object/upload/sign/live-clips/${path}`||!url.searchParams.get('token')||url.username||url.password||url.hash)throw Error('clip_upload_grant_invalid');
   const response=await fetcher(url,{method:'PUT',headers:{'Content-Type':asset.content_type,'Content-Length':String(asset.bytes),'cache-control':'max-age=0','x-upsert':'false',
    'x-metadata':Buffer.from(JSON.stringify(result.metadata)).toString('base64')},body:Readable.toWeb(createReadStream(file)),duplex:'half',signal,redirect:'error'});
   if(!response.ok){await response.body?.cancel();throw Error('clip_upload_failed');}await response.body?.cancel();
  },
  async complete(job,manifest,signal){const result=await call('finish',{...proof(job),ok:true,manifest},signal);return result?.ok===true&&result.state==='ready';},
  async fail(job,result,signal){return call('finish',{...proof(job),ok:false,error:(result.permanent?'permanent_':'')+result.code},signal);},
 };
}
