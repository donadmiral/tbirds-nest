const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/export-my-data/handler.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const context = { exports: {}, Response, Request, AbortController, TextEncoder, setTimeout, clearTimeout };
vm.runInNewContext(source, context);
const { createExportHandler, EXPORT_COLLECTIONS } = context.exports;
const uid = 'user-a';
function archive() {
  return { schema_version:2, export_status:'complete', account:{id:uid}, profile:{id:uid},
    exported_at:'2026-10-22T12:00:00Z', records_through:'2026-10-22T12:00:00Z',
    ...Object.fromEntries(EXPORT_COLLECTIONS.map(name => [name, []])),
    collection_counts:Object.fromEntries(EXPORT_COLLECTIONS.map(name => [name, 0])) };
}
function setup(options={}) {
  const calls=[];
  const handler=createExportHandler({
    authenticate:async (authorization,signal)=>{calls.push(['auth',authorization,signal]);return {id:uid};},
    snapshot:async (authorization,signal)=>{calls.push(['snapshot',authorization,signal]);return {data:archive(),error:null};},
    ...options,
  });
  const request=(method='POST',authorization='Bearer original-token')=>new Request('https://local.test/export',{method,headers:{authorization}});
  return {handler,request,calls};
}
test('one complete snapshot uses the original caller token and shared deadline',async()=>{
  const h=setup();const r=await h.handler(h.request());const b=await r.json();
  assert.equal(r.status,200);assert.equal(b.export_status,'complete');assert.equal(b.account.id,uid);
  assert.deepEqual(h.calls.map(c=>c.slice(0,2)),[['auth','Bearer original-token'],['snapshot','Bearer original-token']]);
  assert.equal(h.calls[0][2],h.calls[1][2]);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('archive larger than the old 5000 limit preserves every returned record',async()=>{
  const data=archive();data.posts=Array.from({length:5001},(_,i)=>({id:i,created_at:null}));data.collection_counts.posts=5001;
  const h=setup({snapshot:async()=>({data,error:null})});const b=await(await h.handler(h.request())).json();
  assert.equal(b.posts.length,5001);assert.equal(b.posts[5000].created_at,null);
});
test('wrong account, wrong profile, truncated collection and missing collection are rejected',async()=>{
  for(const change of [d=>{d.account.id='other';},d=>{d.profile.id='other';},d=>{d.collection_counts.posts=1;},d=>{delete d.messages_sent;},d=>{d.collection_counts.unexpected=0;}]){
    const data=archive();change(data);const h=setup({snapshot:async()=>({data,error:null})});const r=await h.handler(h.request());
    assert.equal(r.status,503);const b=await r.json();assert.equal(b.code,'EXPORT_INCOMPLETE');assert.equal(b.posts,undefined);
  }
});
test('row and byte limits refuse a partial archive',async()=>{
  const large=archive();large.posts=Array.from({length:50001},(_,i)=>({id:i}));large.collection_counts.posts=50001;
  const row=setup({snapshot:async()=>({data:large,error:null})});assert.equal((await row.handler(row.request())).status,503);
  const size=setup({maxBytes:1});const r=await size.handler(size.request());assert.equal(r.status,413);assert.equal((await r.json()).posts,undefined);
});
test('database errors hide private details, oversized archives and expired users have explicit status',async()=>{
  for(const [error,status,code] of [[{message:'secret connection detail'},503,'EXPORT_READ_FAILED'],[{message:'EXPORT_TOO_LARGE',code:'54000'},413,'EXPORT_TOO_LARGE'],[{message:'ACCOUNT_NOT_FOUND',code:'28000'},401,'AUTH_REQUIRED']]){
    const h=setup({snapshot:async()=>({data:archive(),error})});const r=await h.handler(h.request());const b=await r.json();
    assert.equal(r.status,status);assert.equal(b.code,code);assert.equal(b.posts,undefined);assert.doesNotMatch(JSON.stringify(b),/secret connection/);
  }
});
test('authentication, method and preflight checks precede private snapshot reads',async()=>{
  const h=setup();assert.equal((await h.handler(h.request('GET'))).status,405);assert.equal((await h.handler(h.request('OPTIONS'))).status,200);
  assert.equal((await h.handler(h.request('POST',''))).status,401);assert.equal(h.calls.length,0);
  const denied=setup({authenticate:async()=>null});assert.equal((await denied.handler(denied.request())).status,401);assert.equal(denied.calls.length,0);
});
test('hung authentication and hung database requests terminate without partial data',async()=>{
  for(const step of ['authenticate','snapshot']){
    let signal;const h=setup({timeoutMs:10,[step]:async(_authorization,received)=>{signal=received;return new Promise(()=>{});}});
    const r=await h.handler(h.request());assert.equal(r.status,503);assert.equal(signal.aborted,true);
    assert.equal((await r.json()).code,'EXPORT_UNAVAILABLE');
  }
});
