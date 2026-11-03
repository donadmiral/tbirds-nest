import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishStep,uploadUrl,allowedProviderRequest,PublishFailure} from '../adapters.mjs';
import {runOnce,privateMedia,configuration,broker,delayMs,pause} from '../pull.mjs';
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),id=uuid(1),lease=uuid(2),clip=uuid(3),origin='https://abcdefghijklmnopqrst.supabase.co';
const secret='synthetic-provider-token-canary',source=origin+`/storage/v1/object/sign/live-clips/${uuid(4)}/${uuid(5)}/${clip}/${uuid(6)}/vertical.mp4?token=synthetic-private-grant`;
const pullOrigin='https://platinumcircles.example',pullSource=pullOrigin+`/api/live/social-pull/${id}/clip.mp4?token=${'a'.repeat(64)}`;
const job=(platform,patch={})=>({id,clip_id:clip,platform,account_id:'123456',access_token:secret,phase:'initial',progress:{},reconcile_only:false,source_url:platform==='tiktok'?pullSource:source,pull_origin:platform==='tiktok'?pullOrigin:null,source_expires_at:new Date(Date.now()+4200000).toISOString(),media_bytes:100,duration_ms:30000,cover_ms:1000,meta_version:'v25.0',consent:{title:'An approved clip',caption:'Reviewed caption',privacy:platform==='tiktok'?'SELF_ONLY':'private',made_for_kids:false,disable_comment:true,disable_duet:true,disable_stitch:true,brand_content:false,brand_organic:false,is_aigc:false,agree_music_usage:true},...patch});
function io(reply){const calls=[],checkpoints=[];return{calls,checkpoints,async checkpoint(phase,progress){checkpoints.push({phase,progress:structuredClone(progress)});},async check(){},async media(){return{size:100,async read(start,length){return new Uint8Array(length).fill(1);}};},async request(url,init){calls.push({url,init});assert.equal(init.redirect,'error');return reply(url,init,calls.length);}};}
const parse=init=>init.body instanceof URLSearchParams?Object.fromEntries(init.body):init.body?JSON.parse(init.body):{};
test('X uploads video, persists processing, then posts once after a durable publish checkpoint',async()=>{
 const adapter=io(async(url,init)=>url.endsWith('/initialize')?Response.json({data:{id:'111'}}):url.endsWith('/append')?Response.json({data:{}}):url.endsWith('/finalize')?Response.json({data:{}}):url.includes('media_id=')?Response.json({data:{processing_info:{state:'succeeded'}}}):Response.json({data:{id:'222'}}));
 const result=await publishStep(job('x'),adapter);assert.equal(result.provider_id,'222');assert.equal(adapter.calls.filter(c=>c.url==='https://api.x.com/2/tweets').length,1);assert.equal(adapter.checkpoints.at(-1).phase,'publishing');assert.deepEqual(parse(adapter.calls.at(-1).init).media.media_ids,['111']);
});
test('X processing defers without posting and unacknowledged publish never automatically retries',async()=>{
 const processing=io(async()=>Response.json({data:{processing_info:{state:'pending',check_after_secs:60}}}));assert.equal((await publishStep(job('x',{phase:'processing',progress:{media_id:'111',finalized:true}}),processing)).state,'wait');assert.equal(processing.calls.length,1);
 const ambiguous=io(async()=>{throw Error('must not call');});await assert.rejects(publishStep(job('x',{phase:'publishing',progress:{media_id:'111'}}),ambiguous),/PUBLICATION_CONFIRMATION_REQUIRED/);assert.equal(ambiguous.calls.length,0);
});
test('YouTube creates one resumable session with exact privacy/child-audience consent and uploads bytes',async()=>{
 const adapter=io(async(url,init)=>url.includes('/channels?')?Response.json({items:[{id:'123456'}]}):init.method==='POST'?new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=UPLOAD_SECRET'}}):Response.json({id:'abcde123456',snippet:{channelId:'123456'}},{status:201}));
 const result=await publishStep(job('youtube'),adapter);assert.equal(result.provider_id,'abcde123456');assert.equal(adapter.calls.length,3);assert.deepEqual(parse(adapter.calls[1].init).status,{privacyStatus:'private',selfDeclaredMadeForKids:false});assert.ok(adapter.calls[1].url.includes('notifySubscribers=false'));assert.equal(adapter.calls[2].init.headers['Content-Range'],'bytes 0-99/100');
});
test('YouTube reconciles lost final acknowledgment through the saved session without another insert',async()=>{
 const adapter=io(async()=>Response.json({id:'abcde123456'}));const result=await publishStep(job('youtube',{phase:'publishing',reconcile_only:true,progress:{upload_url:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret',total_bytes:100}}),adapter);assert.equal(result.state,'published');assert.equal(adapter.calls.length,1);assert.equal(adapter.calls[0].init.headers['Content-Range'],'bytes */100');assert.equal(adapter.calls[0].init.body.byteLength,0);
});
test('Instagram builds a container from scoped source, waits for FINISHED, and publishes approved text',async()=>{
 const adapter=io(async(url)=>url.endsWith('/media')?Response.json({id:'111'}):url.includes('status_code')?Response.json({status_code:'FINISHED'}):Response.json({id:'222'}));const result=await publishStep(job('instagram'),adapter);assert.equal(result.provider_id,'222');assert.equal(parse(adapter.calls[0].init).video_url,source);assert.equal(adapter.calls[0].init.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(adapter.checkpoints.at(-1).phase,'publishing');
});
test('Instagram never reposts an already published container without a recoverable media receipt',async()=>{const adapter=io(async()=>Response.json({status_code:'PUBLISHED'}));await assert.rejects(publishStep(job('instagram',{phase:'processing',progress:{container_id:'111'}}),adapter),/PUBLICATION_CONFIRMATION_REQUIRED/);assert.equal(adapter.calls.length,1);});
test('Facebook uploads a Page reel, finishes once, and verifies final provider publishing state',async()=>{
 let finished=false;const adapter=io(async(url,init)=>{if(url.endsWith('/video_reels')){const body=parse(init);if(body.upload_phase==='start')return Response.json({video_id:'111',upload_url:'https://rupload.facebook.com/video-upload/v25.0/111'});finished=true;return Response.json({success:true});}if(url.startsWith('https://rupload.'))return Response.json({success:true});return Response.json({status:{processing_phase:{status:'complete'},publishing_phase:{status:finished?'complete':'not_started'}}});});
 const result=await publishStep(job('facebook'),adapter);assert.equal(result.provider_id,'111');assert.equal(adapter.calls.filter(c=>c.url.endsWith('/video_reels')&&parse(c.init).upload_phase==='finish').length,1);const upload=adapter.calls.find(c=>c.url.startsWith('https://rupload.'));assert.equal(upload.init.headers.file_url,source);assert.equal(upload.init.headers.Authorization,'OAuth '+secret);
});
test('Facebook accepted finish is only polled on subsequent leases, never submitted again',async()=>{const adapter=io(async()=>Response.json({status:{processing_phase:{status:'complete'},publishing_phase:{status:'in_progress'}}}));const result=await publishStep(job('facebook',{phase:'processing',progress:{video_id:'111',finish_accepted:true}}),adapter);assert.equal(result.state,'wait');assert.equal(adapter.calls.length,1);assert.equal(adapter.calls[0].init.method,'GET');});
test('TikTok uses verified first-party URL pull for server media and preserves 64-bit post IDs',async()=>{
 const adapter=io(async(url)=>{if(url.includes('creator_info'))return Response.json({data:{privacy_level_options:['SELF_ONLY'],max_video_post_duration_sec:60,comment_disabled:true,duet_disabled:true,stitch_disabled:true},error:{code:'ok'}});if(url.includes('/init/'))return Response.json({data:{publish_id:'publish~123'},error:{code:'ok'}});return new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7482312345678912345]},"error":{"code":"ok"}}',{headers:{'Content-Type':'application/json'}});});
 adapter.media=async()=>{throw Error('Server clips must not use FILE_UPLOAD');};
 const result=await publishStep(job('tiktok'),adapter);assert.equal(result.provider_id,'7482312345678912345');const initialize=adapter.calls.find(c=>c.url.includes('/init/'));assert.equal(parse(initialize.init).source_info.source,'PULL_FROM_URL');assert.equal(parse(initialize.init).source_info.video_url,pullSource);assert.equal(parse(initialize.init).post_info.brand_content_toggle,false);assert.equal(adapter.checkpoints[0].phase,'publishing');assert.ok(adapter.calls.every(c=>new URL(c.url).hostname==='open.tiktokapis.com'));
});
test('TikTok rejects unverified origin, changed job path, insufficient lifetime or oversized pull media',async()=>{
 for(const patch of [{pull_origin:'https://foreign.example'},{source_url:pullSource.replace(id,uuid(99))},{source_expires_at:new Date(Date.now()+5000).toISOString()},{media_bytes:129*1024*1024}]){const adapter=io(async()=>Response.json({data:{privacy_level_options:['SELF_ONLY'],max_video_post_duration_sec:60},error:{code:'ok'}}));await assert.rejects(publishStep(job('tiktok',patch),adapter),/PROVIDER_RESPONSE_INVALID/);assert.equal(adapter.calls.length,1);assert.equal(adapter.checkpoints.length,0);}
});
test('TikTok consent cannot bypass current privacy, duration, interaction or music limits',async()=>{
 for(const patch of [{duration_ms:90000},{consent:{...job('tiktok').consent,privacy:'PUBLIC_TO_EVERYONE'}},{consent:{...job('tiktok').consent,agree_music_usage:false}},{consent:{...job('tiktok').consent,disable_comment:false}}]){const adapter=io(async()=>Response.json({data:{privacy_level_options:['SELF_ONLY'],max_video_post_duration_sec:60,comment_disabled:true},error:{code:'ok'}}));await assert.rejects(publishStep(job('tiktok',patch),adapter),/PROVIDER_REJECTED/);assert.equal(adapter.calls.length,1);}
});
test('provider URL capabilities never allow unrelated origin, credentials or unexpected upload path',()=>{
 for(const platform of ['youtube','facebook','tiktok'])for(const value of ['https://evil.example/upload','http://www.googleapis.com/upload/youtube/v3/videos?upload_id=x','https://user@open-upload.tiktokapis.com/video/?upload_id=1&upload_token=x'])assert.throws(()=>uploadUrl(platform,value,'v25.0'));
 assert.throws(()=>allowedProviderRequest('https://api.x.com.evil.example/2/tweets'));
 assert.throws(()=>allowedProviderRequest('https://api.x.com:8443/2/tweets'));
 assert.throws(()=>uploadUrl('tiktok','https://upload.us.tiktokapis.com:8443/video/?upload_id=1&upload_token=x'));
});
test('YouTube refuses ambiguous or changed channel grants before initiating upload',async()=>{
 for(const response of [{items:[{id:'foreign'}]},{items:[{id:'123456'},{id:'other'}]},{items:[{id:'123456'}],nextPageToken:'more'}]){const adapter=io(async()=>Response.json(response));await assert.rejects(publishStep(job('youtube'),adapter),/RECONNECT_REQUIRED/);assert.equal(adapter.calls.length,1);assert.equal(adapter.checkpoints.length,0);}
 const adapter=io(async()=>Response.json({id:'abcde123456',snippet:{channelId:'foreign'}}));await assert.rejects(publishStep(job('youtube',{phase:'publishing',reconcile_only:true,progress:{upload_url:'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret',total_bytes:100}}),adapter),/PROVIDER_RESPONSE_INVALID/);
});
test('revoked source or connection stops provider reads and writes after a cached grant',async()=>{
 const adapter=io(async()=>{throw Error('should not reach provider');});adapter.check=async()=>{throw new PublishFailure('RECONNECT_REQUIRED');};
 await assert.rejects(publishStep(job('facebook',{phase:'processing',progress:{video_id:'111',finish_accepted:true}}),adapter),/RECONNECT_REQUIRED/);assert.equal(adapter.calls.length,0);
});
test('worker shutdown aborts provider request and durably records only a finite failure',async()=>{
 const controller=new AbortController(),calls=[];
 const call=async(action,fields)=>{calls.push({action,fields});return action==='claim'?{items:[{id,lease_id:lease}]}:action==='grant'?job('x',{phase:'processing',progress:{media_id:'111'}}):{ok:true};};
 const result=await runOnce({origin,secret:'broker-secret'},{call,signal:controller.signal,fetcher:async(_url,init)=>{controller.abort();assert.equal(init.signal.aborted,true);throw Error('synthetic cancelled');}});
 assert.equal(result.state,'deferred');assert.equal(result.error,'PROVIDER_UNAVAILABLE');assert.equal(calls.at(-1).action,'defer');
});
test('outage backoff is capped and shutdown interrupts idle or outage sleep',async()=>{
 assert.equal(delayMs({error:'PROVIDER_UNAVAILABLE'},1,()=>0),15000);assert.equal(delayMs({error:'PROVIDER_UNAVAILABLE'},100,()=>0),300000);assert.equal(delayMs({state:'idle'},0,()=>0),60000);
 const controller=new AbortController(),waiting=pause(60000,controller.signal);controller.abort();await waiting;
});
test('failed durable publish checkpoint prevents every final provider mutation',async()=>{const adapter=io(async()=>Response.json({data:{processing_info:{state:'succeeded'}}}));adapter.checkpoint=async phase=>{if(phase==='publishing')throw Error('lease revoked');};await assert.rejects(publishStep(job('x',{phase:'processing',progress:{media_id:'111'}}),adapter),/lease revoked/);assert.equal(adapter.calls.length,1);});
test('worker failure reporting contains only finite codes, never tokens, API response or capabilities',async()=>{
 const calls=[],ticket={id,lease_id:lease};const call=async(action,fields)=>{calls.push({action,fields});return action==='claim'?{items:[ticket]}:action==='grant'?job('x',{phase:'publishing',progress:{media_id:'111'}}):{ok:true};};
 const result=await runOnce({origin,secret:'broker-secret'},{call,fetcher:async()=>{throw Error(secret);}});assert.equal(result.state,'failed');assert.equal(result.error,'PUBLICATION_CONFIRMATION_REQUIRED');assert.ok(!JSON.stringify(result).includes(secret));assert.equal(calls.at(-1).action,'fail');
});
test('private media uses exact clip capability, bounds actual streamed bytes and deletes scratch file',async()=>{
 const config={origin,maxBytes:10};let cancelled=false;await assert.rejects(privateMedia(config,job('x'),async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}}))),/MEDIA_TOO_LARGE/);assert.equal(cancelled,true);
 const media=await privateMedia({origin,maxBytes:100},job('x'),async()=>new Response(new Uint8Array([1,2,3])));assert.equal(media.size,3);assert.deepEqual([...await media.read(1,2)],[2,3]);await media.close();
 await assert.rejects(privateMedia(config,job('x',{clip_id:uuid(99)}),async()=>{throw Error('should not fetch');}),/PROVIDER_RESPONSE_INVALID/);
});
test('worker configuration and broker redirects cannot leak its dedicated secret',async()=>{
 for(const invalid of ['https://evil.example',origin+':8443'])assert.throws(()=>configuration({LIVE_SOCIAL_PROJECT_ORIGIN:invalid,LIVE_SOCIAL_WORKER_SECRET:'x'.repeat(40)}));const config=configuration({LIVE_SOCIAL_PROJECT_ORIGIN:origin,LIVE_SOCIAL_WORKER_SECRET:'x'.repeat(40)});
 const call=broker(config,async(url,init)=>{assert.equal(url,origin+'/functions/v1/live-social-worker');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+'x'.repeat(40));return Response.json({data:{items:[]}});});assert.deepEqual(await call('claim'),{items:[]});
});
