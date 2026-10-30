const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const code=ts.transpileModule(fs.readFileSync(path.join(root,'supabase/functions/music-maintenance/handler.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(timer=setTimeout){const exports={};vm.runInNewContext(code,{exports,Response,Request,AbortController,Promise,setTimeout:timer,clearTimeout});return exports.createMusicMaintenanceHandler;}
const id='10000000-0000-4000-8000-000000000001',owner='20000000-0000-4000-8000-000000000001',worker='30000000-0000-4000-8000-000000000001',object='40000000-0000-4000-8000-000000000001';
const token='pc_music_'+'a'.repeat(64),service='service-test-key';
function fixture(changes={},factory=load()){
 const calls=[];let claims=0;const job={id,ownerId:owner,path:`${owner}/${id}.wav`,leaseToken:worker,objectId:object,version:'version-1'};
 const deps={env:name=>name==='SUPABASE_URL'?'https://example.supabase.co':name==='SUPABASE_SERVICE_ROLE_KEY'?service:undefined,uuid:()=>worker,
 rpc:async(name,args,signal)=>{calls.push({name,args,signal});if(name==='validate_music_maintenance_worker')return true;if(name==='claim_music_upload_cleanup')return ++claims===1?job:null;if(name==='check_music_upload_cleanup')return'delete';if(name==='ack_music_upload_cleanup')return true;return null;},
 fetch:async(url,options)=>{calls.push({name:'fetch',url,options});return new Response('{}',{status:200});},...changes};
 return{run:factory(deps),calls,job,deps};
}
const request=(authorization=token,method='POST')=>new Request('https://example.supabase.co/functions/v1/music-maintenance',{method,headers:{Authorization:'Bearer '+authorization},...(method==='POST'?{body:'{}'}:{})});
test('scoped worker rejects app tokens, service credentials and wrong methods without database access',async()=>{
 for(const value of ['user-jwt',service,'']){const f=fixture();assert.equal((await f.run(request(value))).status,401);assert.equal(f.calls.length,0);}
 const f=fixture();assert.equal((await f.run(request(token,'GET'))).status,405);assert.equal(f.calls.length,0);
});
test('valid cleanup deletes only the database-issued object and acknowledges afterwards',async()=>{
 const f=fixture(),result=await f.run(request());assert.equal(result.status,200);assert.equal((await result.json()).processed,1);
 const names=f.calls.map(c=>c.name);assert.ok(names.indexOf('check_music_upload_cleanup')<names.indexOf('fetch'));assert.ok(names.indexOf('fetch')<names.indexOf('ack_music_upload_cleanup'));
 const sent=f.calls.find(c=>c.name==='fetch');assert.equal(sent.url,'https://example.supabase.co/storage/v1/object/music-audio');assert.deepEqual(JSON.parse(sent.options.body),{prefixes:[`${owner}/${id}.wav`]});assert.equal(sent.options.redirect,'error');
});
test('false Storage success cannot release quota and schedules retry',async()=>{
 const f=fixture();const original=f.deps.rpc;f.deps.rpc=async(...args)=>args[0]==='ack_music_upload_cleanup'?(f.calls.push({name:args[0]}),false):original(...args);
 const result=await f.run(request());assert.equal(result.status,503);assert.ok(f.calls.some(c=>c.name==='fail_music_upload_cleanup'));assert.equal((await result.json()).processed,0);
});
test('absent objects are acknowledged without another Storage deletion',async()=>{
 const f=fixture();const original=f.deps.rpc;f.deps.rpc=(...args)=>args[0]==='check_music_upload_cleanup'?Promise.resolve('absent'):original(...args);
 assert.equal((await f.run(request())).status,200);assert.equal(f.calls.some(c=>c.name==='fetch'),false);
});
test('another owner path, invalid identity and injected traversal never reach Storage',async()=>{
 for(const change of [{path:'another-owner/private.wav'},{path:`${owner}/../private.wav`},{id:'invalid'},{leaseToken:owner},{objectId:null,version:'not-null'}]){
  const f=fixture();Object.assign(f.job,change);assert.equal((await f.run(request())).status,503);assert.equal(f.calls.some(c=>c.name==='fetch'),false);
 }
});
test('invalid worker authentication and an unavailable lease cannot delete anything',async()=>{
 for(const stage of ['validate_music_maintenance_worker','check_music_upload_cleanup']){
  const f=fixture();const original=f.deps.rpc;f.deps.rpc=(...args)=>args[0]===stage?Promise.resolve(stage.startsWith('validate')?false:'denied'):original(...args);
  const result=await f.run(request());assert.equal(result.status,stage.startsWith('validate')?401:503);assert.equal(f.calls.some(c=>c.name==='fetch'),false);
 }
});
test('changed objects stay for review, and review-only work has a bounded batch',async()=>{
 const f=fixture({rpc:async(name)=>name==='validate_music_maintenance_worker'?true:name==='claim_music_upload_cleanup'?{review:true}:null});
 const result=await f.run(request());assert.equal(result.status,200);assert.equal((await result.json()).reviewed,10);assert.equal(f.calls.length,0);
});
test('Storage failure retains the lease record for retry without acknowledgement',async()=>{
 const f=fixture({fetch:async()=>new Response('{}',{status:503})});const result=await f.run(request());assert.equal(result.status,503);assert.ok(f.calls.some(c=>c.name==='fail_music_upload_cleanup'));assert.equal(f.calls.some(c=>c.name==='ack_music_upload_cleanup'),false);
});
test('worker deadline bounds an uncooperative RPC and aborts its signal',async()=>{
 let expire,signal,started=false;const factory=load((fn,ms)=>{assert.equal(ms,45000);expire=fn;return 1;});
 const f=fixture({rpc:async(_name,_args,s)=>{signal=s;started=true;return new Promise(()=>{});}},factory);const result=f.run(request());
 while(!started)await new Promise(resolve=>setImmediate(resolve));expire();const response=await result;assert.equal(response.status,503);assert.equal(signal.aborted,true);
});
test('storage deadline bounds an uncooperative fetch and cancellation body never blocks success',async()=>{
 let expire,started=false;const factory=load((fn,ms)=>{if(ms===10000)expire=fn;return 1;});
 const f=fixture({fetch:async()=>{started=true;return new Promise(()=>{});}},factory);const work=f.run(request());
 while(!started)await new Promise(resolve=>setImmediate(resolve));expire();assert.equal((await work).status,503);
 const cancel=fixture({fetch:async()=>({ok:true,status:200,body:{cancel:()=>new Promise(()=>{})}})});assert.equal((await cancel.run(request())).status,200);
});
test('catalogue cleanup uses its own lease RPCs and the validated provider path',async()=>{
 const path=`catalogue/fixture/${id}/${'a'.repeat(64)}.wav`,calls=[];let claims=0;
 const f=fixture({rpc:async(name,args)=>{calls.push({name,args});if(name==='validate_music_maintenance_worker')return true;if(name==='claim_music_upload_cleanup')return null;if(name==='claim_catalogue_upload_cleanup')return ++claims===1?{kind:'catalogue',id,providerId:'fixture',sha256:'a'.repeat(64),path,leaseToken:worker,objectId:object,version:'v1'}:null;if(name==='check_catalogue_upload_cleanup')return'delete';if(name==='ack_catalogue_upload_cleanup')return true;return null;}});
 assert.equal((await f.run(request())).status,200);assert.ok(calls.some(c=>c.name==='ack_catalogue_upload_cleanup'&&c.args.p_track===id));
 assert.deepEqual(JSON.parse(f.calls.find(c=>c.name==='fetch').options.body),{prefixes:[path]});
});
test('catalogue cleanup rejects provider traversal and cross-track path substitution',async()=>{
 const f=fixture({rpc:async(name)=>name==='validate_music_maintenance_worker'?true:name==='claim_music_upload_cleanup'?null:{kind:'catalogue',id,providerId:'../bad',sha256:'a'.repeat(64),path:'catalogue/another/path.wav',leaseToken:worker,objectId:object,version:'v1'}});
 assert.equal((await f.run(request())).status,503);assert.equal(f.calls.some(c=>c.name==='fetch'),false);
});
test('a parent deadline reached while checking a lease prevents a new Storage request',async()=>{
 let expire;const factory=load((fn,ms)=>{if(ms===45000)expire=fn;return 1;});const f=fixture({},factory),original=f.deps.rpc;
 f.deps.rpc=async(...args)=>{const result=await original(...args);if(args[0]==='check_music_upload_cleanup')expire();return result;};
 assert.equal((await f.run(request())).status,503);assert.equal(f.calls.some(c=>c.name==='fetch'),false);
});
test('a continuous original backlog cannot starve catalogue cleanup in the same bounded batch',async()=>{
 const counts={original:0,catalogue:0};const f=fixture({rpc:async(name)=>{
  if(name==='validate_music_maintenance_worker')return true;
  if(name==='claim_music_upload_cleanup'){counts.original++;return{id,ownerId:owner,path:`${owner}/${id}.wav`,leaseToken:worker,objectId:null,version:null};}
  if(name==='claim_catalogue_upload_cleanup'){counts.catalogue++;return{kind:'catalogue',id,providerId:'fixture',sha256:'a'.repeat(64),path:`catalogue/fixture/${id}/${'a'.repeat(64)}.wav`,leaseToken:worker,objectId:null,version:null};}
  if(name.startsWith('check_'))return'absent';if(name.startsWith('ack_'))return true;return null;
 }});const r=await f.run(request());assert.equal(r.status,200);assert.equal((await r.json()).processed,10);assert.deepEqual(counts,{original:5,catalogue:5});
});
