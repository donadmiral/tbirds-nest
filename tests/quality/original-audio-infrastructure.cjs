const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const cache=new Map();
function load(file){const full=path.resolve(root,file);if(cache.has(full))return cache.get(full);const exports={};cache.set(full,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Uint8Array,ArrayBuffer,DataView,TextDecoder,TextEncoder,Request,Response,URL,AbortController,setTimeout,clearTimeout,console,require(name){return load(path.relative(root,path.resolve(path.dirname(full),name.endsWith('.ts')?name:name+'.ts')));}});return exports;}
const {inspectOriginalAudio}=load('shared/originalAudio.ts'),{createMusicFinalizeHandler}=load('supabase/functions/music-asset-finalize/handler.ts');
function wav(seconds=2){const rate=22050,bytes=Buffer.alloc(44+rate*seconds*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);for(let i=0;i<rate*seconds;i++)bytes.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*880)*9000),44+i*2);return bytes;}
const owner='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',sound='30000000-0000-4000-8000-000000000001';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function handler(change={}){const bytes=wav(),upload={id,ownerId:owner,path:`${owner}/${id}.wav`,mime:'audio/wav',bytes:bytes.length,sha256:hash(bytes),status:'reserved'};const calls=[];const deps={getUpload:async()=>upload,object:async()=>({version:'version-1'}),download:async()=>{calls.push('download');return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});},finish:async(...args)=>{calls.push(['finish',...args]);return sound;},digest:async bytes=>hash(bytes),...change};return {run:createMusicFinalizeHandler(deps),calls,upload,bytes};}
const request=body=>new Request('https://example.test/functions/v1/music-asset-finalize',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:body??JSON.stringify({requestId:id})});
test('WAV inspection derives duration from actual PCM bytes and rejects malformed or overlong input',()=>{assert.equal(inspectOriginalAudio(wav()).durationSec,2);for(const bytes of [wav().subarray(0,100),Buffer.from('not audio'.repeat(30)),wav(.5),wav(601)])assert.throws(()=>inspectOriginalAudio(bytes));const bytes=wav();bytes.writeUInt32LE(1,28);assert.throws(()=>inspectOriginalAudio(bytes));});
test('the original memory score is a complete inspectable M4A audio asset',()=>{const result=inspectOriginalAudio(fs.readFileSync(path.join(root,'assets/audio/platinum-memory-score.m4a')));assert.equal(result.mime,'audio/mp4');assert.ok(result.durationSec>=1&&result.durationSec<=600);});
test('bundled MP3 audio is inspected frame by frame and rejects a truncated final frame',()=>{const bytes=fs.readFileSync(path.join(root,'assets/callsounds/incallmanager_ringback.mp3')),result=inspectOriginalAudio(bytes);assert.equal(result.mime,'audio/mpeg');assert.ok(result.durationSec>11&&result.durationSec<13);assert.throws(()=>inspectOriginalAudio(bytes.subarray(0,bytes.length-7)));});
test('finalizer accepts verified bytes and passes the exact observed object version',async()=>{const h=handler(),response=await h.run(request());assert.equal(response.status,200);assert.equal((await response.json()).soundId,sound);const finish=h.calls.find(value=>Array.isArray(value));assert.equal(finish[2],2);assert.equal(finish[4],'version-1');});
test('wrong owner/path and unauthorized reservations never download Storage',async()=>{const h=handler({getUpload:async()=>null});assert.equal((await h.run(request())).status,403);assert.equal(h.calls.length,0);const b=handler();b.upload.path='other-owner/private.wav';assert.equal((await b.run(request())).status,403);assert.equal(b.calls.length,0);});
test('a completed retry reuses its sound without reading or creating another object',async()=>{const h=handler();h.upload.status='ready';h.upload.soundId=sound;assert.equal((await h.run(request())).status,200);assert.equal(h.calls.length,0);});
test('hash, byte size, MIME and incomplete streams cannot finalize',async()=>{for(const change of ['hash','size','mime']){const h=handler();if(change==='hash')h.upload.sha256='b'.repeat(64);if(change==='size')h.upload.bytes++;if(change==='mime')h.upload.mime='audio/mp4';const response=await h.run(request());assert.ok([409,422].includes(response.status));assert.ok(!h.calls.some(value=>Array.isArray(value)));}});
test('oversized request bodies are rejected before account lookup',async()=>{let looked=false;const h=handler({getUpload:async()=>{looked=true;return null;}});assert.equal((await h.run(request('x'.repeat(1025)))).status,413);assert.equal(looked,false);});
test('account revocation during verification prevents finalization',async()=>{const h=handler();let checks=0;const b=handler({getUpload:async()=>++checks===1?h.upload:null});assert.equal((await b.run(request())).status,403);assert.ok(!b.calls.some(value=>Array.isArray(value)));});
test('private audio URLs are recognized by both canonical and no-store client hydration',()=>{const {contentObject}=load('shared/contentMedia.ts');const base='https://example.supabase.co';assert.equal(contentObject(`${base}/storage/v1/object/public/music-audio/${owner}/${id}.wav`,base)?.bucket,'music-audio');});

