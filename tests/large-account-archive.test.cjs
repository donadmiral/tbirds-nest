const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, {exports, require: id => { if (!(id in modules)) throw Error(id); return modules[id]; },
    TextEncoder, Response, ReadableStream, Uint8Array});
  return exports;
}

const archive = load('shared/accountArchive.ts');
const id = '20000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000001';
function fixture(opts = {}) {
  const calls = [];
  const parts = ['hello', '𐐷\n'];
  const manifest = {id, owner_id:owner, format:'jsonl-v1', status:'ready', part_count:2,
    byte_count: Buffer.byteLength(parts.join('')), next_part:0, ...opts.manifest};
  const rpc = (name, args) => {
    calls.push([name, args?.p_part]);
    let data;
    if (name === 'request_account_archive') data = id;
    else if (args.p_part === undefined) data = manifest;
    else {
      const n = args.p_part;
      data = {id, owner_id:owner, part_number:n, next_part:n === 0 ? 1 : null, content:parts[n], ...opts.part?.(n)};
    }
    const result = Promise.resolve({ data, error:null });
    result.abortSignal = () => result;
    return result;
  };
  return {calls, rpc, manifest};
}
async function consume(chunks) {
  const result = [];
  for await (const chunk of chunks) result.push(Buffer.from(chunk));
  return Buffer.concat(result).toString('utf8');
}
test('caller-bound worker manifest, one chunk per continuation, digestible Unicode', async () => {
  const {calls,rpc} = fixture();
  const m = await archive.getArchive(rpc, owner);
  const iter = archive.archiveBytes(rpc, m, () => {});
  assert.equal(calls.length,2);
  assert.equal(Buffer.from((await iter.next()).value).toString(),'hello');
  assert.equal(calls.length,3);
  assert.equal(await consume(iter),'𐐷\n');
  assert.deepEqual(calls.map(row=>row[1]),[undefined,undefined,0,1]);
});
test('private transfer rejects a changed caller, broken continuation and short or oversized data', async () => {
  for (const bad of [{owner_id:'other'}, {part_number:9}, {next_part:77}, {id:'wrong'},
    {content:''}, {content:'𐐷'.repeat(65537)}]) {
    const {rpc,manifest} = fixture({part:() => bad});
    await assert.rejects(consume(archive.archiveBytes(rpc, manifest, () => {})), /interrupt|size/);
  }
  for (const byte_count of [5,500]) {
    const {rpc,manifest} = fixture({manifest:{byte_count}});
    await assert.rejects(consume(archive.archiveBytes(rpc,manifest,()=>{})), /size/);
  }
  const f = fixture({manifest:{owner_id:'other'}});
  await assert.rejects(archive.getArchive(f.rpc,owner), /confirmed/);
  const switched = fixture();
  let checks = 0;
  await assert.rejects(consume(archive.archiveBytes(switched.rpc,switched.manifest,()=>{
    if (++checks === 2) throw Error('signed out');
  })), /signed out/);
  assert.equal(switched.calls.length,1);
});
function route(user, f) {
  const {GET} = load('web/app/api/account-archive/[id]/route.ts', {
    '@/lib/supabase/server':{createClient:async()=>({rpc:f.rpc, auth:{getUser:async()=>({data:{user}})}})},
    '../../../../../shared/accountArchive':archive,
  });
  return GET(new Request('https://local.test/api/account-archive/'+id),{params:Promise.resolve({id})});
}
test('web attachment is private, byte-counted and streamed, only ready manifests can download', async () => {
  const ready = await route({id:owner},fixture());
  assert.equal(ready.status,200);
  assert.match(ready.headers.get('cache-control'),/no-store/);
  assert.equal(ready.headers.get('content-length'),'10');
  assert.match(ready.headers.get('content-disposition'),/attachment/);
  assert.equal(await ready.text(),'hello𐐷\n');
  const denied = fixture();
  assert.equal((await route(null,denied)).status,401);
  assert.equal(denied.calls.length,0);
  assert.equal((await route({id:'other'},fixture())).status,404);
  assert.equal((await route({id:owner},fixture({manifest:{status:'queued'}}))).status,409);
  const broken = await route({id:owner},fixture({part:n=> n === 1 ? {id:'wrong'} : {}}));
  await assert.rejects(broken.text(), /interrupt/);
});
function mobile(f, sharing = true) {
  const events = [];
  class File {
    exists = true; uri = 'file://private/archive.jsonl';
    create() { events.push('create'); }
    open() { return {writeBytes: bytes => events.push(Buffer.from(bytes).toString()), close:()=>events.push('close')}; }
    delete() { events.push('delete'); }
  }
  const mod = load('src/services/largeAccountArchive.ts',{
    'expo-file-system':{Paths:{cache:'/private'},File},
    'expo-sharing':{isAvailableAsync:async()=>sharing,shareAsync:async()=>{events.push('share');}},
    '../../shared/readDeadline':{readWithDeadline:async read=>read},
    '../../shared/accountArchive':archive, './supabase':{supabase:{rpc:f.rpc}},
  });
  return {events, share:() => mod.shareLargeAccountArchive(owner,()=>{})};
}
test('phone shares a completed disk file, releases interrupted files, never shares a partial archive',async()=>{
  const ready = mobile(fixture());
  await ready.share();
  assert.deepEqual(ready.events,['create','hello','𐐷\n','close','share','delete']);
  const incomplete = mobile(fixture({part:n => n === 1 ? {id:'wrong'} : {}}));
  await assert.rejects(incomplete.share(),/interrupt/);
  assert.deepEqual(incomplete.events,['create','hello','close','delete']);
  const queued = mobile(fixture({manifest:{status:'queued'}}));
  assert.match(await queued.share(),/queued/);
  assert.deepEqual(queued.events,[]);
  const unavailable = mobile(fixture(),false);
  await assert.rejects(unavailable.share(),/unavailable/);
  assert.deepEqual(unavailable.events,[]);
});
