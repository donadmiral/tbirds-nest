const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  const file=path.resolve(__dirname,'../shared/monetization',name+'.ts');
  if(cache.has(file)) return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('module','exports','require',code)(module,module.exports,x=>x.startsWith('./')?load(x.slice(2)):require(x));
  return module.exports;
}
const domain=load('domain'), provider=load('provider'), client=load('client');
function snapshot() { return {user_id:'owner-a',as_of:'2026-10-20T12:00:00Z',program:{enrollment_open:false,terms_version:null,terms_url:null},provider:{id:'intobank',name:'IntoBank',payouts_enabled:false,currencies:[]},enrollment:{status:'interested',reason:null},payout_account:{status:'not_configured',verified_at:null},balances:[],recent_earnings:[],recent_payouts:[]}; }
test('USD parses exact decimal strings without floating-point rounding',()=>{
  assert.equal(domain.usdToMinor('90071992547409.93'),'9007199254740993');
  assert.equal(domain.usdToMinor('0.01'),'1');
  assert.equal(domain.formatMinor('9007199254740993','USD'),'USD 90,071,992,547,409.93');
  for(const input of ['-1','0','1.001','1e4','NaN','01.20','1,000','999999999999999999']) assert.throws(()=>domain.usdToMinor(input));
});
test('unknown currency is never silently given USD decimal units',()=>{
  assert.equal(domain.formatMinor('100','JPY'),'100 minor units (JPY)');
});
test('wrong-account, malformed balances and duplicate summaries cannot reach the UI',()=>{
  assert.throws(()=>domain.parseCreatorSnapshot(snapshot(),'other'));
  for(const amount of [0,1.1,'NaN','-1','1.1','9223372036854775808']) { const s=snapshot();s.balances=[{currency:'USD',bucket:'available',amount_minor:amount}];assert.throws(()=>domain.parseCreatorSnapshot(s,'owner-a')); }
  const s=snapshot();s.balances=[{currency:'USD',bucket:'available',amount_minor:'1'},{currency:'USD',bucket:'available',amount_minor:'1'}];assert.throws(()=>domain.parseCreatorSnapshot(s,'owner-a'));
});
test('inconsistent program and payout readiness is rejected before display',()=>{
  for (const terms of [null, 'https://', 'javascript:alert(1)', 'https://name:password@example.test/terms']) {
    const s=snapshot();s.program={enrollment_open:true,terms_version:'v1',terms_url:terms};
    assert.throws(()=>domain.parseCreatorSnapshot(s,'owner-a'));
  }
  const missingVersion=snapshot();missingVersion.program={enrollment_open:true,terms_version:' ',terms_url:'https://example.test/terms'};
  assert.throws(()=>domain.parseCreatorSnapshot(missingVersion,'owner-a'));
  const unverified=snapshot();unverified.payout_account.status='ready';
  assert.throws(()=>domain.parseCreatorSnapshot(unverified,'owner-a'));
  const s=snapshot();s.program={enrollment_open:true,terms_version:'v1',terms_url:'https://example.test/terms'};
  assert.equal(domain.parseCreatorSnapshot(s,'owner-a').program.enrollment_open,true);
});
test('zero-value or malformed recorded money movements are not rendered as financial activity',()=>{
  for (const amount of ['0',0,'NaN']) {
    const s=snapshot();s.recent_earnings=[{id:'entry',created_at:s.as_of,currency:'USD',amount_minor:amount,from:'funding',to:'pending'}];
    assert.throws(()=>domain.parseCreatorSnapshot(s,'owner-a'));
    s.recent_earnings=[];s.recent_payouts=[{id:'payout',created_at:s.as_of,currency:'USD',amount_minor:amount,status:'completed',provider_id:'intobank',provider_reference:'receipt'}];
    assert.throws(()=>domain.parseCreatorSnapshot(s,'owner-a'));
  }
});
test('unavailable service is not presented as an empty earnings account',async()=>{
  await assert.rejects(()=>client.readCreatorSnapshot({rpc:async()=>({data:null,error:{code:'PGRST202'}})},'owner-a'),/not available/);
  assert.deepEqual((await client.readCreatorSnapshot({rpc:async()=>({data:snapshot(),error:null})},'owner-a')).balances,[]);
});
test('mutations send the expected user and reject empty or failed responses',async()=>{
  const calls=[];const rpc=async(name,args)=>{calls.push([name,args]);return {data:'interested',error:null}};
  await client.registerCreatorInterest({rpc},'owner-a');assert.deepEqual(calls[0],['creator_register_interest',{p_expected_user:'owner-a'}]);
  await assert.rejects(()=>client.registerCreatorInterest({rpc:async()=>({data:null,error:null})},'owner-a'),/not confirmed/);
  await assert.rejects(()=>client.applyToCreatorProgram({rpc:async()=>({data:'approved',error:{message:'fail'}})},'owner-a','v1'),/not confirmed/);
});
test('IntoBank is primary and unsupported creator payout calls fail before any network activity',async()=>{
  const p=provider.creatorPayoutProvider();assert.equal(p.id,'intobank');assert.equal(p.supportsPayouts,false);
  const instruction={id:'payout-1',creatorId:'a',providerId:'intobank',accountReference:'account-a',currency:'USD',amountMinor:'100'};
  await assert.rejects(()=>p.submit(instruction),e=>e.code==='PAYOUT_PROVIDER_NOT_READY');
  await assert.rejects(()=>p.reconcile(instruction),e=>e.code==='PAYOUT_PROVIDER_NOT_READY');
  assert.throws(()=>provider.creatorPayoutProvider('unapproved-fallback'),/Unsupported/);
});
test('a link or approved creator alone never enables payouts',()=>{
  const s=snapshot();s.enrollment.status='approved';s.payout_account.status='ready';assert.match(domain.payoutBlockReason(s),/not available/);
  s.provider.payouts_enabled=true;assert.match(domain.payoutBlockReason(s),/USD/);
});
test('canonical receipts must bind exact payout, recipient, currency, amount and provider',()=>{
  const i={id:'payout-1',creatorId:'a',providerId:'intobank',accountReference:'account-a',currency:'USD',amountMinor:'100'};
  const o={eventId:'event-1',reference:'ref-1',payoutId:i.id,accountReference:i.accountReference,providerId:i.providerId,currency:i.currency,amountMinor:i.amountMinor,status:'completed'};
  assert.doesNotThrow(()=>provider.assertMatchingOutcome(i,o));
  for(const key of ['payoutId','accountReference','providerId','currency','amountMinor','status']) assert.throws(()=>provider.assertMatchingOutcome(i,{...o,[key]:'wrong'}),/PAYOUT_RECEIPT_MISMATCH/);
});
test('a stalled operation stops blocking the UI without claiming the server cancelled it',async()=>{
  let resolve;
  const pending=new Promise(r=>{resolve=r});
  await assert.rejects(()=>client.withFinanceDeadline(pending,'Not confirmed. Refresh before retrying.',1),/Not confirmed/);
  resolve({data:'interested',error:null});
  assert.deepEqual(await pending,{data:'interested',error:null});
});
