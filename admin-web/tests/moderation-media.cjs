const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = 'https://qa.example.test';
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
function load(name, dependencies = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../lib/', name + '.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, URLSearchParams, Set, Map, process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } },
    require(name) { if (name === 'server-only') return {}; if (dependencies[name]) return dependencies[name]; throw Error('Unexpected dependency: ' + name); } });
  return module.exports;
}
const publicMedia = load('publicMedia');
function fixture({ denied = false, manifestError = false, rows } = {}) {
  const events = [];
  const svc = { async rpc(name,args) {
    events.push(['manifest',name,{...args,p_entity_ids:Array.from(args.p_entity_ids)}]);
    return { error: manifestError ? {message:'denied'} : null, data: rows === undefined ? [{entity_id:id,bucket_id:'post-media',object_path:'owner/photo.jpg'}] : rows };
  } };
  const { resolveModerationMedia } = load('moderationMedia', {
    './adminAuth': { async requirePermission(permission) { events.push(['auth', permission]); if (denied) throw Error('Permission denied'); } },
    './supabaseAdmin': { serviceClient() { events.push(['client']); return svc; } },
    './media': { async resolveMedia(raws) { events.push(['public',Array.from(raws)]);const result=Object.create(null);for(const raw of raws)result[raw]=publicMedia.publicMediaUrl(raw,base,new Set(['avatars','post-media']));return result; } },
    './publicMedia': publicMedia,
  });
  return { resolveModerationMedia, events };
}
const proxy = (objectPath='owner/photo.jpg') => '/api/moderation-media?'+new URLSearchParams({kind:'post',id,bucket:'post-media',path:objectPath});
test('private moderation returns only a same-origin authenticated proxy after verifying permission', async () => {
  const f=fixture();const raw=base+'/storage/v1/object/public/post-media/owner/photo.jpg';
  const map=await f.resolveModerationMedia([raw,raw,'post-media/owner/photo.jpg'],'post',[id,id]);
  assert.equal(map[raw],proxy());assert.equal(map['post-media/owner/photo.jpg'],map[raw]);
  assert.deepEqual(f.events[0],['auth','post_moderate']);
  assert.deepEqual(f.events.find(e=>e[0]==='manifest'),['manifest','admin_bound_content_media_manifest',{p_kind:'post',p_entity_ids:[id],p_origin:base}]);
  assert.deepEqual(f.events.find(e=>e[0]==='public'),['public',[]]);
});
test('denied staff cannot query authorization or generate URLs',async()=>{
 const f=fixture({denied:true});await assert.rejects(f.resolveModerationMedia(['post-media/owner/photo.jpg'],'post',[id]),/Permission denied/);assert.deepEqual(f.events,[['auth','post_moderate']]);
});
test('unbound paths, cross-project URLs, chat files and malformed paths never receive a preview',async()=>{
 const f=fixture();const map=await f.resolveModerationMedia(['post-media/owner/other.jpg','chat-media/private.jpg','file:///secret.jpg','https://other.example.test/storage/v1/object/public/post-media/owner/photo.jpg','post-media/owner/%2e%2e/photo.jpg'],'post',[id]);assert.equal(Object.keys(map).length,0);
});
test('private paths never fall back to a public bucket URL even before the private cutover',async()=>{
 const f=fixture({rows:[]});const raw=base+'/storage/v1/object/public/post-media/owner/photo.jpg';const map=await f.resolveModerationMedia([raw,'avatars/user/avatar.jpg'],'post',[id]);
 assert.equal(map[raw],undefined);assert.equal(map['avatars/user/avatar.jpg'],base+'/storage/v1/object/public/avatars/user/avatar.jpg');
 assert.deepEqual(f.events.find(e=>e[0]==='public'),['public',['avatars/user/avatar.jpg']]);
});
test('authorization failure is explicit and cannot issue a partial preview map',async()=>{
 const f=fixture({manifestError:true});await assert.rejects(f.resolveModerationMedia(['post-media/owner/photo.jpg'],'post',[id]),/authorization could not be checked/);
});
for(const rows of [null,{},[{entity_id:other,bucket_id:'post-media',object_path:'owner/photo.jpg'}],[{entity_id:id,bucket_id:'chat-files',object_path:'private.jpg'}],[{entity_id:id,bucket_id:'post-media',object_path:'owner/../file.jpg'}]]){
 test('invalid or out-of-scope service manifest fails closed '+JSON.stringify(rows),async()=>{const f=fixture({rows});await assert.rejects(f.resolveModerationMedia(['post-media/owner/photo.jpg'],'post',[id]),/invalid manifest/);});
}
function manyBindings(count){return Array.from({length:count},(_,n)=>({entity_id:id,bucket_id:'post-media',object_path:`owner/image-${String(n).padStart(4,'0')}.jpg`}));}
test('a single bounded JSON manifest is not truncated by the REST table row cap',async()=>{
 const f=fixture({rows:manyBindings(1101)});const raw='post-media/owner/image-1100.jpg';const map=await f.resolveModerationMedia([raw],'post',[id]);assert.equal(map[raw],proxy('owner/image-1100.jpg'));assert.equal(f.events.filter(e=>e[0]==='manifest').length,1);
});
test('oversized manifests are explicit instead of silently producing incomplete previews',async()=>{
 const f=fixture({rows:manyBindings(4001)});await assert.rejects(f.resolveModerationMedia(['post-media/owner/image-0000.jpg'],'post',[id]),/exceeded its binding limit/);
});
test('exactly the bounded maximum is accepted',async()=>{
 const f=fixture({rows:manyBindings(4000)});const raw='post-media/owner/image-3999.jpg';const map=await f.resolveModerationMedia([raw],'post',[id]);assert.equal(map[raw],proxy('owner/image-3999.jpg'));
});
test('the separate public reader remains closed for private content',()=>{
 const raw=base+'/storage/v1/object/public/post-media/owner/photo.jpg';assert.equal(publicMedia.publicMediaUrl(raw,base,new Set(['avatars'])),null);
});
