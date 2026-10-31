const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),cache=new Map();
function load(file,timer=setTimeout){const full=path.join(root,file),exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Request,AbortController,Uint8Array,ArrayBuffer,DataView,TextDecoder,TextEncoder,Promise,setTimeout:timer,clearTimeout,require(name){const target=path.relative(root,path.resolve(path.dirname(full),name));if(!cache.has(target))cache.set(target,load(target));return cache.get(target);}});return exports;}
function wav(){const bytes=Buffer.alloc(88244);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(22050,24);bytes.writeUInt32LE(44100,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),track='10000000-0000-4000-8000-000000000001',sound='20000000-0000-4000-8000-000000000001',token='pc_catalogue_'+'c'.repeat(64);
function fixture(changes={},factory=load('supabase/functions/music-catalogue-ingest/handler.ts').createCatalogueIngestHandler){
 const bytes=wav(),sha=digest(bytes),calls=[],asset={trackId:track,providerId:'fixture',path:`catalogue/fixture/${track}/${sha}.wav`,mime:'audio/wav',bytes:bytes.length,sha256:sha,status:'reserved',soundId:null};
 const deps={reserve:async()=>{calls.push('reserve');return asset;},store:async()=>{calls.push('store');return true;},read:async()=>{calls.push('read');return{response:new Response(bytes),version:'stored-v1'};},finish:async(...args)=>{calls.push(['finish',...args]);return sound;},digest:async value=>digest(value),...changes};
 const request=(extra={})=>new Request('https://example.supabase.co/functions/v1/music-catalogue-ingest',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Catalogue-Track':track,'X-Audio-Sha256':sha,'Content-Type':'audio/wav','Content-Length':String(bytes.length),...extra},body:bytes});
 return{run:factory(deps),deps,calls,bytes,sha,asset,request};
}
test('provider-neutral ingestion verifies both pushed and persisted bytes before finalization',async()=>{const f=fixture(),r=await f.run(f.request());assert.equal(r.status,200);assert.equal((await r.json()).soundId,sound);assert.deepEqual(f.calls.slice(0,3),['reserve','store','read']);const finish=f.calls.find(Array.isArray);assert.equal(finish[3],2);assert.equal(finish[4],f.sha);assert.equal(finish[5],'stored-v1');});
test('unlicensed provider or mismatched track cannot store any bytes',async()=>{
 for(const change of [null,{trackId:sound}]){const f=fixture();if(change===null)f.deps.reserve=async()=>null;else Object.assign(f.asset,change);assert.equal((await f.run(f.request())).status,403);assert.equal(f.calls.includes('store'),false);}
});
test('service keys and app JWTs do not authenticate catalogue pushes',async()=>{for(const token of ['service-role-secret','application-token','']){const f=fixture();assert.equal((await f.run(f.request({Authorization:'Bearer '+token}))).status,401);assert.equal(f.calls.length,0);}});
test('invalid lengths, unsupported MIME and invalid digest fail before reservation',async()=>{
 for(const headers of [{'Content-Length':'52428801'},{'Content-Length':'0'},{'Content-Length':'88000.1'},{'Content-Type':'video/mp4'},{'X-Audio-Sha256':'not-a-digest'}]){const f=fixture();assert.equal((await f.run(f.request(headers))).status,400);assert.equal(f.calls.length,0);}
});
test('wrong persisted bytes cannot be finalized even after successful Storage upload',async()=>{
 const f=fixture();const changed=Buffer.from(f.bytes);changed[45]=1;f.deps.read=async()=>({response:new Response(changed),version:'stored-v1'});
 assert.equal((await f.run(f.request())).status,409);assert.equal(f.calls.some(Array.isArray),false);
});
test('malformed incoming audio cannot reach Storage',async()=>{const f=fixture();f.bytes[0]=0;assert.equal((await f.run(f.request())).status,422);assert.equal(f.calls.includes('store'),false);});
test('a verified exact retry reuses the sound without another upload',async()=>{const f=fixture();Object.assign(f.asset,{status:'ready',soundId:sound});const r=await f.run(f.request());assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);assert.deepEqual(f.calls,['reserve']);});
test('licence revoked during verification prevents finalization success',async()=>{const f=fixture({finish:async()=>null});assert.equal((await f.run(f.request())).status,409);});
test('path substitution and extra file ownership components are rejected before Storage',async()=>{const f=fixture();f.asset.path=`catalogue/fixture/../${track}/${f.sha}.wav`;assert.equal((await f.run(f.request())).status,403);assert.equal(f.calls.includes('store'),false);});
test('deadline stops a stalled provider lookup and aborts the shared signal',async()=>{
 let expire,signal,started=false;const factory=load('supabase/functions/music-catalogue-ingest/handler.ts',(fn,ms)=>{assert.equal(ms,45000);expire=fn;return 1;}).createCatalogueIngestHandler;
 const f=fixture({reserve:async(_token,_track,_bytes,_mime,_sha,s)=>{signal=s;started=true;return new Promise(()=>{});}},factory),work=f.run(f.request());while(!started)await new Promise(resolve=>setImmediate(resolve));expire();assert.equal((await work).status,408);assert.equal(signal.aborted,true);
});
test('deadline also stops an uncooperative uploaded-body stream',async()=>{
 let expire,started=false,cancelled=0;const factory=load('supabase/functions/music-catalogue-ingest/handler.ts',(fn)=>{expire=fn;return 1;}).createCatalogueIngestHandler;
 const f=fixture({},factory),real=f.request(),fake={method:real.method,headers:real.headers,signal:real.signal,body:{getReader:()=>({read:()=>{started=true;return new Promise(()=>{});},cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock(){}})}};
 const work=f.run(fake);while(!started)await new Promise(resolve=>setImmediate(resolve));expire();assert.equal((await work).status,408);assert.equal(cancelled,1);
});
