// Genuine QA authentication and Storage/Edge requests. Never prints credentials or capability URLs.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [phase,statePath,keyPath]=process.argv.slice(2);
if(!['login','publish','probe','cleanup-storage'].includes(phase)||!statePath||!keyPath)throw new Error('phase state.json publishable-key-file required');
const state=JSON.parse(await readFile(statePath,'utf8')),root=dirname(statePath),key=(await readFile(keyPath,'utf8')).trim();
if(state.projectId!=='uaulhuelcfkjwojtymmw'||state.base!=='https://uaulhuelcfkjwojtymmw.supabase.co')throw new Error('QA-only canary');
if(!key.startsWith('sb_publishable_')){let role;try{role=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role;}catch{}if(role!=='anon')throw new Error('Only a publishable or legacy anon API key is allowed');}
const save=()=>writeFile(statePath,JSON.stringify(state,null,2)+'\n',{mode:0o600});
const safeReceipt=[];
async function request(path,{account,method='GET',body,headers={}}={}){
 const url=new URL(path,state.base);if(url.origin!==state.base)throw new Error('Cross-origin request rejected');
 const started=Date.now();const response=await fetch(url,{method,headers:{apikey:key,...(account?{Authorization:`Bearer ${account.accessToken}`}:{}) ,...headers},body,redirect:'error',signal:AbortSignal.timeout(30000)});
 const bytes=new Uint8Array(await response.arrayBuffer());
 return {status:response.status,headers:response.headers,bytes,text:()=>new TextDecoder().decode(bytes),json:()=>JSON.parse(new TextDecoder().decode(bytes)),elapsedMs:Date.now()-started};
}
async function jsonRequest(path,account,body){return request(path,{account,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const noStore=r=>assert(/\bno-store\b/i.test(r.headers.get('Cache-Control')||'')&&/\bno-store\b/i.test(r.headers.get('CDN-Cache-Control')||''),'Private original response is cacheable');
async function originalDecode(kind,url){
 const r=await request(url,{account:state.accounts.receiver});assert(r.status===200,'Original bytes HTTP '+r.status);noStore(r);
 const source=await readFile(join(root,'source.mp4')),sha=x=>createHash('sha256').update(x).digest('hex');
 assert(r.bytes.length===source.length&&sha(r.bytes)===sha(source),'Original bytes differ from the exact synthetic source');
 const file=join(root,kind+'-original.mp4');await writeFile(file,r.bytes,{mode:0o600});
 const decoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',file,'-frames:v','1',join(root,kind+'-original.png')],{encoding:'utf8',timeout:15000});assert(decoded.status===0,'Private original frame decode failed');
 safeReceipt.push({check:kind+'-original-no-store-decode',passed:true,bytes:r.bytes.length,sha256:sha(r.bytes),elapsedMs:r.elapsedMs});
 return source;
}
async function open(kind,account=state.accounts.receiver,requestId=state.media[kind].requestId){const r=await jsonRequest('/functions/v1/private-hls',account,{action:'open',messageId:state.media[kind].id,requestId});assert(r.status===200,'HLS open HTTP '+r.status);return r.json();}
async function fetchAndDecode(kind,grant){
 const user=state.accounts.receiver,url=new URL(grant.hlsUrl);assert(url.origin===state.base&&url.pathname==='/functions/v1/private-hls','Invalid private HLS endpoint');
 const master=await request(url,{account:user});assert(master.status===200&&master.text().startsWith('#EXTM3U'),'Private master failed');
 const variant=master.text().split('\n').find(l=>l.startsWith('https://'));assert(variant,'Variant missing');
 const playlist=await request(variant,{account:user});assert(playlist.status===200,'Private variant failed');
 const segmentURL=playlist.text().split('\n').find(l=>l.startsWith('https://'));assert(segmentURL,'Segment missing');
 const segment=await request(segmentURL,{account:user});assert(segment.status===200&&segment.bytes.length>0,'Private segment failed');
 const file=join(root,kind+'.ts');await writeFile(file,segment.bytes,{mode:0o600});
 const decoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',file,'-frames:v','1',join(root,kind+'.png')],{encoding:'utf8',timeout:15000});assert(decoded.status===0,'Private HLS frame decode failed');
 safeReceipt.push({check:kind+'-hls-decode',passed:true,masterMs:master.elapsedMs,variantMs:playlist.elapsedMs,segmentMs:segment.elapsedMs,segmentBytes:segment.bytes.length,segmentSha256:createHash('sha256').update(segment.bytes).digest('hex')});
 for(const [name,path,account,expected] of [['wrong-user',segmentURL,state.accounts.sender,410],['no-auth',segmentURL,null,401]]){const r=await request(path,{account});assert(r.status===expected,name+' denial HTTP '+r.status);safeReceipt.push({check:kind+'-'+name,passed:true,status:r.status});}
 const swapped=new URL(segmentURL);swapped.searchParams.set('sourceVersion','wrong-version');assert((await request(swapped,{account:user})).status===410,'Source-version tamper accepted');safeReceipt.push({check:kind+'-source-version-tamper',passed:true,status:410});
 return segmentURL;
}
try{
 if(phase==='login'){
  for(const account of Object.values(state.accounts)){
   const r=await jsonRequest('/auth/v1/token?grant_type=password',null,{email:account.email,password:account.password});assert(r.status===200,'GoTrue login HTTP '+r.status);
   const data=r.json();assert(data.user?.id===account.id&&typeof data.access_token==='string','Wrong GoTrue identity');
   const claims=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString());assert(claims.sub===account.id&&claims.session_id,'Missing genuine auth session');
   account.accessToken=data.access_token;account.refreshToken=data.refresh_token;account.sessionId=claims.session_id;
  }await save();console.log(JSON.stringify({phase,passed:true,accounts:2}));
 }
 if(phase==='publish'){
  const sender=state.accounts.sender,clip=await readFile(join(root,'source.mp4'));assert(clip.length<262144,'Canary clip exceeds 256KiB');
  for(const [kind,item]of Object.entries(state.media)){
   if(!item.uploaded){const r=await request('/storage/v1/object/chat-media/'+item.path.split('/').map(encodeURIComponent).join('/'),{account:sender,method:'POST',headers:{'Content-Type':'video/mp4','x-upsert':'false'},body:clip});assert([200,201].includes(r.status),'Storage upload HTTP '+r.status);item.uploaded=true;await save();}
   if(!item.published){const r=await jsonRequest('/rest/v1/messages',sender,{id:item.id,sender_id:sender.id,receiver_id:state.accounts.receiver.id,conversation_id:state.conversationId,text:'Private HLS QA canary '+state.runId,media_type:'video',media_url:state.base+'/storage/v1/object/public/chat-media/'+item.path,view_limit:kind==='limited'?1:null});assert(r.status===201,'Message insert HTTP '+r.status);item.published=true;await save();}
  }console.log(JSON.stringify({phase,passed:true,sourceObjects:2,messages:2}));
 }
 if(phase==='probe'){
  const ordinarySigned=await jsonRequest('/functions/v1/chat-media-sign',state.accounts.receiver,{messageIds:[state.media.ordinary.id],delivery:'no-store'});
  assert(ordinarySigned.status===200,'Ordinary no-store issuance HTTP '+ordinarySigned.status);
  const ordinaryOriginal=new URL(ordinarySigned.json().urls?.[state.media.ordinary.id]||'',state.base);
  assert(ordinaryOriginal.origin===state.base&&ordinaryOriginal.pathname==='/functions/v1/media-content/chat-media/'+state.media.ordinary.path&&/^[0-9a-f]{64}$/.test(ordinaryOriginal.searchParams.get('token')||''),'Ordinary no-store issuer did not return the exact protected source');
  await originalDecode('ordinary',ordinaryOriginal);
  const forgedOrdinary=new URL(ordinaryOriginal);forgedOrdinary.searchParams.set('token','f'.repeat(64));
  const forgedResponse=await request(forgedOrdinary,{account:state.accounts.receiver});assert(forgedResponse.status===403,'Forged ordinary original ticket denial HTTP '+forgedResponse.status);safeReceipt.push({check:'ordinary-original-forged-ticket-denied',passed:true,status:403});
  const ordinary=await open('ordinary');assert(ordinary.ready,'Ordinary rendition not ready');const ordinarySegment=await fetchAndDecode('ordinary',ordinary);
  const close=await jsonRequest('/functions/v1/private-hls',state.accounts.receiver,{action:'close',messageId:state.media.ordinary.id,requestId:state.media.ordinary.requestId});assert(close.status===200&&close.json().closed,'HLS close failed');
  assert((await request(ordinarySegment,{account:state.accounts.receiver})).status===410,'Closed segment accepted');assert(!(await open('ordinary')).ready,'Closed request reopened');safeReceipt.push({check:'ordinary-close-terminal',passed:true});
  const delayed=randomUUID();await jsonRequest('/functions/v1/private-hls',state.accounts.receiver,{action:'close',messageId:state.media.ordinary.id,requestId:delayed});assert(!(await open('ordinary',state.accounts.receiver,delayed)).ready,'Close-before-open resurrected');safeReceipt.push({check:'ordinary-close-before-open-terminal',passed:true});
  const original=await jsonRequest('/functions/v1/chat-media-sign',state.accounts.receiver,{messageIds:[state.media.limited.id],consume:true,requestId:state.media.limited.requestId,delivery:'no-store'});assert(original.status===200&&original.json()?.remaining===0,'Original limited-view grant failed');
  const limitedOriginal=new URL(original.json().urls?.[state.media.limited.id]||'',state.base);
  assert(limitedOriginal.origin===state.base&&limitedOriginal.pathname==='/functions/v1/limited-media-file'&&limitedOriginal.searchParams.get('messageId')===state.media.limited.id&&limitedOriginal.searchParams.get('requestId')===state.media.limited.requestId,'Limited issuer did not return the same protected viewing grant');
  const source=await originalDecode('limited',limitedOriginal);
  const range=await request(limitedOriginal,{account:state.accounts.receiver,headers:{Range:'bytes=0-15'}});assert(range.status===206&&range.bytes.length===16&&range.bytes.every((x,i)=>x===source[i])&&range.headers.get('Content-Range')===`bytes 0-15/${source.length}`,'Limited original range differs from the pinned source');noStore(range);safeReceipt.push({check:'limited-original-range',passed:true,status:206,bytes:16,sha256:createHash('sha256').update(range.bytes).digest('hex')});
  const fullRange=await request(limitedOriginal,{account:state.accounts.receiver,headers:{Range:`bytes=0-${source.length-1}`}}),sourceHash=createHash('sha256').update(source).digest('hex');
  assert(fullRange.status===206&&fullRange.bytes.length===source.length&&createHash('sha256').update(fullRange.bytes).digest('hex')===sourceHash&&fullRange.headers.get('Content-Range')===`bytes 0-${source.length-1}/${source.length}`,'Full original range differs from the pinned source');noStore(fullRange);safeReceipt.push({check:'limited-original-full-range',passed:true,status:206,bytes:fullRange.bytes.length,sha256:sourceHash});
  for(const [name,account,status] of [['wrong-user',state.accounts.sender,410],['no-auth',null,401]]){const denied=await request(limitedOriginal,{account});assert(denied.status===status,'Limited original '+name+' HTTP '+denied.status);safeReceipt.push({check:'limited-original-'+name,passed:true,status});}
  const limited=await open('limited');assert(limited.ready,'Limited rendition not ready');const limitedSegment=await fetchAndDecode('limited',limited);
  const counter=await request('/rest/v1/message_views?message_id=eq.'+state.media.limited.id+'&user_id=eq.'+state.accounts.receiver.id+'&select=views',{account:state.accounts.receiver});assert(counter.status===200&&counter.json()?.[0]?.views===1,'Original view counter changed');safeReceipt.push({check:'limited-counter-once',passed:true,views:1});
  await writeFile(join(root,'probe-progress.json'),JSON.stringify({checks:safeReceipt,naturalExpiryPending:true},null,2)+'\n',{mode:0o600});
  const remaining=Date.parse(limited.expiresAt)-Date.now()+300;assert(remaining>=0&&remaining<=125000,'Unexpected natural expiry window');console.log(JSON.stringify({phase:'waiting-natural-expiry',remainingSeconds:Math.ceil(remaining/1000)}));
  if(remaining>0)await new Promise(r=>setTimeout(r,remaining));assert((await request(limitedSegment,{account:state.accounts.receiver})).status===410,'Expired segment accepted');safeReceipt.push({check:'natural-expiry',passed:true});
  assert((await request(limitedOriginal,{account:state.accounts.receiver})).status===410,'Expired original accepted');safeReceipt.push({check:'limited-original-natural-expiry',passed:true,status:410});
  await jsonRequest('/functions/v1/private-hls',state.accounts.receiver,{action:'close',messageId:state.media.limited.id,requestId:state.media.limited.requestId});
  await writeFile(join(root,'probe-result.json'),JSON.stringify({passed:true,projectId:state.projectId,runId:state.runId,checks:safeReceipt,physicalPhone:false,providerCapacity:false},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({phase,passed:true,checks:safeReceipt.length}));
 }
 if(phase==='cleanup-storage'){
  const wanted=Object.values(state.media).map(x=>x.path);
  const r=await request('/storage/v1/object/chat-media',{account:state.accounts.sender,method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:wanted})});assert(r.status===200,'Storage cleanup HTTP '+r.status);
  const removed=r.json(),names=Array.isArray(removed)?removed.map(x=>x?.name):[];
  // Storage can return 200 with [] when RLS removes every matching row. Status
  // alone never establishes physical deletion or permits deleting the users.
  assert(names.length===wanted.length&&new Set(names).size===wanted.length&&wanted.every(name=>names.includes(name)),'Storage cleanup did not confirm both exact source names; authoritative readback is required');
  console.log(JSON.stringify({phase,passed:true,sourcePaths:names.length,exactSourceNamesConfirmed:true,derivativeCleanupStillRequiresVerification:true}));
 }
}catch(error){await writeFile(join(root,'phase-failure.json'),JSON.stringify({phase,message:error.message,checks:safeReceipt},null,2)+'\n',{mode:0o600});console.error(JSON.stringify({phase,passed:false,error:error.message}));process.exitCode=1;}
