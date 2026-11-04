// Real-provider acceptance. No secrets, browser state, or network traces are saved.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('../../node_modules/playwright'),{compile}=require('./ui-compile.cjs');
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
async function main(){
 const evidence=process.env.LIVE_CONNECTED_EVIDENCE||'/tmp/live-connected-evidence',output='/tmp/live-connected-browser';await fs.mkdir(evidence,{recursive:true});
 const adapter=path.join(__dirname,'live-connected-adapter.tsx');await compile({entry:path.join(__dirname,'live-connected-fixture.tsx'),output,title:'Platinum Live connected QA',aliases:{'@/lib/supabase/client':adapter,'@/lib/navigationCache':adapter,'next/navigation':adapter,'next/link':adapter}});
 const server=http.createServer(async(req,res)=>{try{let file=new URL(req.url,'http://local').pathname;file=path.extname(file)?path.basename(file):'index.html';const bytes=await fs.readFile(path.join(output,file));res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(bytes);}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLATINUM_CHROMIUM||undefined,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const checks=[],errors=[],responses=[],delivery=[],players=[],actors=[],pendingDiagnostics=new Set();let failure=null,bootstrapped=false,sessionId=null,cleanup=null;
 const base='http://127.0.0.1:'+server.address().port,anon=require(path.join(root,'eas.json')).build.preview.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
 try{
  const fixture=await lab('bootstrap');bootstrapped=true;assert.equal(fixture.actors.length,3);
  async function actor(label){const selected=fixture.actors.find(a=>a.label===label),context=await browser.newContext({viewport:{width:1365,height:900},permissions:['camera','microphone']});await context.addInitScript(input=>{window.__LIVE_ACCEPTANCE=input;},{origin,anon,actor:selected});const page=await context.newPage();actors.push({label,page});page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push({actor:label,message:safeDiagnosticText(error.message)}));page.on('dialog',dialog=>dialog.accept());page.on('response',async response=>{const url=new URL(response.url());if(url.origin===origin&&/\/live-(control|playback)$/.test(url.pathname)){const data=await response.json().catch(()=>({}));responses.push({actor:label,endpoint:url.pathname.split('/').pop(),status:response.status(),error:data.error?safeDiagnosticText(data.error):null,state:data.state||null,ok:data.ok===true});}if(/\.(m3u8|ts|m4s)$/.test(url.pathname)&&delivery.length<50){const item={actor:label,...mediaLocation(url),status:response.status(),responseClass:'pending'};delivery.push(item);const diagnostic=mediaResponseClass(response).then(value=>{item.responseClass=value;});pendingDiagnostics.add(diagnostic);void diagnostic.finally(()=>pendingDiagnostics.delete(diagnostic));}});page.on('requestfailed',request=>{const url=new URL(request.url());if(/\.(m3u8|ts|m4s)$/.test(url.pathname)&&delivery.length<50){const reason=request.failure()?.errorText||'';delivery.push({actor:label,...mediaLocation(url),failed:true,responseClass:/^net::ERR_[A-Z_]+$/.test(reason)?reason:'network_error'});}});return page;}
  const host=await actor('Host');await host.goto(base+'/live/new');await host.getByRole('button',{name:'Preview camera',exact:true}).waitFor();await host.getByLabel('Stream title, optional').fill('QA Live acceptance '+process.env.GITHUB_RUN_ID);await host.getByLabel('Who can watch').selectOption('followers');await host.getByRole('button',{name:'More options',exact:true}).click();await host.getByLabel('Save replay and enable clips',{exact:false}).check();await host.screenshot({path:path.join(evidence,'01-create.png'),fullPage:true});
  await host.getByRole('button',{name:'Preview camera',exact:true}).click();await host.getByRole('heading',{name:'Camera preview',exact:true}).waitFor();await host.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2),{},{timeout:45000});sessionId=new URL(host.url()).pathname.split('/')[2];assert.match(sessionId,/^[a-f0-9-]{36}$/);checks.push('Actual QA account created a followers-only session and joined Daily with a synthetic camera');
  await host.getByRole('button',{name:'Enable microphone',exact:true}).click();await host.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();await host.screenshot({path:path.join(evidence,'02-camera-preview.png'),fullPage:true});
  const starting=host.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/live-control'));await host.getByRole('button',{name:'Go live',exact:true}).click();const startResponse=await starting;const startResult=await startResponse.json();assert.equal(startResponse.status(),200,'Real start request failed: '+String(startResult.error));assert.equal(startResult.ok,true,'Start acknowledgement missing');
  await host.waitForFunction(()=>Array.from(document.querySelectorAll('span')).some(node=>node.textContent==='LIVE'),{},{timeout:90000});checks.push('Signed provider event confirmed broadcast LIVE');await host.screenshot({path:path.join(evidence,'03-host-live.png'),fullPage:true});
  const viewer=await actor('Viewer');await viewer.goto(base+'/live/'+sessionId);await viewer.getByRole('button',{name:'Watch live',exact:true}).click();await viewer.waitForFunction(()=>Array.from(document.querySelectorAll('video')).some(video=>video.readyState>=2&&video.currentTime>2),{},{timeout:90000});checks.push('Separate follower browser decoded protected live HLS video');await viewer.screenshot({path:path.join(evidence,'04-viewer-live.png'),fullPage:true});
  const body='QA viewer message '+process.env.GITHUB_RUN_ID;await viewer.getByLabel('Message the live chat').fill(body);await viewer.getByRole('button',{name:'Send chat message',exact:true}).click();await host.getByText(body,{exact:true}).waitFor();checks.push('Viewer chat reached host over actual realtime transport');
  const reply='QA host reply '+process.env.GITHUB_RUN_ID;await host.getByLabel('Message the live chat').fill(reply);await host.getByRole('button',{name:'Send chat message',exact:true}).click();await viewer.getByText(reply,{exact:true}).waitFor();checks.push('Host reply reached follower');
  await host.getByRole('button',{name:'Pin message',exact:true}).first().click();await viewer.locator('section[aria-label="Live chat"]').getByText(body,{exact:false}).first().waitFor();checks.push('Host pin command accepted');
  const outsider=await actor('Outsider');await outsider.goto(base+'/live/'+sessionId);await outsider.getByRole('alert').waitFor();assert.equal(await outsider.locator('video').count(),0);checks.push('Non-follower denied private playback');
  const stopping=host.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/live-control'));await host.getByRole('button',{name:'End broadcast',exact:true}).click();assert.equal((await stopping).status(),200);await host.waitForFunction(()=>Array.from(document.querySelectorAll('span')).some(node=>node.textContent==='ENDED'),{},{timeout:90000});checks.push('Provider-confirmed end releases the broadcast');
  const state=await lab('inspect');await fs.writeFile(path.join(evidence,'connected-state.json'),JSON.stringify(state,null,2));assert.ok(state.notifications>=1,'No follower notification receipt');checks.push('Follower notification created by confirmed live event');
 }catch(error){failure=safeDiagnosticText(error.message);try{if(bootstrapped)await fs.writeFile(path.join(evidence,'failure-diagnostic.json'),JSON.stringify(await lab('inspect'),null,2));}catch(e){errors.push({diagnostic:safeDiagnosticText(e.message)});}for(const {label,page}of actors){const videos=await page.evaluate(()=>Array.from(document.querySelectorAll('video')).map(video=>({player:!!video.closest('[data-live-player]'),engine:(video.dataset.livePlaybackEngine||'unset').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),failure:(video.dataset.livePlaybackFailure||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||null,readyState:video.readyState,networkState:video.networkState,mediaErrorCode:video.error?.code??null,paused:video.paused,currentTime:Math.round(video.currentTime*10)/10,videoWidth:video.videoWidth,videoHeight:video.videoHeight}))).catch(()=>[]);players.push({actor:label,videos});await page.screenshot({path:path.join(evidence,'failure-'+label.toLowerCase()+'.png'),fullPage:true}).catch(()=>{});}
 }finally{
  await Promise.allSettled([...pendingDiagnostics]);
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(bootstrapped)try{cleanup=await lab('cleanup');}catch(error){cleanup={ok:false,error:safeDiagnosticText(error.message)};}
  const receipt={source:process.env.GITHUB_SHA,scope:'Actual Live components, QA Supabase, Daily and protected CDN. Synthetic camera, no physical phone.',checks,errors,responses,delivery,players,failure,cleanup,sessionId};await fs.writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }
 if(failure||errors.length||cleanup?.ok!==true)throw Error('Connected Live acceptance did not pass');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