test('legacy Storage signing can never issue a reusable capability for original audio',async()=>{const {createContentMediaHandler}=load('supabase/functions/content-media-sign/handler.ts');let signed=0;const base='https://example.supabase.co';const run=createContentMediaHandler({base,authenticate:async()=>true,manifest:async()=>[{media_url:`${base}/storage/v1/object/public/music-audio/${owner}/${id}.wav`}],sign:async()=>{signed++;return[];}});const response=await run(new Request(base,{method:'POST',body:JSON.stringify({references:[{kind:'sound',id:sound}]})}));assert.equal(response.status,400);assert.equal(signed,0);});

test('verification deadlines abort stalled account reads and service finalization',async()=>{
 for(const step of ['read','finish']){
  let expire,observed,started=false;const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/music-asset-finalize/handler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Uint8Array,TextDecoder,Request,Response,AbortController,setTimeout(fn,ms){assert.equal(ms,45000);expire=fn;return 1;},clearTimeout(){},require:()=>load('shared/originalAudio.ts')});
  const h=handler(),deps={getUpload:async(_request,_id,signal)=>{if(step==='read'){observed=signal;started=true;return new Promise(()=>{});}return h.upload;},object:async()=>({version:'version-1'}),download:async()=>new Response(h.bytes,{headers:{'Content-Length':String(h.bytes.length)}}),digest:async bytes=>hash(bytes),finish:async(_upload,_duration,_hash,_version,signal)=>{observed=signal;started=true;return new Promise(()=>{});}};
  const work=exports.createMusicFinalizeHandler(deps)(request());for(let i=0;i<30&&!started;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);expire();const response=await work;assert.equal(response.status,408);assert.equal(observed.aborted,true);
 }
});
test('missing or paused server capability keeps original uploads unavailable',async()=>{
 const {originalAudioReady}=load('shared/originalAudioAvailability.ts');
 assert.equal(await originalAudioReady({rpc:async()=>({data:null,error:{code:'PGRST202',message:'Could not find the function'}})}),false);
 assert.equal(await originalAudioReady({rpc:async()=>({data:{version:1,uploadsEnabled:false},error:null})}),false);
 assert.equal(await originalAudioReady({rpc:async()=>({data:{version:1,uploadsEnabled:true,catalogEnabled:false},error:null})}),true);
 await assert.rejects(()=>originalAudioReady({rpc:async()=>({data:null,error:{message:'BUSINESS_SESSION_REQUIRED'}})}),/approved business/);
});
test('stalled request and audio streams cannot outlive the deadline even when cancellation stalls',async()=>{
 for(const step of ['body','download']){
  let expire,started=false,cancelled=0,released=0;const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/music-asset-finalize/handler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Uint8Array,TextDecoder,Request,Response,AbortController,setTimeout(fn,ms){assert.equal(ms,45000);expire=fn;return 1;},clearTimeout(){},require:()=>load('shared/originalAudio.ts')});
  const pending=()=>new Promise(()=>{}),reader={read(){started=true;return pending();},cancel(){cancelled++;return pending();},releaseLock(){released++;}};
  const h=handler(),deps={getUpload:async()=>h.upload,object:async()=>({version:'version-1'}),download:async()=>({ok:true,headers:new Headers({'Content-Length':String(h.bytes.length)}),body:{getReader:()=>reader}}),digest:async bytes=>hash(bytes),finish:async()=>sound};
  const input=step==='body'?{method:'POST',headers:new Headers({Authorization:'Bearer synthetic'}),signal:new AbortController().signal,body:{getReader:()=>reader}}:request();
  const work=exports.createMusicFinalizeHandler(deps)(input);for(let i=0;i<30&&!started;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);expire();const response=await work;assert.equal(response.status,408);assert.ok(cancelled>0);assert.ok(released>0);
 }
});
test('rejecting an incomplete body does not wait for an uncooperative cancel promise',async()=>{
 let cancelled=false;const h=handler({download:async()=>({ok:false,headers:new Headers(),body:{cancel(){cancelled=true;return new Promise(()=>{});}}})});
 const response=await h.run(request());assert.equal(response.status,409);assert.equal(cancelled,true);
});
function uploadClient(){
 const listeners=new Set(),calls=[];let status='reserved';const session={user:{id:owner},access_token:'captured-owner-token'};
 const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange(fn){listeners.add(fn);return{data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}},rpc:async(name,args)=>{calls.push({name,args});return{data:{id,path:`${owner}/${id}.wav`,status,...(status==='ready'?{soundId:sound}:{})},error:null};}};
 const input={requestId:id,owner,title:'Synthetic original',reuseAllowed:false,rightsAttested:true,bytes:wav(),sha256:hash(wav())};
 const transport={upload:async(...args)=>{calls.push({name:'upload',args});},finalize:async(...args)=>{calls.push({name:'finalize',args});status='ready';return{soundId:sound};}};
 return{client,input,transport,calls,listeners,auth(next){for(const fn of listeners)fn('SIGNED_IN',{user:{id:next},access_token:next+'-token'});}};
}
test('original upload reserves, transfers and finalizes once, then reuses the verified retry',async()=>{
 const {uploadOriginalAudio}=load('shared/musicUpload.ts'),h=uploadClient();assert.equal(await uploadOriginalAudio(h.client,h.input,h.transport),sound);assert.equal(await uploadOriginalAudio(h.client,h.input,h.transport),sound);
 assert.equal(h.calls.filter(call=>call.name==='upload').length,1);assert.equal(h.calls.filter(call=>call.name==='finalize').length,1);assert.equal(h.calls.find(call=>call.name==='upload').args[2],'captured-owner-token');assert.equal(h.listeners.size,0);
});
test('an A-to-B-to-A change during the initial Auth read prevents reservation and releases its subscription',async()=>{
 const {uploadOriginalAudio}=load('shared/musicUpload.ts'),h=uploadClient();let resolve;h.client.auth.getSession=()=>new Promise(done=>{resolve=done;});
 const result=uploadOriginalAudio(h.client,h.input,h.transport);h.auth('different-owner');h.auth(owner);resolve({data:{session:{user:{id:owner},access_token:'new-owner-token'}}});
 await assert.rejects(result,/account that started/);assert.equal(h.calls.length,0);assert.equal(h.listeners.size,0);
});
test('an account change during Storage transfer cannot finalize the old account audio',async()=>{
 const {uploadOriginalAudio}=load('shared/musicUpload.ts'),h=uploadClient();h.transport.upload=async()=>{h.auth('different-owner');h.auth(owner);};
 await assert.rejects(()=>uploadOriginalAudio(h.client,h.input,h.transport),/account changed/);assert.equal(h.calls.some(call=>call.name==='finalize'),false);assert.equal(h.listeners.size,0);
});
