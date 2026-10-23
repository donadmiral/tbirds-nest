const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
const cache=new Map();function load(name){const p=path.resolve(__dirname,'../supabase/functions/creator-payouts',name+'.ts');if(cache.has(p))return cache.get(p).exports;const m={exports:{}};cache.set(p,m);const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('module','exports','require',js)(m,m.exports,n=>n.startsWith('./')?load(n.slice(2).replace(/\.ts$/,'')):require(n));return m.exports;}
const {createIntoBankSandboxProvider,parseReceipt}=load('provider');const {createPayoutHandler}=load('handler');
const I={id:'10000000-0000-4000-8000-000000000001',creator_id:'20000000-0000-4000-8000-000000000001',account_reference:'INTOBANK:123456789',provider_id:'intobank',currency:'USD',amount_minor:'12345',environment:'test',status:'requested',provider_reference:null,dispatch_started:false};
const P='30000000-0000-4000-8000-000000000001';
function receipt(){return {success:true,found:true,contract_version:'crisp-payout-v1',environment:'test',simulation:true,instruction_id:P,partner_reference:I.id,direction:'outbound',currency:'USD',amount_minor:'12345',fee_minor:'0',beneficiary:{account_number:'123456789',institution:{code:'INTOBANK'}},status:'settled',settlement_model:'same_bank',credit:{confirmed:true},finality:{recipient_credited:true,confirmed_not_sent:false}};}
test('adapter refuses live mode, live keys and non-HTTPS endpoints before sending',()=>{
  for(const options of [{environment:'live'},{key:'ck_live_real'},{url:'http://bank.test/api'}])assert.throws(()=>createIntoBankSandboxProvider({url:'https://bank.test/api',key:'ck_test_123',environment:'test',fetcher:()=>{throw Error('network should not run')},...options}),/NOT_READY/);
});
test('canonical receipt binds environment, exact decimal amount, destination and payout reference',()=>{
  assert.equal(parseReceipt(I,receipt()).status,'completed');
  for(const patch of [{environment:'live'},{amount_minor:'12344'},{partner_reference:'other'},{simulation:false},{instruction_id:'bad'},{currency:'EUR'},{direction:'inbound'},{finality:{recipient_credited:true,confirmed_not_sent:true}},{beneficiary:{account_number:'99999999',institution:{code:'INTOBANK'}}},{settlement_model:'prefunded'}])assert.throws(()=>parseReceipt(I,{...receipt(),...patch}));
  assert.throws(()=>parseReceipt({...I,provider_reference:'other'},receipt()));
});
test('bank acceptance and settlement without credit never become paid or not sent',()=>{
  for(const status of ['accepted','confirmed','settled','unknown','returned','rejected']){
    const r=receipt();r.status=status;r.credit={confirmed:false};r.finality={recipient_credited:false,confirmed_not_sent:false};
    assert.ok(['submitted','unknown'].includes(parseReceipt(I,r).status));
  }
  const r=receipt();r.status='rejected';r.finality={recipient_credited:false,confirmed_not_sent:true};assert.equal(parseReceipt(I,r).status,'rejected');
});
test('POST sends decimal text and original idempotency reference; GET never resubmits funds',async()=>{
  const calls=[];const p=createIntoBankSandboxProvider({url:'https://bank.test/api',key:'ck_test_x',environment:'test',fetcher:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(receipt()));}});
  await p.submit(I,AbortSignal.timeout(1000));const body=JSON.parse(calls[0].init.body);assert.equal(body.amount,'123.45');assert.equal(body.partner_reference,I.id);assert.equal(body.account_number,'123456789');assert.equal(calls[0].init.redirect,'error');
  await p.reconcile({...I,provider_reference:P},AbortSignal.timeout(1000));assert.equal(calls[1].init.method,'GET');assert.equal(new URL(calls[1].url).searchParams.get('partner_reference'),I.id);assert.equal(new URL(calls[1].url).searchParams.get('id'),P);
});
const secret='synthetic-service-key-for-test-only-123456789';const req=()=>new Request('https://edge.test/creator-payouts',{method:'POST',headers:{Authorization:'Bearer '+secret}});
function deps(rows,fetcher){const calls=[];return {calls,serviceKey:secret,crispUrl:'https://bank.test/api',crispKey:'ck_test_x',environment:'test',fetcher,db:{rpc:async(name,args)=>{calls.push([name,args]);return {error:null,data:name==='creator_claim_payouts'?rows:name==='creator_begin_payout_dispatch'?true:args.p_outcome?.status||'unknown'};}}};}
test('worker authorizes service caller before DB access and remains disabled by default',async()=>{
  const d=deps([],async()=>{throw Error('no')});const h=createPayoutHandler(d);assert.equal((await h(new Request('https://edge.test/x',{method:'POST'}))).status,401);assert.equal(d.calls.length,0);
  assert.equal((await createPayoutHandler({...d,environment:'disabled'})(req())).status,503);assert.equal(d.calls.length,0);
});
test('dispatch marker commits before POST and a timeout records uncertainty, never rejection',async()=>{
  let d;d=deps([I],async()=>{assert.equal(d.calls.at(-1)[0],'creator_begin_payout_dispatch');throw Error('timeout')});
  const res=await createPayoutHandler(d)(req());assert.equal(res.status,503);const finish=d.calls.at(-1);assert.equal(finish[0],'creator_finish_payout_attempt');assert.equal(finish[1].p_outcome,null);assert.equal(finish[1].p_error,'PAYOUT_PROVIDER_UNCONFIRMED');
});
test('expired dispatch recovers with GET only, then persists verified finality',async()=>{
  const methods=[];const d=deps([{...I,dispatch_started:true,status:'unknown'}],async(_,options)=>{methods.push(options.method);return new Response(JSON.stringify(receipt()))});
  const res=await createPayoutHandler(d)(req());assert.equal(res.status,200);assert.deepEqual(methods,['GET']);assert.ok(!d.calls.some(c=>c[0]==='creator_begin_payout_dispatch'));assert.equal(d.calls.at(-1)[1].p_outcome.status,'completed');
});
test('missing canonical receipt leaves funds pending without a new POST',async()=>{
  const methods=[];const d=deps([{...I,dispatch_started:true}],async(_,options)=>{methods.push(options.method);return new Response(JSON.stringify({success:true,found:false,contract_version:'crisp-payout-v1',environment:'test'}))});
  const res=await createPayoutHandler(d)(req());assert.equal(res.status,503);assert.deepEqual(methods,['GET']);assert.equal(d.calls.at(-1)[1].p_outcome,null);
});
