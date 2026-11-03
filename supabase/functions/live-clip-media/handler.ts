import { validUuid, sha256 } from '../live-core/provider.ts';
import { readBoundedJson, bodyErrorStatus } from '../live-clip-worker/body.ts';
type Client = {auth:{getUser():PromiseLike<{data:{user:{id:string;is_anonymous?:boolean}|null};error:unknown}>};rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:any;error:unknown}>};
type Dependencies={base:string;caller(request:Request):Client;sign(path:string,ttl:number):Promise<string|null>;now?:()=>number};
const names:Record<string,string>={horizontal:'horizontal.mp4',vertical:'vertical.mp4',thumbnail:'thumbnail.jpg',captions:'captions.vtt'};
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export function validClipPath(value:unknown,clipId:string,name:string):value is string {
 if(typeof value!=='string')return false;const parts=value.split('/');
 return parts.length===5&&parts.slice(0,4).every(validUuid)&&parts[2]===clipId&&parts[4]===name;
}
export function createClipMediaHandler(deps:Dependencies){return async(request:Request)=>{
 const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
 try{
  const caller=deps.caller(request),auth=await caller.auth.getUser();
  if(auth.error||!auth.data.user||auth.data.user.is_anonymous)return json(401,{error:'AUTH_REQUIRED'});
  let body:any;try{body=await readBoundedJson(request,4096,request.signal);}catch(error){const status=bodyErrorStatus(error);return json(status,{error:status===413?'REQUEST_TOO_LARGE':status===408?'REQUEST_TIMED_OUT':'INVALID_CLIP_ASSET'});}
  if(!body||!validUuid(body.clipId)||typeof body.format!=='string'||!Object.hasOwn(names,body.format)||Object.keys(body).some(key=>!['clipId','format'].includes(key)))return json(400,{error:'INVALID_CLIP_ASSET'});
  const args={p_clip_id:body.clipId,p_format:body.format};
  const initial=await caller.rpc('live_clip_asset_access',args),asset=initial.data;
  if(initial.error||!asset||asset.bucket!=='live-clips'||!validClipPath(asset.object_path,body.clipId,names[body.format]))return json(403,{error:'CLIP_NOT_AVAILABLE'});
  const before=deps.now?.()??Date.now();const signed=await deps.sign(asset.object_path,120);if(!signed)return json(503,{error:'CLIP_MEDIA_UNAVAILABLE'});
  const url=new URL(signed);if(url.origin!==new URL(deps.base).origin||url.pathname!==`/storage/v1/object/sign/live-clips/${asset.object_path}`||!url.searchParams.get('token')||url.username||url.password||url.hash)throw Error('INVALID_STORAGE_GRANT');
  const current=await caller.rpc('live_clip_asset_access',args);
  if(current.error||!current.data||await sha256(JSON.stringify([current.data.bucket,current.data.object_path]))!==await sha256(JSON.stringify([asset.bucket,asset.object_path])))return json(403,{error:'CLIP_NOT_AVAILABLE'});
  const filename=typeof asset.filename==='string'?asset.filename.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120):`platinum-live-${body.clipId}.${names[body.format].split('.').at(-1)}`;
  return json(200,{url:url.href,filename,expires_at:new Date(before+120000).toISOString()});
 }catch{return json(503,{error:'CLIP_MEDIA_UNAVAILABLE'});}
};}
