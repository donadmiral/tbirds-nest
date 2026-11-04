// Authenticate Daily events before routing, diagnostic logging or database writes.
const PRODUCTION='https://prlkikhckbifseosbukl.supabase.co';
const QA='https://uaulhuelcfkjwojtymmw.supabase.co';
const TYPES=new Set(['streaming.started','streaming.updated','streaming.ended','streaming.error','streaming.warning']);
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const encoder=new TextEncoder();
function keyBytes(value){if(typeof value!=='string'||value.length>1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('INVALID_SIGNATURE');const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(bytes.length<32||bytes.length>768)throw Error('INVALID_SIGNATURE');return bytes;}
export async function boundedJson(message,max=131072){
 if(Number(message.headers.get('content-length')||0)>max)throw Error('REQUEST_TOO_LARGE');const reader=message.body?.getReader();if(!reader)throw Error('INVALID_JSON');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('REQUEST_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function signatureFor(event,timestamp,secret){const key=await crypto.subtle.importKey('raw',keyBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${JSON.stringify(event)}`)));return btoa(String.fromCharCode(...bytes));}
async function authenticated(event,timestamp,signature,secret,now){
 try{if(!timestamp||!/^\d{10,13}$/.test(timestamp)||!signature||signature.length>100||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return false;const issued=Number(timestamp)*(timestamp.length>10?1:1000);if(!Number.isSafeInteger(issued)||Math.abs(now-issued)>300000)return false;const key=await crypto.subtle.importKey('raw',keyBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),encoder.encode(`${timestamp}.${JSON.stringify(event)}`));}catch{return false;}
}
export function validateEvent(event){
 if(!object(event))return ['envelope'];const invalid=[];
 if(typeof event.id!=='string'||!event.id||event.id.length>200)invalid.push('id');
 if(typeof event.version!=='string'||!/^1\./.test(event.version))invalid.push('version');
 if(typeof event.type!=='string'||event.type.length>100)invalid.push('type');
 if(!object(event.payload))invalid.push('payload');
 if(invalid.length||!TYPES.has(event.type))return invalid;
 if(!uuid(event.payload.instance_id))invalid.push('instance_id');
 if(!Number.isSafeInteger(event.payload.timestamp)||event.payload.timestamp<=0||event.payload.timestamp>253402300799)invalid.push('timestamp');
 return invalid;
}
export function createDailyWebhook({origin,secret,domainId,relaySecret='',rpc,fetcher=fetch,now=Date.now,log=console.warn}){
 const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','CDN-Cache-Control':'no-store'}});
 return async request=>{
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(![PRODUCTION,QA].includes(origin))return json(503,{error:'PROVIDER_NOT_READY'});
  try{
   const event=await boundedJson(request);
   if(!await authenticated(event,request.headers.get('X-Webhook-Timestamp'),request.headers.get('X-Webhook-Signature'),secret,now()))return json(401,{error:'INVALID_SIGNATURE'});
   if(object(event)&&event.test==='test'&&Object.keys(event).length===1)return json(200,{ok:true});
   const invalid=validateEvent(event);
   if(invalid.length){
    // Signed protocol metadata only. Never raw payloads, request headers or credentials.
    const p=object(event?.payload)?event.payload:{};
    log(JSON.stringify({event:'live_webhook_schema_rejected',invalid,type:typeof event?.type==='string'?event.type.slice(0,60):typeof event?.type,version:typeof event?.version==='string'?event.version.slice(0,20):typeof event?.version,idLength:typeof event?.id==='string'?event.id.length:null,instanceIsUuid:uuid(p.instance_id),instanceLength:typeof p.instance_id==='string'?p.instance_id.length:null,timestampType:typeof p.timestamp,timestampIsInteger:Number.isSafeInteger(p.timestamp),timestamp:typeof p.timestamp==='number'&&Number.isFinite(p.timestamp)?p.timestamp:null,payloadKeys:Object.keys(p).filter(k=>/^[a-z_]{1,40}$/.test(k)).slice(0,20)}));
    return json(400,{error:'INVALID_EVENT'});
   }
   if(!TYPES.has(event.type))return json(200,{ok:true,ignored:true});
   if(!domainId||event.payload.domain_id!==domainId)return json(403,{error:'INVALID_DOMAIN'});
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(event))))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const result=await rpc({p_id:event.id,p_instance:event.payload.instance_id,p_type:event.type,p_time:new Date(event.payload.timestamp*1000).toISOString(),p_digest:digest});
   if(!object(result)||result.ok!==true)throw Error('EVENT_NOT_CONFIRMED');
   if(result.unknown_instance===true&&origin===PRODUCTION&&relaySecret){
    if(result.ignored!==true||result.duplicate===true||'session_id' in result)throw Error('EVENT_NOT_CONFIRMED');
    const timestamp=String(Math.floor(now()/1000));
    const response=await fetcher(QA+'/functions/v1/live-provider-webhook',{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),headers:{'Content-Type':'application/json','X-Webhook-Timestamp':timestamp,'X-Webhook-Signature':await signatureFor(event,timestamp,relaySecret),'X-Platinum-Live-Relay':'qa-v1'},body:JSON.stringify(event)});
    if(!response.ok||response.redirected){await response.body?.cancel();throw Error('QA_RELAY_UNCONFIRMED');}const ack=await boundedJson(response,4096);if(!object(ack)||ack.ok!==true)throw Error('QA_RELAY_UNCONFIRMED');return json(200,{...result,qa_relay:'acknowledged'});
   }
   return json(200,result);
  }catch(error){if(error?.message==='REQUEST_TOO_LARGE')return json(413,{error:'REQUEST_TOO_LARGE'});if(error instanceof SyntaxError||error?.message==='INVALID_JSON')return json(400,{error:'INVALID_REQUEST'});return json(503,{error:'LIVE_SERVICE_UNAVAILABLE'});}
 };
}
