// Real-provider acceptance. No secrets, browser state, or network traces are saved.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../node_modules/playwright'),{compile}=require('./ui-compile.cjs');
const {createClipPollDiagnostic}=require('./live-clip-poll-diagnostic.cjs');
const root=path.resolve(__dirname,'../../..'),origin='https://uaulhuelcfkjwojtymmw.supabase.co';
function safeDiagnosticText(value){return String(value).replace(/https?:\/\/[^\s"'<>]+/g,'[url]').replace(/\/_live\/[^/\s"'<>]+/g,'/[protected-media]').slice(0,600);}
// Capabilities are bearer credentials. Keep only a relative media-object suffix,
// never the /_live/<capability> prefix, query string, source URL or response body.
function mediaLocation(url){
 const protectedPath=url.pathname.startsWith('/_live/');
 const objectPath=protectedPath?url.pathname.replace(/^\/_live\/[^/]+\/?/,''):url.pathname.replace(/^\/+/, '');
 const match=objectPath.match(/^live\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/([a-zA-Z0-9_.\/-]{1,320})$/);
 return {host:url.hostname,kind:path.extname(url.pathname),pathShape:protectedPath?(match?'capability/live/session/broadcast/object':'capability/unrecognized'):(match?'live/session/broadcast/object':'unrecognized'),objectSuffix:match&&!match[1].includes('..')?match[1]:null};
}
async function mediaResponseClass(response){
 const status=response.status();if(status<400)return 'ok';
 const body=await response.text().catch(()=>'');
 if(body.trim()==='Unavailable')return 'edge_capability_denied';
 const code=body.match(/<Code>([A-Za-z]+)<\/Code>/)?.[1];
 const known=new Set(['AccessDenied','NoSuchKey','ExpiredToken','RequestTimeTooSkewed','SignatureDoesNotMatch','InvalidToken','SlowDown','InternalError','ServiceUnavailable']);
 if(known.has(code))return 'origin_'+code;
 return status===403?'forbidden_unclassified':status===404?'not_found':status>=500?'server_error':'http_error';
}
async function lab(action){
 const oidcUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);oidcUrl.searchParams.set('audience','platinum-live-acceptance');
 const issued=await fetch(oidcUrl,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(12000)});assert.ok(issued.ok,'GitHub identity unavailable');const {value}=await issued.json();assert.ok(value,'GitHub identity missing');
 const response=await fetch(origin+'/functions/v1/live-qa-acceptance',{method:'POST',headers:{Authorization:'Bearer '+value,'Content-Type':'application/json'},body:JSON.stringify({action}),signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(!response.ok||data.ok!==true)throw Error('QA lab '+action+': '+String(data.error||response.status));return data;
}
async function until(label,read,ready,timeout=95000){
 const end=Date.now()+timeout;let last;
 do{last=await read();if(ready(last))return last;if(Date.now()>=end)break;await new Promise(resolve=>setTimeout(resolve,3000));}while(Date.now()<end);
 throw Error(label+' did not complete within '+Math.round(timeout/1000)+' seconds');
}
async function actorRpc(page,name,args){
 return page.evaluate(async input=>{const {data,error}=await window.__qaClient.rpc(input.name,input.args).abortSignal(AbortSignal.timeout(15000));if(error)throw Error(input.name+': '+String(error.code||'RPC_FAILED'));return data;},{name,args});
}
const isCommand=(response,name,action)=>new URL(response.url()).pathname.endsWith('/'+name)&&response.request().postDataJSON()?.p_action===action;
const isUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Read only the tracks attached by the actual Daily-backed StageTile. No call
// object, participant identity, media URL, token, label or track ID is retained.
async function stageSnapshot(page){
 return page.locator('[data-live-stage]').evaluateAll(stages=>stages.flatMap(stage=>Array.from(stage.children)).slice(0,12).map(tile=>{
  const video=tile.querySelector('video'),stream=video?.srcObject,tracks=stream instanceof MediaStream?stream.getVideoTracks():[];
  return {local:tile.querySelector('span')?.textContent?.includes(' · You')===true,hasStream:stream instanceof MediaStream,
   videoTracks:tracks.length,liveVideoTracks:tracks.filter(track=>track.kind==='video'&&track.readyState==='live'&&track.enabled).length,
   readyState:video?.readyState??0,paused:video?.paused??true,currentTime:Math.round((video?.currentTime||0)*1000)/1000,
   width:video?.videoWidth||0,height:video?.videoHeight||0};
 }));
}
const playingStageVideo=tile=>tile.hasStream&&tile.videoTracks===1&&tile.liveVideoTracks===1&&tile.readyState>=2&&!tile.paused&&tile.currentTime>0&&tile.width>0&&tile.height>0;
function viewerPresenceRetired(events,stream){
 const relevant=events.filter(event=>event.actor==='Viewer'&&event.stream===stream);if(relevant.some(event=>event.ok===null))return false;
 const accepted=relevant.filter(event=>event.status===200&&event.ok===true);
 const joined=new Set(relevant.filter(event=>event.active===true).map(event=>event.player));
 return joined.size>0&&[...joined].every(player=>{const own=accepted.filter(event=>event.player===player),firstJoin=own.find(event=>event.active===true),last=own.at(-1),lastActive=relevant.filter(event=>event.player===player&&event.active===true).at(-1);return !!firstJoin&&last.active===false&&last.sequence>lastActive.sequence;});
}
async function main(){
 const evidence=process.env.LIVE_CONNECTED_EVIDENCE||'/tmp/live-connected-evidence',output='/tmp/live-connected-browser';await fs.mkdir(evidence,{recursive:true});
 const adapter=path.join(__dirname,'live-connected-adapter.tsx');await compile({entry:path.join(__dirname,'live-connected-fixture.tsx'),output,title:'Platinum Live connected QA',aliases:{'@/lib/supabase/client':adapter,'@/lib/navigationCache':adapter,'next/navigation':adapter,'next/link':adapter}});
 const server=http.createServer(async(req,res)=>{try{let file=new URL(req.url,'http://local').pathname;file=path.extname(file)?path.basename(file):'index.html';const bytes=await fs.readFile(path.join(output,file));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLATINUM_CHROMIUM||undefined,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const checks=[],errors=[],responses=[],delivery=[],players=[],presence=[],controls=[],stage=[],actors=[],sessionIds=[],presencePlayers=new Map(),presenceRequests=new WeakMap(),pendingDiagnostics=new Set();let failure=null,bootstrapped=false,sessionId=null,clipId=null,postId=null,cleanup=null,clipPollDiagnostic=null;
 const base='http://127.0.0.1:'+server.address().port,anon=require(path.join(root,'eas.json')).build.preview.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
 try{
  const fixture=await lab('bootstrap');bootstrapped=true;assert.equal(fixture.actors.length,3);
  async function actor(label){const selected=fixture.actors.find(a=>a.label===label),context=await browser.newContext({viewport:{width:1365,height:900},permissions:['camera','microphone']});await context.addInitScript(input=>{window.__LIVE_ACCEPTANCE=input;},{origin,anon,actor:selected});const page=await context.newPage();actors.push({label,page});page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push({actor:label,message:safeDiagnosticText(error.message)}));page.on('dialog',dialog=>dialog.accept());page.on('request',request=>{const url=new URL(request.url());if(url.origin!==origin||url.pathname!=='/rest/v1/rpc/live_viewer_heartbeat'||request.method()!=='POST')return;
   let args;try{args=request.postDataJSON();}catch{errors.push({actor:label,presence:'Invalid heartbeat metadata'});return;}const stream=sessionIds.indexOf(args?.p_session_id)+1;
   if(!stream||typeof args?.p_active!=='boolean'||!/^[a-f0-9-]{36}$/i.test(args?.p_playback_id||'')||presence.length>=200){errors.push({actor:label,presence:'Invalid or excessive heartbeat metadata'});return;}
   const key=label+':'+stream+':'+args.p_playback_id;if(!presencePlayers.has(key))presencePlayers.set(key,presencePlayers.size+1);
   // Save ordered heartbeat metadata only, without raw playback IDs, credentials, URLs or response bodies.
   const item={sequence:presence.length+1,actor:label,stream,player:presencePlayers.get(key),active:args.p_active,status:null,ok:null,transport:'pending'};presence.push(item);presenceRequests.set(request,item);
  });page.on('response',async response=>{const url=new URL(response.url()),heartbeat=presenceRequests.get(response.request());if(heartbeat){
   heartbeat.status=response.status();if(heartbeat.transport!=='failed')heartbeat.transport='response';
   const diagnostic=response.json().then(data=>{if(heartbeat.transport!=='failed')heartbeat.ok=data?.ok===true;},()=>{heartbeat.ok=false;});pendingDiagnostics.add(diagnostic);void diagnostic.finally(()=>pendingDiagnostics.delete(diagnostic));
  }if(url.origin===origin&&/\/live-(control|playback)$/.test(url.pathname)){const data=await response.json().catch(()=>({}));responses.push({actor:label,endpoint:url.pathname.split('/').pop(),status:response.status(),error:data.error?safeDiagnosticText(data.error):null,state:data.state||null,ok:typeof data.ok==='boolean'?data.ok:null});}if(/\.(m3u8|ts|m4s)$/.test(url.pathname)&&delivery.length<50){const item={actor:label,...mediaLocation(url),status:response.status(),responseClass:'pending'};delivery.push(item);const diagnostic=mediaResponseClass(response).then(value=>{item.responseClass=value;});pendingDiagnostics.add(diagnostic);void diagnostic.finally(()=>pendingDiagnostics.delete(diagnostic));}});page.on('requestfailed',request=>{const url=new URL(request.url()),heartbeat=presenceRequests.get(request);if(heartbeat){heartbeat.transport='failed';heartbeat.ok=false;}if(/\.(m3u8|ts|m4s)$/.test(url.pathname)&&delivery.length<50){const reason=request.failure()?.errorText||'';delivery.push({actor:label,...mediaLocation(url),failed:true,responseClass:/^net::ERR_[A-Z_]+$/.test(reason)?reason:'network_error'});}});return page;}
  const host=await actor('Host');
  async function uiCommand(page,label,name,action,perform){
   // Capture the response caused by this actual control. Never replace its
   // write with actorRpc, a request replay, a fixture response or a refresh.
   const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).origin===origin&&isCommand(r,name,action)),Promise.resolve().then(perform)]);
   const data=await response.json(),args=response.request().postDataJSON();
   controls.push({actor:label,endpoint:name,action,status:response.status(),ok:data?.ok===true});
   assert.equal(response.status(),200,label+' '+action+' request failed');assert.equal(data?.ok===true,true,label+' '+action+' was not confirmed');
   assert.equal(args.p_session_id===sessionId,true,label+' '+action+' targeted another stream');
   return {data,args};
  }
  async function exerciseInteractions(viewer,body){
   const hostPanel=host.getByRole('region',{name:'Stream interactions',exact:true}),viewerPanel=viewer.getByRole('region',{name:'Stream interactions',exact:true});
   const pollQuestion='QA audience choice '+process.env.GITHUB_RUN_ID,firstOption='Camera questions',secondOption='Broadcast workflow';
   await hostPanel.getByRole('button',{name:'Polls',exact:true}).click();await viewerPanel.getByRole('button',{name:'Polls',exact:true}).click();
   await hostPanel.getByLabel('Poll question',{exact:true}).fill(pollQuestion);await hostPanel.getByLabel('Poll option 1',{exact:true}).fill(firstOption);await hostPanel.getByLabel('Poll option 2',{exact:true}).fill(secondOption);
   const opened=await uiCommand(host,'Host','live_interaction_command','poll_create',()=>hostPanel.getByRole('button',{name:'Open poll',exact:true}).click());
   assert.equal(isUuid(opened.data.poll?.id),true,'Poll command did not return an identity');assert.equal(opened.data.poll?.state==='open',true,'Poll did not open');
   const firstChoice=opened.data.poll.options?.find(option=>option.label===firstOption);assert.equal(isUuid(firstChoice?.id),true,'First poll option missing');
   await viewerPanel.getByRole('heading',{name:pollQuestion,exact:true}).waitFor({timeout:95000});checks.push('Host opened a real poll and the separate follower received it without refresh');
   const hostPoll=hostPanel.getByRole('heading',{name:pollQuestion,exact:true}).locator('..').locator('..'),viewerPoll=viewerPanel.getByRole('heading',{name:pollQuestion,exact:true}).locator('..').locator('..');
   const choice=viewerPoll.getByRole('button',{name:new RegExp('^'+escapePattern(firstOption))});
   const voted=await uiCommand(viewer,'Viewer','live_interaction_command','poll_vote',()=>choice.click());
   assert.equal(voted.args.p_payload?.poll_id===opened.data.poll.id&&voted.args.p_payload?.option_id===firstChoice.id,true,'Vote did not target the displayed option');
   await viewerPanel.getByText('Your vote is saved.',{exact:true}).waitFor();
   // The acknowledgement notice precedes the interaction reload that marks the saved option.
   await viewerPoll.getByRole('button',{name:new RegExp('^'+escapePattern(firstOption)),pressed:true}).waitFor();assert.equal(await choice.getAttribute('aria-pressed'),'true');
   await hostPoll.getByText('1 votes',{exact:true}).waitFor({timeout:95000});await hostPoll.getByRole('button',{name:new RegExp('^'+escapePattern(firstOption)+'.*100% · 1$')}).waitFor();
   checks.push('Follower vote was saved once and the host received the actual one-vote count');
   await uiCommand(host,'Host','live_interaction_command','poll_close',()=>hostPoll.getByRole('button',{name:'Close poll',exact:true}).click());
   await viewerPoll.getByText('closed',{exact:true}).waitFor({timeout:95000});assert.equal(await choice.isDisabled(),true);assert.equal(await viewerPoll.getByRole('button',{name:new RegExp('^'+escapePattern(secondOption))}).isDisabled(),true);
   checks.push('Host closed the poll and both follower voting controls became disabled');await viewer.screenshot({path:path.join(evidence,'private-06-closed-poll.png'),fullPage:true});

   const question='QA question for the host '+process.env.GITHUB_RUN_ID,answer='QA answer from the host '+process.env.GITHUB_RUN_ID;
   await hostPanel.getByRole('button',{name:'Q and A',exact:true}).click();await viewerPanel.getByRole('button',{name:'Q and A',exact:true}).click();
   await viewerPanel.getByLabel('Ask the host',{exact:true}).fill(question);
   const asked=await uiCommand(viewer,'Viewer','live_interaction_command','question_ask',()=>viewerPanel.getByRole('button',{name:'Submit question',exact:true}).click());assert.equal(isUuid(asked.data.question?.id),true,'Question identity missing');
   const hostQuestion=hostPanel.getByRole('article').filter({has:host.getByText(question,{exact:true})});await hostQuestion.waitFor({timeout:95000});
   await hostQuestion.getByRole('button',{name:'Answer',exact:true}).click();await hostQuestion.getByLabel('Answer this question',{exact:true}).fill(answer);
   const answered=await uiCommand(host,'Host','live_interaction_command','question_answer',()=>hostQuestion.getByRole('button',{name:'Post answer',exact:true}).click());
   assert.equal(answered.args.p_payload?.question_id===asked.data.question.id,true,'Answer did not target the displayed question');assert.equal(answered.data.question?.state==='answered',true,'Question was not marked answered');
   const viewerQuestion=viewerPanel.getByRole('article').filter({has:viewer.getByText(question,{exact:true})});await viewerQuestion.getByText(answer,{exact:true}).waitFor({timeout:95000});await viewerQuestion.getByText('Host answer',{exact:true}).waitFor();
   checks.push('Follower Q and A submission reached the host and the saved host answer reached the follower');await viewer.screenshot({path:path.join(evidence,'private-07-answered-question.png'),fullPage:true});

   const chapterTitle='QA server-timed chapter '+process.env.GITHUB_RUN_ID;
   await hostPanel.getByRole('button',{name:'Chapters',exact:true}).click();await viewerPanel.getByRole('button',{name:'Chapters',exact:true}).click();
   await hostPanel.getByLabel('Chapter title',{exact:true}).fill(chapterTitle);await hostPanel.getByLabel('Chapter time in seconds',{exact:true}).fill('');
   const marked=await uiCommand(host,'Host','live_interaction_command','chapter_add',()=>hostPanel.getByRole('button',{name:'Mark this moment',exact:true}).click());
   assert.equal(Object.hasOwn(marked.args.p_payload,'position_ms'),false,'Mark now supplied a client position');assert.equal(isUuid(marked.data.chapter?.id),true,'Chapter identity missing');
   assert.equal(Number.isSafeInteger(marked.data.chapter?.position_ms)&&marked.data.chapter.position_ms>=0,true,'Server chapter position missing');
   await viewerPanel.getByText(chapterTitle,{exact:true}).waitFor({timeout:95000});const chapterSeconds=Math.floor(marked.data.chapter.position_ms/1000),chapterClock=Math.floor(chapterSeconds/60)+':'+String(chapterSeconds%60).padStart(2,'0');
   await viewerPanel.getByRole('listitem').filter({has:viewer.getByText(chapterTitle,{exact:true})}).getByText(chapterClock,{exact:true}).waitFor();controls.push({actor:'Host',observation:'server-assigned-chapter',positionMs:marked.data.chapter.position_ms});
   checks.push('Host marked a chapter without a client timestamp and the follower saw the server-assigned marker');await viewer.screenshot({path:path.join(evidence,'private-08-server-chapter.png'),fullPage:true});
   const removed=await uiCommand(host,'Host','live_interaction_command','chapter_remove',()=>hostPanel.getByRole('button',{name:'Remove chapter '+chapterTitle,exact:true}).click());
   assert.equal(removed.args.p_payload?.chapter_id===marked.data.chapter.id,true,'Removed a different chapter');await viewerPanel.getByText(chapterTitle,{exact:true}).waitFor({state:'detached',timeout:95000});checks.push('Host removed the chapter and its removal reached the follower');

   const hostMessages=host.getByLabel('Recent chat messages',{exact:true}),viewerMessages=viewer.getByLabel('Recent chat messages',{exact:true});
   const originalMessage=hostMessages.locator(':scope > div').filter({has:host.getByText(body,{exact:true})});assert.equal(await originalMessage.count(),1,'Original viewer message is not unique');
   await uiCommand(host,'Host','live_command','remove_message',()=>originalMessage.getByRole('button',{name:'Remove message',exact:true}).click());
   await viewerMessages.getByText(body,{exact:true}).waitFor({state:'detached'});await viewerMessages.getByText('Message removed',{exact:true}).waitFor();checks.push('Host removed the original chat message and the follower saw its removal');
   await uiCommand(host,'Host','live_command','chat_settings',()=>host.getByLabel('Who can chat',{exact:true}).selectOption('closed'));
   await viewer.waitForFunction(()=>document.querySelector('textarea[aria-label="Message the live chat"]')?.disabled===true&&document.querySelector('button[aria-label="Send chat message"]')?.disabled===true);
   assert.equal(await host.getByLabel('Message the live chat',{exact:true}).isEnabled(),true,'Closing viewer chat removed host moderation access');checks.push('Closing chat disabled the follower composer while the host retained moderation access');
   await uiCommand(host,'Host','live_command','chat_settings',()=>host.getByLabel('Who can chat',{exact:true}).selectOption('open'));
   await viewer.waitForFunction(()=>document.querySelector('textarea[aria-label="Message the live chat"]')?.disabled===false);
   const reopened='QA chat reopened '+process.env.GITHUB_RUN_ID;await viewer.getByLabel('Message the live chat',{exact:true}).fill(reopened);
   await uiCommand(viewer,'Viewer','live_command','chat',()=>viewer.getByRole('button',{name:'Send chat message',exact:true}).click());await hostMessages.getByText(reopened,{exact:true}).waitFor();checks.push('Reopening chat restored follower input and delivered a new real message to the host');
  }
  async function exerciseInvitation(guest,guestActor,id){
   const studio=host.getByRole('region',{name:'Live production studio',exact:true});
   const username=await guest.evaluate(async()=>{const {data,error}=await window.__qaClient.from('profiles').select('username').eq('id',window.__LIVE_ACCEPTANCE.actor.id).single().abortSignal(AbortSignal.timeout(15000));if(error||typeof data?.username!=='string'||!data.username||data.username.length>100)throw Error('QA guest profile is unavailable');return data.username;});
   await studio.locator('summary').filter({hasText:'Stream tools and team'}).click();await studio.getByLabel('Team member username',{exact:true}).fill(username);await studio.getByLabel('Team role',{exact:true}).selectOption('guest');
   const invited=await uiCommand(host,'Host','live_command','invite',()=>studio.getByRole('button',{name:'Invite',exact:true}).click());
   assert.equal(invited.args.p_payload?.user_id===guestActor.id&&invited.args.p_payload?.role==='guest',true,'Invitation did not target the existing QA follower');
   await guest.goto(base+'/live/'+id);await guest.getByRole('button',{name:'Accept invitation',exact:true}).waitFor();
   await uiCommand(guest,'Viewer','live_command','accept_invite',()=>guest.getByRole('button',{name:'Accept invitation',exact:true}).click());
   await guest.getByRole('button',{name:'Studio',exact:true}).waitFor();
   assert.equal(await guest.getByRole('region',{name:'Live production studio',exact:true}).count(),0,'Accepting an invitation opened a camera without consent');
   checks.push('Host invitation and follower acceptance retained guest-only access without starting a camera');
  }
  async function exerciseGuest(guest,guestActor,publicId){
   const hostStudio=host.getByRole('region',{name:'Live production studio',exact:true});
   const hostRequests=host.getByRole('region',{name:'Join the live',exact:true});
   await guest.goto(base+'/live/'+publicId);
   let stageAdmissions=0;const observeStage=request=>{if(new URL(request.url()).pathname==='/functions/v1/live-stage')stageAdmissions++;};guest.on('request',observeStage);
   await uiCommand(guest,'Outsider','live_command','request_join',()=>guest.getByRole('button',{name:'Request to join',exact:true}).click());
   await hostRequests.getByRole('button',{name:/^Accept /}).waitFor({timeout:45000});
   await guest.getByText('Waiting for the host to accept.',{exact:true}).waitFor();
   await uiCommand(guest,'Outsider','live_command','cancel_join_request',()=>guest.getByRole('button',{name:'Cancel request',exact:true}).click());
   await hostRequests.getByText('No requests yet.',{exact:true}).waitFor({timeout:45000});
   await uiCommand(guest,'Outsider','live_command','request_join',()=>guest.getByRole('button',{name:'Request to join',exact:true}).click());
   const accepted=await uiCommand(host,'Host','live_command','accept_join_request',()=>hostRequests.getByRole('button',{name:/^Accept /}).click());
   assert.equal(accepted.args.p_payload?.user_id===guestActor.id&&accepted.data.status==='accepted',true,'Host approved a different guest request');
   await guest.getByRole('button',{name:'Join camera',exact:true}).waitFor({timeout:45000});
   assert.equal(stageAdmissions,0,'A guest request or approval started the camera before consent');
   assert.equal(await guest.locator('[data-live-stage]').count(),0,'Approval mounted a guest camera before consent');
   checks.push('Guest request, cancellation, renewed request and host approval reached separate browsers without refreshing or starting a camera');
   const automaticPublication=host.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/functions/v1/live-control'&&r.request().postDataJSON()?.action==='scene'&&r.request().postDataJSON()?.scene?.automatic===true&&r.request().postDataJSON()?.scene?.preset==='interview',{timeout:60000}).then(async response=>({status:response.status(),ok:(await response.json())?.ok===true}),()=>({status:0,ok:false}));
   const [accessResponse]=await Promise.all([guest.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/functions/v1/live-stage'),guest.getByRole('button',{name:'Join camera',exact:true}).click()]);
   guest.off('request',observeStage);
   const access=await accessResponse.json();
   // Only booleans reach assertions. Never allow an unexpected token or room
   // URL to become an assertion diff, error string, screenshot or receipt.
   const granted={status:accessResponse.status(),guestRole:access?.role==='guest',canPublish:access?.can_publish===true,hasToken:typeof access?.token==='string'&&access.token.length>0,hasRoom:typeof access?.roomUrl==='string'};
   stage.push({actor:'Outsider',observation:'stage-admission',...granted});assert.equal(granted.status,200,'Guest stage admission failed');assert.equal(granted.guestRole&&granted.canPublish&&granted.hasToken&&granted.hasRoom,true,'Guest did not receive publisher access');
   await guest.getByRole('button',{name:'Leave studio',exact:true}).waitFor({timeout:45000});
   const guestTracks=await until('Guest synthetic camera',()=>stageSnapshot(guest),tiles=>tiles.some(tile=>tile.local&&playingStageVideo(tile)),45000);
   const hostTracks=await until('Host decoded guest Daily track',()=>stageSnapshot(host),tiles=>tiles.length===2&&tiles.some(tile=>!tile.local&&playingStageVideo(tile)),45000);
   const previousTime=hostTracks.find(tile=>!tile.local).currentTime;
   const advancing=await until('Guest remote frames advancing',()=>stageSnapshot(host),tiles=>tiles.some(tile=>!tile.local&&playingStageVideo(tile)&&tile.currentTime>previousTime+0.5),30000);
   stage.push({actor:'Outsider',observation:'local-camera',tiles:guestTracks},{actor:'Host',observation:'remote-guest-decoded',tiles:advancing});checks.push('Approved guest explicitly joined their camera and published a synthetic camera through real Daily to the host');
   const automatic=await automaticPublication;controls.push({actor:'Host',endpoint:'live-control',action:'scene',automatic:true,...automatic});
   assert.equal(automatic.status,200,'Connected guest was not automatically selected for broadcast');assert.equal(automatic.ok,true,'Automatic guest publication was not accepted');checks.push('Joining the approved guest automatically published the host and guest interview scene without manual camera selection');
   await hostStudio.locator('summary').filter({hasText:'Stream tools and team'}).click();
   await hostStudio.getByRole('button',{name:'Camera grid',exact:true}).click();const sources=hostStudio.getByRole('checkbox');await sources.nth(1).waitFor();assert.equal(await sources.count(),2,'Expected only the host and invited guest cameras');await sources.nth(0).check();await sources.nth(1).check();
   const [sceneResponse]=await Promise.all([host.waitForResponse(r=>new URL(r.url()).origin===origin&&new URL(r.url()).pathname==='/functions/v1/live-control'&&r.request().postDataJSON()?.action==='scene'),hostStudio.getByRole('button',{name:'Apply scene',exact:true}).click()]);
   const sceneBody=sceneResponse.request().postDataJSON(),sceneResult=await sceneResponse.json(),selected=sceneBody?.scene?.participant_ids;
   controls.push({actor:'Host',endpoint:'live-control',action:'scene',status:sceneResponse.status(),ok:sceneResult?.ok===true,preset:sceneBody?.scene?.preset==='grid'?'grid':'unexpected',selectedCameras:Array.isArray(selected)?selected.length:0});
   assert.equal(sceneResponse.status(),200,'Real guest scene request failed');assert.equal(sceneResult?.ok===true,true,'Provider did not accept the guest scene');assert.equal(sceneBody?.sessionId===publicId&&sceneBody?.scene?.preset==='grid'&&Array.isArray(selected)&&selected.length===2&&selected.every(isUuid)&&new Set(selected).size===2,true,'Grid did not contain the two real publishers');
   await hostStudio.getByText('Scene change accepted.',{exact:true}).waitFor();checks.push('Live provider accepted the host scene request containing both actual publisher cameras');await host.screenshot({path:path.join(evidence,'public-clip-03-guest-grid.png'),fullPage:true});
   const remove=hostStudio.getByRole('button',{name:'Remove',exact:true});assert.equal(await remove.count(),1,'Expected only the invited QA team member');
   const removed=await uiCommand(host,'Host','live_command','remove_member',()=>remove.click());assert.equal(removed.args.p_payload?.user_id===guestActor.id,true,'Removed a different team member');
   await guest.getByRole('region',{name:'Live production studio',exact:true}).waitFor({state:'detached',timeout:95000});await guest.getByRole('button',{name:'Studio',exact:true}).waitFor({state:'detached'});
   const afterRemoval=await until('Removed guest left the host stage',()=>stageSnapshot(host),tiles=>tiles.length===1&&tiles[0].local&&playingStageVideo(tiles[0]),95000);
   stage.push({actor:'Host',observation:'guest-departed',tiles:afterRemoval});checks.push('Removing the guest removed their studio and the host observed their actual remote track depart');
   // Negative admission probe only. All positive invitation/join/scene/removal
   // writes above came from UI. This proves fresh admission is revoked, not
   // that a previously issued provider token has already received a ban.
   const denied=await guest.evaluate(async id=>{const {data,error}=await window.__qaClient.functions.invoke('live-stage',{body:{sessionId:id},signal:AbortSignal.timeout(15000)});let body=data,status=200;if(error){status=error.context instanceof Response?error.context.status:0;if(error.context instanceof Response)body=await error.context.clone().json().catch(()=>null);}const code=body?.error;return {status,hasToken:typeof body?.token==='string',hasRoom:typeof body?.roomUrl==='string',accessDenied:code==='ACCESS_DENIED'||code==='LIVE_NOT_AVAILABLE'};},publicId);
   stage.push({actor:'Outsider',observation:'fresh-stage-rejoin-denied',...denied});assert.equal(denied.status,403,'Removed guest received a non-denial stage response');assert.equal(denied.accessDenied,true,'Removed guest was not denied by authority');assert.equal(denied.hasToken||denied.hasRoom,false,'Removed guest received stage credentials');
   assert.equal(await guest.getByRole('button',{name:'Accept invitation',exact:true}).count(),0);checks.push('Removed guest could not obtain fresh stage credentials and no invitation or studio rejoin control remained');await host.screenshot({path:path.join(evidence,'public-clip-04-guest-removed.png'),fullPage:true});
  }
  async function startBroadcast(audience,label){
   await host.goto(base+'/live/new');await host.getByRole('button',{name:'Preview camera',exact:true}).waitFor();
   await host.getByLabel('Stream title, optional').fill('QA Live '+label+' '+process.env.GITHUB_RUN_ID);await host.getByLabel('Who can watch').selectOption(audience);await host.getByRole('button',{name:'More options',exact:true}).click();await host.getByLabel('Save replay and enable clips',{exact:false}).check();
   await host.screenshot({path:path.join(evidence,label+'-01-create.png'),fullPage:true});
   await host.getByRole('button',{name:'Preview camera',exact:true}).click();await host.getByRole('heading',{name:'Camera preview',exact:true}).waitFor();await host.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2),{},{timeout:45000});
   await host.getByLabel('Broadcast format',{exact:true}).selectOption('portrait');
   sessionId=new URL(host.url()).pathname.split('/')[2];assert.match(sessionId,/^[a-f0-9-]{36}$/);sessionIds.push(sessionId);checks.push(label+': actual QA host joined Daily with a synthetic camera');
   await host.getByRole('button',{name:'Enable microphone',exact:true}).click();await host.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();
   const starting=host.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/live-control')&&r.request().postDataJSON()?.action==='start');await host.getByRole('button',{name:'Go live',exact:true}).click();const response=await starting,result=await response.json();assert.equal(response.status(),200,'Real start request failed: '+String(result.error));assert.equal(result.ok,true,'Start acknowledgement missing');
   assert.equal(response.request().postDataJSON()?.scene?.orientation,'portrait','Actual format selector did not request portrait output');
   await host.waitForFunction(()=>Array.from(document.querySelectorAll('span')).some(node=>node.textContent==='LIVE'),{},{timeout:90000});assert.equal(await host.getByLabel('Broadcast format',{exact:true}).isDisabled(),true,'Live output format remained editable after start');checks.push(label+': actual portrait selection reached the provider and signed event confirmed LIVE');await host.screenshot({path:path.join(evidence,label+'-02-host-live.png'),fullPage:true});return sessionId;
  }
  async function stopBroadcast(label){
   const stopping=host.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/live-control')&&r.request().postDataJSON()?.action==='stop');await host.getByRole('button',{name:'End broadcast',exact:true}).click();const response=await stopping,result=await response.json();assert.equal(response.status(),200,'Real stop request failed: '+String(result.error));assert.equal(result.ok,true,'Stop acknowledgement missing');
   await until(label+' provider-confirmed end',()=>actorRpc(host,'live_session',{p_session_id:sessionId}),data=>data.session?.state==='ended'&&!!data.session.ended_at,90000);
   await host.waitForFunction(()=>Array.from(document.querySelectorAll('span')).some(node=>['ENDED','REPLAY'].includes(node.textContent||'')),{},{timeout:30000});await host.getByRole('button',{name:'End broadcast',exact:true}).waitFor({state:'detached'});checks.push(label+': signed provider end released the broadcast and removed studio controls');
  }
  async function watch(page,id){await page.goto(base+'/live/'+id);await page.getByRole('button',{name:'Watch live',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-live-player] video')).some(video=>video.readyState>=2&&video.currentTime>2&&!video.paused),{},{timeout:90000});
   const decoded=await page.locator('[data-live-player] video').evaluate(video=>({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,currentTime:Math.round(video.currentTime*1000)/1000}));
   assert.equal(decoded.width>0&&decoded.height>decoded.width&&Math.abs(decoded.width/decoded.height-9/16)<0.01,true,'Actual HLS decoder did not receive portrait9:16 video');
   players.push({actor:actors.find(actor=>actor.page===page)?.label,observation:'decoded-portrait-hls',stream:sessionIds.indexOf(id)+1,...decoded});checks.push('Actual follower HLS decoder received progressing portrait9:16 video');
  }
  const privateId=await startBroadcast('followers','private');
  const viewer=await actor('Viewer');await watch(viewer,privateId);checks.push('Separate follower browser decoded protected live HLS video');await viewer.screenshot({path:path.join(evidence,'private-03-viewer-live.png'),fullPage:true});
  const audio=await viewer.locator('[data-live-player] video').evaluate(video=>{const stream=video.captureStream(),tracks=stream.getAudioTracks();const count=tracks.length;stream.getTracks().forEach(track=>track.stop());return count;});assert.ok(audio>0,'Live HLS has no decoded audio track');checks.push('Protected HLS contains a decoded audio track from the enabled host microphone');
  await host.getByText('1 watching',{exact:true}).first().waitFor({timeout:95000});checks.push('Actual playing follower measured as one viewer, host preview excluded');
  const body='QA viewer message '+process.env.GITHUB_RUN_ID;await viewer.getByLabel('Message the live chat').fill(body);await viewer.getByRole('button',{name:'Send chat message',exact:true}).click();await host.getByText(body,{exact:true}).waitFor();checks.push('Viewer chat reached host over actual realtime transport');
  const reply='QA host reply '+process.env.GITHUB_RUN_ID;await host.getByLabel('Message the live chat').fill(reply);await host.getByRole('button',{name:'Send chat message',exact:true}).click();await viewer.getByText(reply,{exact:true}).waitFor();checks.push('Host reply reached follower');
  await host.getByRole('button',{name:'Pin message',exact:true}).first().click();await viewer.waitForFunction(text=>Array.from(document.querySelector('[aria-label="Live chat"]')?.children||[]).some(node=>node.querySelector(':scope > svg')&&node.textContent?.includes(text)),body);checks.push('Pinned message reached the separate follower pinned-message panel');
  await host.getByRole('button',{name:'Unpin message',exact:true}).click();await viewer.waitForFunction(text=>!Array.from(document.querySelector('[aria-label="Live chat"]')?.children||[]).some(node=>node.querySelector(':scope > svg')&&node.textContent?.includes(text)),body);checks.push('Unpin propagated to the follower');
  await viewer.getByRole('button',{name:'Love',exact:true}).click();await host.locator('[aria-live="polite"]').filter({hasText:'♥'}).waitFor();checks.push('Viewer reaction reached the host');
  await Promise.all([host.screenshot({path:path.join(evidence,'private-04-host-interaction.png'),fullPage:true}),viewer.screenshot({path:path.join(evidence,'private-05-viewer-interaction.png'),fullPage:true})]);
  await exerciseInteractions(viewer,body);
  const outsider=await actor('Outsider');await outsider.goto(base+'/live/'+privateId);await outsider.getByRole('alert').waitFor();assert.equal(await outsider.locator('video').count(),0);checks.push('Non-follower denied private playback');
  const notification=await until('Follower notification',()=>viewer.evaluate(async id=>{const {data,error}=await window.__qaClient.from('notifications').select('type,data').eq('recipient_id',window.__LIVE_ACCEPTANCE.actor.id).eq('type','live_stream').contains('data',{live_session_id:id}).limit(5).abortSignal(AbortSignal.timeout(15000));if(error)throw Error('Notification read failed');return (data||[]).map(item=>({type:item.type,sessionId:item.data?.sessionId,screen:item.data?.screen}));},privateId),rows=>rows.some(row=>row.sessionId===privateId));assert.equal(notification.length,1,'Follower notification duplicated');checks.push('Exactly one follower notification points to the actual Live session');
  const outsiderNotifications=await outsider.evaluate(async id=>{const {data,error}=await window.__qaClient.from('notifications').select('id').eq('recipient_id',window.__LIVE_ACCEPTANCE.actor.id).contains('data',{live_session_id:id}).limit(5).abortSignal(AbortSignal.timeout(15000));if(error)throw Error('Outsider notification read failed');return data?.length||0;},privateId);assert.equal(outsiderNotifications,0);checks.push('Non-follower received no private Live notification');
  const privateStream=sessionIds.indexOf(privateId)+1;await viewer.getByRole('button',{name:'Close player',exact:true}).click();await viewer.locator('[data-live-player]').waitFor({state:'detached'});
  // A pause, hidden tab or buffering may already have retired this lease. The
  // controller correctly avoids a duplicate leave when the player then closes.
  await until('Viewer acknowledged retirement',async()=>presence,events=>viewerPresenceRetired(events,privateStream),30000);
  await host.getByText('0 watching',{exact:true}).first().waitFor({timeout:95000});assert.ok(viewerPresenceRetired(presence,privateStream),'Viewer registered again after playback closed');checks.push('Closing playback retired only that player and measured viewers returned to zero');
  await exerciseInvitation(viewer,fixture.actors.find(actor=>actor.label==='Viewer'),privateId);
  await stopBroadcast('private');

  // Public fixture stream is separate. Private footage must never be published
  // into a public feed. Existing fixture cleanup cascades the test post.
  const publicId=await startBroadcast('public','public-clip');await watch(viewer,publicId);await viewer.waitForFunction(()=>document.querySelector('[data-live-player] video')?.currentTime>6,{},{timeout:45000});
  await until('Public Live follower notification',()=>viewer.evaluate(async id=>{const {data,error}=await window.__qaClient.from('notifications').select('id').eq('recipient_id',window.__LIVE_ACCEPTANCE.actor.id).eq('type','live_stream').contains('data',{live_session_id:id}).limit(2).abortSignal(AbortSignal.timeout(15000));if(error)throw Error('Public notification read failed');return data?.length||0;},publicId),count=>count===1);
  await exerciseGuest(outsider,fixture.actors.find(actor=>actor.label==='Outsider'),publicId);
  await stopBroadcast('public-clip');
  const available=await until('Recorded footage',()=>actorRpc(host,'live_clip_context',{p_session_id:publicId}),data=>data.recording_available===true&&data.can_clip===true&&data.available_end_ms>=8000,120000);
  assert.ok(available.available_end_ms>=8000);
  await host.getByRole('link',{name:'Create clip',exact:true}).click();await host.getByRole('heading',{name:'Create a clip',exact:true}).waitFor();
  const clipTitle='QA rendered Live clip '+process.env.GITHUB_RUN_ID;await host.getByLabel('Title',{exact:true}).fill(clipTitle);await host.getByLabel('Caption',{exact:true}).fill('Synthetic QA footage. Removed automatically after acceptance.');await host.getByLabel('Start, seconds',{exact:true}).fill('0');await host.getByLabel('End, seconds',{exact:true}).fill('8');
  const creating=host.waitForResponse(r=>isCommand(r,'live_clip_command','create'));await host.getByRole('button',{name:'Create clip',exact:true}).click();const createResponse=await creating,created=await createResponse.json();assert.equal(createResponse.status(),200,'Real clip creation failed');clipId=created.clip_id;assert.match(clipId||'',/^[a-f0-9-]{36}$/);await host.getByRole('heading',{name:'Your clip is in the queue',exact:true}).waitFor();checks.push('Actual replay clip submitted with exact eight-second range and both video formats');
  await host.getByRole('link',{name:'Open clip library',exact:true}).click();await host.getByRole('heading',{name:'Clip library',exact:true}).waitFor();
  clipPollDiagnostic=createClipPollDiagnostic();
  const rendered=await until('Actual clip renderer',async()=>{const data=await actorRpc(host,'live_clip_get',{p_clip_id:clipId});clipPollDiagnostic.observe(data);return data;},data=>{if(data.clip?.state==='failed')throw Error('Clip renderer failed: '+String(data.clip.error||'unknown'));return data.clip?.state==='ready';},240000);assert.equal(rendered.permissions?.can_publish,true,'Rendered clip is not publishable');checks.push('Real encoder completed the recorded clip and approved private output assets');
  await host.getByRole('button',{name:'Refresh',exact:true}).click();await host.getByRole('button',{name:new RegExp(clipTitle)}).click();await host.getByRole('dialog').waitFor();
  const publishing=host.waitForResponse(r=>isCommand(r,'live_clip_command','publish'));await host.getByRole('button',{name:'Publish clip',exact:true}).click();const publishResponse=await publishing,published=await publishResponse.json();assert.equal(publishResponse.status(),200,'Feed publication failed');assert.equal(published.state,'published');postId=published.post_id;assert.match(postId||'',/^[a-f0-9-]{36}$/);await host.getByText('Published successfully.',{exact:true}).waitFor();checks.push('Rendered public clip published to an actual Platinum Circles feed post');await host.screenshot({path:path.join(evidence,'clip-04-publication.png'),fullPage:true});
  await host.getByRole('button',{name:'Prepare video for sharing',exact:true}).click();await host.getByRole('button',{name:'Share video',exact:true}).waitFor({timeout:60000});checks.push('Actual MP4 downloaded and prepared for device sharing without claiming an external social post');
  await viewer.goto(base+'/live/clips/'+clipId);await viewer.getByRole('heading',{name:clipTitle,exact:true}).waitFor();await viewer.locator('video').waitFor();await viewer.locator('video').evaluate(video=>video.play());await viewer.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2&&video.currentTime>2),{},{timeout:60000});checks.push('Follower decoded the published clip through authorized private media delivery');await viewer.screenshot({path:path.join(evidence,'clip-05-viewer.png'),fullPage:true});
  const feedMedia=await viewer.evaluate(async id=>{const client=window.__qaClient;const post=await client.from('posts').select('id,user_id,post_media(id,media_type)').eq('id',id).single().abortSignal(AbortSignal.timeout(15000));if(post.error||!post.data?.post_media?.some(item=>item.media_type==='video'))throw Error('Published feed post missing video');const signed=await client.functions.invoke('content-media-sign',{body:{references:[{kind:'post',id}],delivery:'no-store'},signal:AbortSignal.timeout(15000)});if(signed.error||!Array.isArray(signed.data?.urls))throw Error('Feed clip authorization failed');const asset=signed.data.urls.find(item=>item.key?.startsWith('live-clips/')&&item.key.endsWith('.mp4'));if(!asset)throw Error('Feed video capability missing');const media=await fetch(asset.url,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(15000)});const bytes=(await media.arrayBuffer()).byteLength;return {status:media.status,bytes,contentType:media.headers.get('content-type'),postId:post.data.id};},postId);assert.ok([200,206].includes(feedMedia.status)&&feedMedia.bytes>0,'Published feed media unavailable');assert.match(feedMedia.contentType||'',/video\/mp4/);checks.push('Feed post references authorized clip media and delivers real MP4 bytes to the follower');
  const state=await lab('inspect');await fs.writeFile(path.join(evidence,'connected-state.json'),JSON.stringify(state,null,2));assert.ok(state.sessions.every(item=>item.state==='ended'),'A fixture broadcast did not finish');assert.ok(state.notifications>=2,'Each confirmed Live session must notify its follower');
 }catch(error){failure=safeDiagnosticText(error.message);
  try{if(clipPollDiagnostic)await fs.writeFile(path.join(evidence,'clip-render-diagnostic.json'),JSON.stringify(clipPollDiagnostic.snapshot(),null,2));}catch{/* Preserve the original failure and its existing cleanup. */}
  try{if(bootstrapped)await fs.writeFile(path.join(evidence,'failure-diagnostic.json'),JSON.stringify(await lab('inspect'),null,2));}catch(e){errors.push({diagnostic:safeDiagnosticText(e.message)});}for(const {label,page}of actors){const videos=await page.evaluate(()=>Array.from(document.querySelectorAll('video')).map(video=>({player:!!video.closest('[data-live-player]'),engine:(video.dataset.livePlaybackEngine||'unset').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),failure:(video.dataset.livePlaybackFailure||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||null,readyState:video.readyState,networkState:video.networkState,mediaErrorCode:video.error?.code??null,paused:video.paused,currentTime:Math.round(video.currentTime*10)/10,videoWidth:video.videoWidth,videoHeight:video.videoHeight}))).catch(()=>[]);players.push({actor:label,videos});await page.screenshot({path:path.join(evidence,'failure-'+label.toLowerCase()+'.png'),fullPage:true}).catch(()=>{});}
 }finally{
  await Promise.allSettled([...pendingDiagnostics]);
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(bootstrapped)try{cleanup=await lab('cleanup');}catch(error){cleanup={ok:false,error:safeDiagnosticText(error.message)};}
  const receipt={source:process.env.GITHUB_SHA,scope:'Actual Live components, QA Supabase, Daily, protected CDN and clip renderer. Synthetic camera, no physical phone or external social posting. Guest removal proves observed track departure and fresh admission denial, not old-token provider ban.',checks,errors,responses,delivery,players,presence,controls,stage,failure,cleanup,sessionId,sessionIds,clipId,postId,clipRenderDiagnostic:clipPollDiagnostic?.snapshot()??null};await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }
 if(failure||errors.length||cleanup?.ok!==true)throw Error('Connected Live acceptance did not pass');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
