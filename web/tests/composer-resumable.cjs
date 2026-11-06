const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const exportsUnderTest = {};
const source = fs.readFileSync(path.resolve(__dirname, '../lib/composerResumable.ts'),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports:exportsUnderTest, crypto:require('node:crypto').webcrypto, URL, fetch, btoa, TextEncoder, AbortSignal,
});
const {createComposerUpload,COMPOSER_CHUNK_BYTES:CHUNK,matchesUpload} = exportsUnderTest;
const base = 'https://abcdefghijklmnopqrst.supabase.co';
const endpoint = 'https://abcdefghijklmnopqrst.storage.supabase.co/storage/v1/upload/resumable';
const pathName = 'alice/fixed_0.mp4';
const reply = (status,headers={}) => new Response(null,{status,headers});
function fixture(options={}) {
  const size = CHUNK + 13;
  const file = new File([new Uint8Array(size)],'movie.mp4',{type:'video/mp4'});
  let pos=0, owner='alice', access='a', nonce, confirmed = false;
  const log=[];
  async function transport(url,init) {
    const r={method:init.method,url:url.href,size:init.body?.size,...init.headers}; log.push(r);
    assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit'); assert.equal(r['x-upsert'],'false');
    if (options.request) {
      const result = await options.request(r,{get pos(){return pos;},set pos(v){pos=v;},get confirmed(){return confirmed;},set confirmed(v){confirmed=v;},switchOwner(){owner='bob';}});
      if(result) return result;
    }
    if(r.method === 'POST'){
      const meta=Object.fromEntries(r['Upload-Metadata'].split(',').map(x=>{const [k,v]=x.split(' ');return [k,Buffer.from(v,'base64').toString('utf8')];}));
      assert.equal(meta.bucketName,'post-media'); assert.equal(meta.objectName,pathName);
      assert.equal(meta.contentType,'video/mp4');nonce=JSON.parse(meta.metadata).uploadNonce;
      assert.equal(r['Upload-Length'],String(size));
      return reply(201,{Location:endpoint+'/opaque'});
    }
    assert.equal(r.url,endpoint+'/opaque');
    if(r.method === 'HEAD')return reply(200,{'Upload-Length':String(size),'Upload-Offset':String(pos)});
    assert.equal(r['Upload-Offset'],String(pos));assert.equal(r['Content-Type'],'application/offset+octet-stream');
    pos+=r.size;if(pos===size)confirmed=true;
    return reply(204,{'Upload-Offset':String(pos)});
  }
  const run=createComposerUpload({projectUrl:base,anonKey:'test-key',owner:'alice',path:pathName,file,transport,
    token:async refresh=>{if(owner!=='alice')throw Error('account changed');if(refresh)access='b';return access;},
    confirm:async n=>matchesUpload(confirmed?{name:pathName,size,metadata:{uploadNonce:nonce}}:null,pathName,size,n)});
  return {run,log,size};
}
test('creates a no-overwrite owner-scoped upload, sends bounded chunks, reuses confirmation', async()=>{
  const f=fixture();await f.run();await f.run();
  assert.deepEqual(f.log.map(x=>x.method),['POST','PATCH','PATCH']);
  assert.equal(f.log[0].url,endpoint);assert.deepEqual(f.log.slice(1).map(x=>x.size),[CHUNK,13]);
});
test('lost acknowledgement of a committed chunk resumes at the server offset',async()=>{
  let dropped=false;
  const f=fixture({request:(r,state)=>{if(r.method==='PATCH'&&!dropped){dropped=true;state.pos=r.size;throw Error('offline');}}});
  await assert.rejects(f.run(),/offline/);await f.run();
  assert.deepEqual(f.log.map(x=>x.method),['POST','PATCH','HEAD','PATCH']);
  assert.equal(f.log.at(-1)['Upload-Offset'],String(CHUNK));
});
test('a lost final response uses matching immutable object metadata without a second upload',async()=>{
  const f=fixture({request:(r,state)=>{if(r.method==='PATCH'&&r.size===13){state.confirmed=true;throw Error('offline');}}});
  await assert.rejects(f.run(),/offline/);await f.run();
  assert.deepEqual(f.log.map(x=>x.method),['POST','PATCH','PATCH']);
  for (const bad of [{name:'bob/file'},{size:2},{metadata:{uploadNonce:'other'}}]) {
    assert.equal(matchesUpload({name:pathName,size:4,metadata:{uploadNonce:'test'},...bad},pathName,4,'test'),false);
  }
});
test('refuses foreign and non-TUS upload locations before forwarding credentials or bytes',async()=>{
  for(const url of ['https://example.org/storage/v1/upload/resumable/token','https://alice@abcdefghijklmnopqrst.storage.supabase.co/storage/v1/upload/resumable/token','/storage/v1/object/post-media/foo','//evil.example/upload','/storage/v1/upload/resumable/']) {
    const f=fixture({request:r=>r.method==='POST'?reply(201,{Location:url}):undefined});
    await assert.rejects(f.run(),/unexpected upload destination/);assert.equal(f.log.length,1);
  }
  for(const path of ['bob/file','alice/../bob/file','alice/encoded%2Fpath']) {
    assert.throws(()=>createComposerUpload({owner:'alice',path,projectUrl:base}),/destination/);
  }
});
test('refreshes a 401 once without changing offset and stops if account changes',async()=>{
  let expired=true;
  const f=fixture({request:r=>{if(r.method==='PATCH'&&expired){expired=false;return reply(401);}}});
  await f.run();const patch=f.log.filter(x=>x.method==='PATCH');
  assert.deepEqual(patch.map(x=>x.Authorization),['Bearer a','Bearer b','Bearer b']);
  assert.deepEqual(patch.map(x=>x['Upload-Offset']),['0','0',String(CHUNK)]);
  const switched=fixture({request:(r,state)=>{if(r.method==='PATCH')state.switchOwner();}});
  await assert.rejects(switched.run(),/account changed/);
  assert.deepEqual(switched.log.map(x=>x.method),['POST','PATCH']);
});
test('expired resource restarts at the same object name and mismatched offsets fail closed',async()=>{
  let drop=true;
  const f=fixture({request:(r,state)=>{
    if(r.method==='PATCH'&&drop){drop=false;throw Error('offline');}
    if(r.method==='HEAD'){state.pos=0;return reply(410);}
  }});
  await assert.rejects(f.run(),/offline/);await f.run();
  const creates=f.log.filter(x=>x.method==='POST');
  assert.equal(creates.length,2);assert.equal(creates[0]['Upload-Metadata'],creates[1]['Upload-Metadata']);
  const bad=fixture({request:r=>r.method==='PATCH'?reply(204,{'Upload-Offset':'0'}):undefined});
  await assert.rejects(bad.run(),/interrupted/);
});
