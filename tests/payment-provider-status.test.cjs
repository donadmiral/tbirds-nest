const {test}=require('node:test');
const assert=require('node:assert/strict');
const {providerIssue,bridgeConnectionStatus}=require('../shared/payments/providerStatus.ts');

test('only allowlisted diagnostics and scopes reach operator or customer messages',()=>{
  const issue=providerIssue({error:'KEY_PERMISSION_DENIED',capability:'links',detail:'private-secret'});
  assert.match(issue.operatorMessage,/account linking/);
  assert.match(issue.operatorMessage,/does not approve a bank funding source/);
  assert.doesNotMatch(JSON.stringify(issue),/private-secret/);
  for(const value of [null,{},'private-secret','BANK_PAYMENT_REQUIRED:private-secret',{error:'KEY_PERMISSION_DENIED:links:private-secret'}])assert.equal(providerIssue(value),null);
  for(const capability of ['private-secret','constructor','__proto__']){
    const safe=providerIssue({error:'KEY_PERMISSION_DENIED',capability});
    assert.match(safe.operatorMessage,/this operation/);
    assert.doesNotMatch(safe.operatorMessage,/private-secret|constructor|__proto__/);
  }
  assert.match(providerIssue('KEY_PERMISSION_DENIED:payouts').operatorMessage,/payouts/);
});

const now=Date.parse('2026-10-23T20:00:00Z');
function run(patch={}){return {created_at:'2026-10-23T19:55:00Z',steps:[{name:'payments_bridge',ok:true,detail:'linked true'}],...patch};}
test('successful connection checks do not assert environment, scopes or live settlement',()=>{
  const result=bridgeConnectionStatus(run(),now);
  assert.equal(result.state,'passed');
  assert.match(result.detail,/does not verify the key environment/);
  assert.match(result.detail,/live settlement/);
  assert.equal(bridgeConnectionStatus(run({created_at:'2026-10-23T19:00:00Z'}),now).state,'stale');
});
test('missing, malformed and future checks never become healthy; failures hide raw payloads',()=>{
  for(const value of [null,{},run({created_at:'invalid'}),run({created_at:'2026-10-24T20:00:00Z'}),run({steps:[]}),run({steps:[{name:'payments_bridge',ok:'true'}]})])assert.equal(bridgeConnectionStatus(value,now).state,'unknown');
  const failed=bridgeConnectionStatus(run({steps:[{name:'payments_bridge',ok:false,detail:'status 403: KEY_PERMISSION_DENIED'}]}),now);
  assert.equal(failed.state,'failed');assert.match(failed.detail,/provider key/);
  const unknown=bridgeConnectionStatus(run({steps:[{name:'payments_bridge',ok:false,detail:'private-secret'}]}),now);
  assert.equal(unknown.state,'failed');assert.doesNotMatch(JSON.stringify(unknown),/private-secret/);
  const missing=bridgeConnectionStatus(run({steps:[{name:'payments_bridge',ok:false,detail:'CRISP_NOT_CONFIGURED: private-secret'}]}),now);
  assert.match(missing.detail,/server-side secrets/);assert.doesNotMatch(missing.detail,/private-secret/);
});
