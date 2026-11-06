// All remote side effects pass a durable checkpoint before the request.
// A checkpoint failure means no request. An uncertain final request is never recreated.
export class PublishFailure extends Error {constructor(code,after=30){super(code);this.code=code;this.after=after;}}
const fail=code=>{throw new PublishFailure(code);},record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const remoteId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_:.~-]{1,160}$/.test(value))fail('PROVIDER_RESPONSE_INVALID');return value;};
const numericId=value=>{const id=remoteId(value);if(!/^\d{1,40}$/.test(id))fail('PROVIDER_RESPONSE_INVALID');return id;};
export function uploadUrl(platform,value,version){
 if(typeof value!=='string'||value.length>4000)fail('PROVIDER_RESPONSE_INVALID');const u=new URL(value);
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)fail('PROVIDER_RESPONSE_INVALID');
 if(platform==='youtube'&&u.origin==='https://www.googleapis.com'&&u.pathname==='/upload/youtube/v3/videos'&&u.searchParams.get('upload_id'))return u.href;
 if(platform==='facebook'&&u.origin==='https://rupload.facebook.com'&&/^v\d{2}\.\d$/.test(version||'')&&new RegExp('^/video-upload/'+version.replace('.','\\.')+'/[0-9]{1,40}$').test(u.pathname))return u.href;
 fail('PROVIDER_RESPONSE_INVALID');
}
export function allowedProviderRequest(url){
 const u=new URL(url);if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)fail('PROVIDER_RESPONSE_INVALID');
 if(['api.x.com','www.googleapis.com','graph.facebook.com','open.tiktokapis.com','rupload.facebook.com'].includes(u.hostname))return;
 fail('PROVIDER_RESPONSE_INVALID');
}
async function bodyJson(response){
 if(Number(response.headers.get('content-length')||0)>256000)fail('PROVIDER_RESPONSE_INVALID');const reader=response.body?.getReader();if(!reader)fail('PROVIDER_RESPONSE_INVALID');const chunks=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>256000){await reader.cancel();fail('PROVIDER_RESPONSE_INVALID');}chunks.push(r.value);}}finally{reader.releaseLock();}
 const text=Buffer.concat(chunks).toString('utf8');let data;try{data=JSON.parse(text,(_key,v,context)=>typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)?context?.source||fail('PROVIDER_RESPONSE_INVALID'):v);}catch{fail('PROVIDER_RESPONSE_INVALID');}
 if(!record(data)||data.error&&!(record(data.error)&&data.error.code==='ok')||Array.isArray(data.errors)&&data.errors.length)fail('PROVIDER_REJECTED');return data;
}
function client(job,io){
 return async(url,method='GET',body,extra={},raw=false)=>{
  allowedProviderRequest(url);const headers={Authorization:'Bearer '+job.access_token,...(body&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...extra};
  // TikTok upload capabilities carry their own authorization and receive no OAuth token.
  if(/tiktokapis\.com/.test(new URL(url).hostname)&&new URL(url).hostname!=='open.tiktokapis.com')delete headers.Authorization;
  let serialized=body instanceof Uint8Array?body:body===undefined?undefined:JSON.stringify(body);
  if(new URL(url).hostname==='graph.facebook.com'&&record(body)){headers['Content-Type']='application/x-www-form-urlencoded';serialized=new URLSearchParams(Object.entries(body).map(([k,v])=>[k,String(v)]));}
  // A previous grant does not survive account disconnect or source revocation.
  // Check the current lease/rights before reads as well as remote mutations.
  await io.check();
  let response;try{response=await io.request(url,{method,headers,body:serialized,redirect:'error'});}catch{fail('PROVIDER_UNAVAILABLE');}
  if(!response.ok&&response.status!==308){void response.body?.cancel().catch(()=>{});if(response.status===429)throw new PublishFailure('PROVIDER_RATE_LIMITED',Math.max(15,Math.min(3600,Number(response.headers.get('retry-after'))||60)));if(response.status===401)fail('RECONNECT_REQUIRED');if(response.status>=500)fail('PROVIDER_UNAVAILABLE');fail('PROVIDER_REJECTED');}
  return raw?response:bodyJson(response);
 };
}
const wait=(after=30)=>({state:'wait',after_seconds:Math.max(15,Math.min(3600,after))});
const published=(id,url)=>({state:'published',provider_id:remoteId(id),...(url?{external_url:url}:{})});
function youtubeReceipt(data,accountId){
 if(record(data.snippet)&&data.snippet.channelId!==undefined&&data.snippet.channelId!==accountId)fail('PROVIDER_RESPONSE_INVALID');
 return published(remoteId(data.id));
}
/** io.media() is lazy and returns {size, read(start,length)} from one bounded private file. */
export async function publishStep(job,io){
 if(!record(job)||!record(job.progress)||!record(job.consent)||typeof job.access_token!=='string'||!['x','youtube','instagram','facebook','tiktok'].includes(job.platform))fail('PROVIDER_RESPONSE_INVALID');
 const p={...job.progress},c=job.consent,api=client(job,io);let phase=job.phase;
 const save=async(next)=>{await io.checkpoint(next,p);phase=next;};
 if(p.published_id){const id=remoteId(p.published_id);return published(id,p.external_url);}
 if(job.reconcile_only){
  if(job.platform==='youtube'&&p.upload_url){const response=await api(uploadUrl('youtube',p.upload_url),'PUT',new Uint8Array(),{'Content-Range':'bytes */'+p.total_bytes},true);if(response.status===200||response.status===201){const data=await bodyJson(response);return youtubeReceipt(data,job.account_id);}void response.body?.cancel().catch(()=>{});fail('PUBLICATION_CONFIRMATION_REQUIRED');}
  if(job.platform==='tiktok'&&p.publish_id){const data=await api('https://open.tiktokapis.com/v2/post/publish/status/fetch/','POST',{publish_id:remoteId(p.publish_id)});if(data.data?.status==='PUBLISH_COMPLETE'){const ids=data.data.publicaly_available_post_id;return published(Array.isArray(ids)&&typeof ids[0]==='string'?ids[0]:remoteId(p.publish_id));}if(data.data?.status==='FAILED')fail('PROVIDER_REJECTED');await save('processing');return wait(60);}
  if(job.platform==='facebook'&&p.video_id){const data=await api(`https://graph.facebook.com/${job.meta_version}/${numericId(p.video_id)}?fields=status`);if(data.status?.publishing_phase?.status==='complete')return published(p.video_id);fail('PUBLICATION_CONFIRMATION_REQUIRED');}
  // X has no safe client idempotency lookup after an unknown create response.
  // Instagram PUBLISHED container does not expose the media ID; do not fabricate it.
  fail('PUBLICATION_CONFIRMATION_REQUIRED');
 }
 if(phase==='creating'||phase==='publishing')fail('PUBLICATION_CONFIRMATION_REQUIRED');
 if(job.platform==='x'){
  if(!p.media_id){const media=await io.media();await save('creating');const response=await api('https://api.x.com/2/media/upload/initialize','POST',{total_bytes:media.size,media_type:'video/mp4',media_category:'tweet_video',shared:false});p.media_id=numericId(response.data?.id);p.offset=0;p.total_bytes=media.size;await save('uploading');}
  if(phase==='uploading'){
   const media=await io.media();if(media.size!==p.total_bytes)fail('PROVIDER_RESPONSE_INVALID');
   while(p.offset<media.size){const length=Math.min(4*1024*1024,media.size-p.offset),segment=p.offset/(4*1024*1024);await io.check();await api(`https://api.x.com/2/media/upload/${numericId(p.media_id)}/append`,'POST',{media:Buffer.from(await media.read(p.offset,length)).toString('base64'),segment_index:segment});p.offset+=length;await save('uploading');}
   await save('creating');const result=await api(`https://api.x.com/2/media/upload/${p.media_id}/finalize`,'POST');p.finalized=true;await save('processing');if(result.data?.processing_info?.state==='failed')fail('PROVIDER_REJECTED');
  }
  const status=await api(`https://api.x.com/2/media/upload?media_id=${numericId(p.media_id)}&command=STATUS`);const info=status.data?.processing_info;
  if(info&&info.state!=='succeeded'){if(info.state==='failed')fail('PROVIDER_REJECTED');return wait(info.check_after_secs||30);}
  await save('publishing');const result=await api('https://api.x.com/2/tweets','POST',{text:c.caption,media:{media_ids:[p.media_id]}});p.published_id=numericId(result.data?.id);return published(p.published_id);
 }
 if(job.platform==='youtube'){
  if(!p.upload_url){
   const identity=await api('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=2');
   if(!Array.isArray(identity.items)||identity.items.length!==1||identity.nextPageToken||identity.items[0]?.id!==job.account_id)fail('RECONNECT_REQUIRED');
   const media=await io.media();await save('creating');const response=await api('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false','POST',{snippet:{title:c.title,description:c.caption},status:{privacyStatus:c.privacy,selfDeclaredMadeForKids:c.made_for_kids}}, {'X-Upload-Content-Length':String(media.size),'X-Upload-Content-Type':'video/mp4'},true);p.upload_url=uploadUrl('youtube',response.headers.get('location'));p.total_bytes=media.size;p.offset=0;void response.body?.cancel().catch(()=>{});await save('uploading');}
  const media=await io.media();if(media.size!==p.total_bytes)fail('PROVIDER_RESPONSE_INVALID');
  // Query the existing upload session on every resumed lease; never create a second video.
  if(p.offset>0){const status=await api(uploadUrl('youtube',p.upload_url),'PUT',new Uint8Array(),{'Content-Range':'bytes */'+media.size},true);if(status.status!==308){const data=await bodyJson(status);return youtubeReceipt(data,job.account_id);}const range=status.headers.get('range');p.offset=range&&/^bytes=0-\d+$/.test(range)?Number(range.split('-')[1])+1:0;void status.body?.cancel().catch(()=>{});}
  while(p.offset<media.size){const length=Math.min(8*1024*1024,media.size-p.offset),end=p.offset+length-1;await save('publishing');const response=await api(uploadUrl('youtube',p.upload_url),'PUT',await media.read(p.offset,length),{'Content-Type':'video/mp4','Content-Length':String(length),'Content-Range':`bytes ${p.offset}-${end}/${media.size}`},true);
   if(response.status===200||response.status===201){const result=await bodyJson(response);return youtubeReceipt(result,job.account_id);}
   const range=response.headers.get('range');if(!range||!/^bytes=0-\d+$/.test(range)||Number(range.split('-')[1])+1!==end+1)fail('PROVIDER_RESPONSE_INVALID');p.offset=end+1;void response.body?.cancel().catch(()=>{});await save('uploading');
  }fail('PUBLICATION_CONFIRMATION_REQUIRED');
 }
 if(job.platform==='tiktok'){
  if(!p.publish_id){
   const creator=await api('https://open.tiktokapis.com/v2/post/publish/creator_info/query/','POST',{}),info=creator.data;
   if(!record(info)||!Array.isArray(info.privacy_level_options)||!info.privacy_level_options.includes(c.privacy)||typeof info.max_video_post_duration_sec!=='number'||job.duration_ms>info.max_video_post_duration_sec*1000||!c.agree_music_usage||info.comment_disabled&&!c.disable_comment||info.duet_disabled&&!c.disable_duet||info.stitch_disabled&&!c.disable_stitch||c.brand_content&&c.privacy==='SELF_ONLY')fail('PROVIDER_REJECTED');
   const source=new URL(job.source_url);
   if(source.protocol!=='https:'||source.port||source.username||source.password||source.hash||source.origin!==job.pull_origin||source.pathname!==`/api/live/social-pull/${job.id}/clip.mp4`||!/^[a-f0-9]{64}$/.test(source.searchParams.get('token')||'')||typeof job.media_bytes!=='number'||job.media_bytes<1||job.media_bytes>128*1024*1024||!Number.isFinite(Date.parse(job.source_expires_at))||Date.parse(job.source_expires_at)<Date.now()+3600000)fail('PROVIDER_RESPONSE_INVALID');
   // Server-hosted media must use a verified URL pull. Initialization can begin
   // publication immediately, so fence it as a publish before making the call.
   await save('publishing');const result=await api('https://open.tiktokapis.com/v2/post/publish/video/init/','POST',{post_info:{title:c.caption,privacy_level:c.privacy,disable_comment:c.disable_comment,disable_duet:c.disable_duet,disable_stitch:c.disable_stitch,brand_content_toggle:c.brand_content,brand_organic_toggle:c.brand_organic,is_aigc:c.is_aigc,video_cover_timestamp_ms:job.cover_ms},source_info:{source:'PULL_FROM_URL',video_url:source.href}});
   p.publish_id=remoteId(result.data?.publish_id);await save('processing');
  }
  const status=await api('https://open.tiktokapis.com/v2/post/publish/status/fetch/','POST',{publish_id:remoteId(p.publish_id)});
  if(status.data?.status==='PUBLISH_COMPLETE'){const ids=status.data.publicaly_available_post_id;p.published_id=Array.isArray(ids)&&typeof ids[0]==='string'?ids[0]:p.publish_id;return published(p.published_id);}
  if(status.data?.status==='FAILED')fail('PROVIDER_REJECTED');return wait(60);
 }
 if(!/^v\d{2}\.\d$/.test(job.meta_version||''))fail('PROVIDER_RESPONSE_INVALID');const graph='https://graph.facebook.com/'+job.meta_version,account=numericId(job.account_id);
 if(job.platform==='instagram'){
  if(!p.container_id){await save('creating');const result=await api(`${graph}/${account}/media`,'POST',{media_type:'REELS',video_url:job.source_url,caption:c.caption,share_to_feed:true});p.container_id=numericId(result.id);await save('processing');}
  const status=await api(`${graph}/${numericId(p.container_id)}?fields=status_code`);if(status.status_code==='PUBLISHED')fail('PUBLICATION_CONFIRMATION_REQUIRED');if(status.status_code==='ERROR'||status.status_code==='EXPIRED')fail('PROVIDER_REJECTED');if(status.status_code!=='FINISHED')return wait(30);
  await save('publishing');const result=await api(`${graph}/${account}/media_publish`,'POST',{creation_id:p.container_id});p.published_id=numericId(result.id);return published(p.published_id);
 }
 if(!p.video_id){await save('creating');const result=await api(`${graph}/${account}/video_reels`,'POST',{upload_phase:'start'});p.video_id=numericId(result.video_id);p.upload_url=uploadUrl('facebook',result.upload_url,job.meta_version);await save('uploading');}
 if(phase==='uploading'){
  // Provider fetches only the broker's current, scoped private object grant.
  await io.check();await api(uploadUrl('facebook',p.upload_url,job.meta_version),'POST',undefined,{Authorization:'OAuth '+job.access_token,file_url:job.source_url});await save('processing');
 }
 const status=await api(`${graph}/${numericId(p.video_id)}?fields=status`);
 if(p.finish_accepted){if(status.status?.publishing_phase?.status==='complete')return published(p.video_id);if(status.status?.publishing_phase?.status==='error')fail('PROVIDER_REJECTED');return wait(30);}
 if(status.status?.processing_phase?.status==='error'||status.status?.uploading_phase?.status==='error')fail('PROVIDER_REJECTED');
 if(status.status?.processing_phase?.status!=='complete')return wait(30);
 await save('publishing');const result=await api(`${graph}/${account}/video_reels`,'POST',{upload_phase:'finish',video_id:p.video_id,video_state:'PUBLISHED',description:c.caption,title:c.title});if(result.success!==true)fail('PROVIDER_RESPONSE_INVALID');
 // The API accepted publication; verify provider state before reporting published.
 p.finish_accepted=true;await save('processing');const verified=await api(`${graph}/${p.video_id}?fields=status`);
 if(verified.status?.publishing_phase?.status!=='complete')return wait(30);p.published_id=p.video_id;return published(p.published_id);
}
