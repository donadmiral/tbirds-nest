const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,extra={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports,Response,Request,AbortSignal,AbortController,setTimeout,clearTimeout,fetch,...extra});
  return exports;
}
const make=load('supabase/functions/account-storage-erasure/handler.ts').createAccountStorageErasure;
const client=load('shared/accountErasure.ts');
const worker='10000000-0000-4000-8000-000000000001',job='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001',object='40000000-0000-4000-8000-000000000001';
const scoped='pc_erase_'+'f'.repeat(64);
const request=(token=scoped)=>new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({userId:'ignored-attacker-input'})});
function harness(options={}) {
  const calls=[],http=[];
  const queued={id:job,userId:user,leaseToken:worker,state:'erasing',objects:[{id:object,bucket:'post-media',path:`${user}/image.jpg`,version:'recorded-version'}],...options.job};
  const handler=make({uuid:()=>worker,env:name=>({SUPABASE_URL:'https://qa.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-secret'})[name],
    client:()=>({rpc:async(name,args)=>{
      calls.push({name,args});
      if(options.rpcFailure===name)return{error:new Error('offline'),data:null};
      const values={validate_account_erasure_worker:options.authorized!==false,claim_account_erasure:options.empty?null:queued,
        check_account_erasure_object:options.check||'delete',ack_account_erasure_object:options.ack!==false,
        prepare_account_erasure_identity:options.ready||'ready',finish_account_erasure:options.finish!==false};
      return {error:null,data:values[name]};
    }}),fetch:async(url,init)=>{
      http.push({url,init});
      if(options.networkFailure)throw new Error('offline');
      const status=url.includes('/storage/')?(options.storageStatus||200):(options.identityStatus||200);
      return new Response('{}',{status});
    }});
  return{handler,calls,http};
}
test('worker requires scoped credentials and ignores caller-supplied account IDs',async()=>{
  for(const token of ['service-secret','some-app-jwt','',scoped.slice(0,-1)]) {
    const h=harness(); assert.equal((await h.handler(request(token))).status,401);assert.equal(h.calls.length,0);assert.equal(h.http.length,0);
  }
  const denied=harness({authorized:false});assert.equal((await denied.handler(request())).status,401);assert.equal(denied.http.length,0);
});
test('Storage API removal precedes metadata acknowledgement, application cleanup and Auth API removal',async()=>{
  const h=harness();const result=await h.handler(request());
  assert.equal(result.status,200);assert.equal((await result.json()).completed,true);
  assert.equal(h.http.length,2);
  assert.equal(h.http[0].url,'https://qa.supabase.co/storage/v1/object/post-media');
  assert.equal(h.http[0].init.method,'DELETE');assert.equal(h.http[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(h.http[0].init.body),{prefixes:[`${user}/image.jpg`]});
  assert.equal(h.http[1].url,`https://qa.supabase.co/auth/v1/admin/users/${user}`);
  const names=h.calls.map(call=>call.name);
  assert.ok(names.indexOf('check_account_erasure_object')<names.indexOf('ack_account_erasure_object'));
  assert.ok(names.indexOf('ack_account_erasure_object')<names.indexOf('prepare_account_erasure_identity'));
  assert.equal(h.calls.at(-1).args.p_error,null);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
});
test('unsafe, unleased or oversized queue results cannot delete objects or accounts',async()=>{
  for(const changed of [
    {userId:'not-a-uuid'}, {leaseToken:'other-worker'},
    {objects:[{id:object,bucket:'post-media',path:'../escape',version:'one'}]},
    {objects:[{id:object,bucket:'unreviewed',path:`${user}/one.jpg`,version:'one'}]},
    {objects:Array.from({length:26},()=>({id:object,bucket:'post-media',path:`${user}/one.jpg`,version:'one'}))},
  ]) {const h=harness({job:changed});assert.equal((await h.handler(request())).status,503);assert.equal(h.http.length,0);}
});
test('Storage errors, stale leases and unacknowledged deletes never advance to Auth deletion',async()=>{
  for(const options of [{storageStatus:500},{storageStatus:403},{networkFailure:true},{ack:false},{check:'stale'},{check:'changed'}]) {
    const h=harness(options),result=await h.handler(request());
    assert.equal((await result.json()).completed,false);
    assert.equal(h.http.some(item=>item.url.includes('/auth/')),false);
    assert.equal(h.calls.some(item=>item.name==='prepare_account_erasure_identity'),false);
  }
});
test('a crash after file removal resumes without deleting the same file again',async()=>{
  const h=harness({check:'absent',identityStatus:404});
  assert.equal((await (await h.handler(request())).json()).completed,true);
  assert.equal(h.http.length,1);assert.ok(h.http[0].url.includes('/auth/'));
});
test('more batches and review outcomes do not delete the identity prematurely',async()=>{
  for(const ready of ['more','cache_wait','review','stale']) {
    const h=harness({ready});const result=await (await h.handler(request())).json();
    assert.equal(result.completed,false);assert.equal(h.http.some(item=>item.url.includes('/auth/')),false);
  }
});
test('Auth failures remain pending and final acknowledgement must verify completion',async()=>{
  const pending=harness({identityStatus:500});assert.equal((await (await pending.handler(request())).json()).completed,false);
  assert.equal(pending.calls.at(-1).args.p_error,'identity_unavailable');
  const uncertain=harness({finish:false});const response=await uncertain.handler(request());
  assert.equal(response.status,503);assert.equal((await response.json()).completed,false);
});
const receipt={requestId:job,userId:user,token:'a'.repeat(64),createdAt:new Date().toISOString()};
const result=overrides=>({requestId:job,state:'queued',reason:null,requestedAt:receipt.createdAt,updatedAt:receipt.createdAt,completedAt:null,filesTotal:1,filesErased:0,...overrides});
test('client status validates the exact receipt and never treats malformed or partial data as completion',()=>{
  assert.ok(client.parseErasureReceipt(JSON.stringify(receipt)));
  assert.equal(client.parseErasureReceipt(JSON.stringify({...receipt,token:'short'})),null);
  for(const bad of [result({requestId:user}),result({state:'completed'}),result({filesErased:2}),{ok:true}]) {
    assert.throws(()=>client.parseErasureStatus(bad,job),/could not be verified/);
  }
  assert.equal(client.parseErasureStatus(null,job),null);
  assert.match(client.erasureMessage(result({state:'retention_review',reason:'financial_records'})).detail,/not been marked complete/);
});
test('a lost request response recovers using the same receipt anonymously after session revocation',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/request_account_erasure'))throw new Error('Connection interrupted');
    return new Response(JSON.stringify(result()));
  };
  const status=await client.sendAccountErasure('https://qa.supabase.co','anon-key','captured-user-jwt',receipt,fetcher);
  assert.equal(status.state,'queued');assert.equal(calls.length,2);
  assert.equal(calls[0].init.headers.Authorization,'Bearer captured-user-jwt');
  assert.equal(calls[1].init.headers.Authorization,'Bearer anon-key');
  assert.deepEqual(JSON.parse(calls[0].init.body),JSON.parse(calls[1].init.body));
  assert.equal(calls.some(call=>call.url.includes(receipt.token)),false,'capability must never appear in request URLs');
});
test('unconfirmed requests preserve their error and do not fall back to the old destructive RPC',async()=>{
  const calls=[];const fetcher=async(url)=>{
    calls.push(url);return url.endsWith('/request_account_erasure')
      ?new Response(JSON.stringify({message:'ACCOUNT_ERASURE_TEMPORARILY_UNAVAILABLE'}),{status:503})
      :new Response('null');
  };
  await assert.rejects(client.sendAccountErasure('https://qa.supabase.co','anon-key','jwt',receipt,fetcher),/temporarily unavailable/);
  assert.equal(calls.some(url=>url.includes('delete_user_account')),false);
});
