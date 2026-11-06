const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), { webcrypto } = require('node:crypto');
function load(file) {
  const absolute = path.resolve(__dirname, '../functions', file), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => load(path.relative(path.join(__dirname, '../functions'), path.resolve(path.dirname(absolute), name))),
      Request, Response, Headers, URL, AbortSignal, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Date, crypto: webcrypto, atob, btoa });
  return module.exports;
}
const { createTranscriptionWorkerHandler } = load('live-transcription-worker/handler.ts');
const id = '11111111-1111-4111-8111-111111111111', lease = '22222222-2222-4222-8222-222222222222', secret = 'synthetic-worker-secret-not-a-user-session';
const request = (body, bearer = secret) => new Request('https://local.invalid', { method: 'POST', headers: { Authorization: 'Bearer ' + bearer }, body: JSON.stringify(body) });
function setup(revoked = false) {
  const calls = []; let signs = 0;
  const handler = createTranscriptionWorkerHandler({ secret, base: 'https://local.invalid',
    rpc: async (name, args) => { calls.push({ name, ...args }); return { data: args.p_action === 'check' ? { ok: !revoked, id, clip_id: id, duration_ms: 30000, language: 'en-US', job_name: 'pc-live-caption-' + id.replaceAll('-', '') } : { ok: true }, error: null }; },
    sign: async () => { signs++; throw Error('No media grant belongs in a reservation operation'); } });
  return { handler, calls, signs: () => signs };
}
test('new reservation and cleanup operations never authenticate an ordinary user JWT', async () => {
  for (const action of ['submit', 'settle', 'cleanup_defer']) {
    const h = setup(); const response = await h.handler(request({ action, id, lease_id: lease, provider_status: 'COMPLETED', configuration_hash: 'a'.repeat(64) }, 'ordinary-user-jwt'));
    assert.equal(response.status, 401); assert.equal(h.calls.length, 0); assert.equal(h.signs(), 0);
  }
});
test('submit checks current source authority before reserving the exact configuration hash', async () => {
  const h = setup(); assert.equal((await h.handler(request({ action: 'submit', id, lease_id: lease, configuration_hash: 'a'.repeat(64) }))).status, 200);
  assert.deepEqual(h.calls.map(call => call.p_action), ['check', 'submit']); assert.equal(h.calls[1].p_payload.configuration_hash, 'a'.repeat(64)); assert.equal(h.signs(), 0);
  const denied = setup(true); assert.equal((await denied.handler(request({ action: 'submit', id, lease_id: lease, configuration_hash: 'a'.repeat(64) }))).status, 409);
  assert.deepEqual(denied.calls.map(call => call.p_action), ['check']);
});
test('cleanup is a separate authenticated lease operation and never invokes source signing', async () => {
  for (const action of ['settle', 'cleanup_defer']) {
    const h = setup(true); assert.equal((await h.handler(request({ action, id, lease_id: lease, provider_status: 'FAILED' }))).status, 200);
    assert.deepEqual(h.calls.map(call => call.p_action), [action]); assert.equal(h.calls[0].p_id, id); assert.equal(h.calls[0].p_lease_id, lease); assert.equal(h.signs(), 0);
  }
});
test('settlement accepts only fixed terminal outcomes, no arbitrary URLs or provider actions', async () => {
  for (const body of [{ action: 'settle', id, lease_id: lease, provider_status: 'IN_PROGRESS' },
    { action: 'settle', id, lease_id: lease, provider_status: 'COMPLETED', url: 'https://attacker.invalid' },
    { action: 'delete-provider', id, lease_id: lease }]) {
    const h = setup(); assert.equal((await h.handler(request(body))).status, 400); assert.equal(h.calls.length, 0); assert.equal(h.signs(), 0);
  }
});
test('queue-only secret returns just readiness booleans and count, with no work or media authority', async () => {
 const peekSecret='synthetic-dedicated-queue-secret-not-worker',calls=[];
 const handler=createTranscriptionWorkerHandler({secret,peekSecret,base:'https://local.invalid',rpc:async(name,args)=>{calls.push(args);return{data:{enabled:true,due:true,active:1,actor_id:id,url:'https://must-never-leak.invalid',secret:'not returned'},error:null};},sign:async()=>{throw Error('must not sign');}});
 const response=await handler(request({action:'peek'},peekSecret));assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{enabled:true,due:true,active:1});assert.deepEqual(calls.map(x=>x.p_action),['peek']);
 for(const action of ['claim','source','submit','settle','cleanup_defer','finish'])assert.equal((await handler(request({action,id,lease_id:lease},peekSecret))).status,403);
 assert.equal((await handler(request({action:'peek',id},peekSecret))).status,403);assert.equal(calls.length,1);
 assert.equal((await handler(request({action:'peek'},secret))).status,400);assert.equal(calls.length,1);
});
test('queue readiness fails closed for a missing/reused secret, invalid aggregate or unauthenticated caller', async () => {
 for(const peekSecret of ['',secret]){
  let calls=0;const handler=createTranscriptionWorkerHandler({secret,peekSecret,base:'https://local.invalid',rpc:async()=>{calls++;return{data:{},error:null};},sign:async()=>null});
  assert.notEqual((await handler(request({action:'peek'},peekSecret||'invalid'))).status,200);assert.equal(calls,0);
 }
 const peekSecret='synthetic-separate-queue-only-secret';
 for(const data of [{enabled:true,due:true,active:3},{enabled:true,due:'true',active:0},{enabled:true,due:true,active:0.5}]){
  const handler=createTranscriptionWorkerHandler({secret,peekSecret,base:'https://local.invalid',rpc:async()=>({data,error:null}),sign:async()=>null});
  const response=await handler(request({action:'peek'},peekSecret));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'DATABASE_UNAVAILABLE'});
 }
});
