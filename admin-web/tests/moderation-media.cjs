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
  vm.runInNewContext(code, { module, exports: module.exports, URL, Set, Map, process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } },
    require(name) { if (name === 'server-only') return {}; if (dependencies[name]) return dependencies[name]; throw Error('Unexpected dependency: ' + name); } });
  return module.exports;
}
const publicMedia = load('publicMedia');
function fixture({ denied = false, exists = true, bindingId = id, signingError = false, bindingError = false, bindingRows, failAtOffset = -1 } = {}) {
  const events = [];
  const svc = {
    from(table) {
      events.push(['read', table]);
      const filters = {}, orders = [];
      let from=0, to=499;
      const query = {
        select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        in(key, value) { filters[key] = value; return query; },
        order(key, options) { assert.equal(options.ascending,true);orders.push(key);return query; },
        range(start,end) {from=start;to=end;return query;},
        then(resolve, reject) {
          if (table === 'posts' || table === 'stories') return Promise.resolve({ data: exists ? [{ id }] : [], error: null }).then(resolve, reject);
          assert.equal(table, 'content_media_bindings');
          assert.equal(filters.entity_kind, 'post');
          assert.deepEqual(Array.from(filters.entity_id), [id]);
          assert.deepEqual(orders,['entity_id','bucket_id','object_path']);
          assert.equal(to-from+1,500);
          events.push(['bindings-page',from,to]);
          const rows=bindingRows??[
            { entity_id: bindingId, bucket_id: 'post-media', object_path: 'owner/photo.jpg' },
            { entity_id: bindingId, bucket_id: 'chat-media', object_path: 'private.jpg' },
          ];
          return Promise.resolve({ error: bindingError||from===failAtOffset ? { message: 'denied' } : null, data: rows.slice(from,to+1) }).then(resolve,reject);
        },
      };
      return query;
    },
    storage: { from(bucket) { return { async createSignedUrls(paths, ttl) {
      events.push(['sign', bucket, Array.from(paths), ttl]);
      return signingError ? { data: null, error: {} } : { error: null, data: paths.map(p => ({ path: p, signedUrl: base + '/signed/' + p })) };
    } }; } },
  };
  const { resolveModerationMedia } = load('moderationMedia', {
    './adminAuth': { async requirePermission(permission) { events.push(['auth', permission]); if (denied) throw Error('Permission denied'); } },
    './supabaseAdmin': { serviceClient() { events.push(['client']); return svc; } },
    './media': { async resolveMedia() { return Object.create(null); } },
    './publicMedia': publicMedia,
  });
  return { resolveModerationMedia, events };
}
test('private moderation signs a bound object once after verifying staff permission', async () => {
  const f = fixture();
  const raw = base + '/storage/v1/object/public/post-media/owner/photo.jpg';
  const map = await f.resolveModerationMedia([raw, raw, 'post-media/owner/photo.jpg'], 'post', [id, id]);
  assert.equal(map[raw], base + '/signed/owner/photo.jpg');
  assert.equal(map['post-media/owner/photo.jpg'], map[raw]);
  assert.deepEqual(f.events[0], ['auth', 'post_moderate']);
  assert.deepEqual(f.events.filter(e => e[0] === 'sign'), [['sign', 'post-media', ['owner/photo.jpg'], 600]]);
});
test('denied staff cannot query objects or create private URLs', async () => {
  const f = fixture({ denied: true });
  await assert.rejects(f.resolveModerationMedia(['post-media/owner/photo.jpg'], 'post', [id]), /Permission denied/);
  assert.deepEqual(f.events, [['auth', 'post_moderate']]);
});
test('unbound paths, another project, chat files and unsupported schemes never get signed', async () => {
  const f = fixture();
  const values = ['post-media/owner/other.jpg', 'chat-media/private.jpg', 'file:///secret.jpg',
    'https://other.example.test/storage/v1/object/public/post-media/owner/photo.jpg', 'post-media/owner/%2e%2e/photo.jpg'];
  const map = await f.resolveModerationMedia(values, 'post', [id]);
  assert.equal(Object.keys(map).length, 0);
  assert.equal(f.events.filter(e => e[0] === 'sign').length, 0);
});
for (const options of [{ exists: false }, { bindingId: other }]) {
  test('deleted content and bindings outside the requested content cannot be signed ' + JSON.stringify(options), async () => {
    const f = fixture(options);
    const map = await f.resolveModerationMedia(['post-media/owner/photo.jpg'], 'post', [id]);
    assert.equal(Object.keys(map).length, 0);
    assert.equal(f.events.filter(e => e[0] === 'sign').length, 0);
  });
}
test('authorization read failure is explicit and prevents signing', async () => {
  const f = fixture({ bindingError: true });
  await assert.rejects(f.resolveModerationMedia(['post-media/owner/photo.jpg'], 'post', [id]), /authorization could not be checked/);
  assert.equal(f.events.filter(e => e[0] === 'sign').length, 0);
});
test('storage failure never falls back to an unauthorized public URL', async () => {
  const f = fixture({ signingError: true });
  const map = await f.resolveModerationMedia(['post-media/owner/photo.jpg'], 'post', [id]);
  assert.equal(Object.keys(map).length, 0);
});
test('existing public reader stays closed for private content', () => {
  const raw = base + '/storage/v1/object/public/post-media/owner/photo.jpg';
  assert.equal(publicMedia.publicMediaUrl(raw, base, new Set(['avatars'])), null);
  assert.equal(publicMedia.publicMediaUrl('avatars/user/avatar.jpg', base, new Set(['avatars'])), base + '/storage/v1/object/public/avatars/user/avatar.jpg');
});

function manyBindings(count) {
  return Array.from({length:count},(_,n)=>({entity_id:id,bucket_id:'post-media',object_path:`owner/image-${String(n).padStart(4,'0')}.jpg`}));
}
test('moderation reads deterministic pages beyond the API row cap before signing a later image',async()=>{
  const f=fixture({bindingRows:manyBindings(1101)});
  const raw='post-media/owner/image-1100.jpg';
  const map=await f.resolveModerationMedia([raw],'post',[id]);
  assert.equal(map[raw],base+'/signed/owner/image-1100.jpg');
  assert.deepEqual(f.events.filter(e=>e[0]==='bindings-page'),[['bindings-page',0,499],['bindings-page',500,999],['bindings-page',1000,1499]]);
  const lastRead=f.events.findIndex(e=>e[0]==='bindings-page'&&e[1]===1000);
  assert.ok(f.events.findIndex(e=>e[0]==='sign')>lastRead);
});
test('a later binding page failure cannot sign media from an earlier partial page',async()=>{
  const f=fixture({bindingRows:manyBindings(501),failAtOffset:500});
  await assert.rejects(f.resolveModerationMedia(['post-media/owner/image-0000.jpg'],'post',[id]),/authorization could not be checked/);
  assert.equal(f.events.filter(e=>e[0]==='sign').length,0);
});
test('an oversized binding set is explicit and never returns partially authorized previews',async()=>{
  const f=fixture({bindingRows:manyBindings(4001)});
  await assert.rejects(f.resolveModerationMedia(['post-media/owner/image-0000.jpg'],'post',[id]),/exceeded its binding limit/);
  assert.equal(f.events.filter(e=>e[0]==='sign').length,0);
  assert.equal(f.events.filter(e=>e[0]==='bindings-page').length,9);
});
test('exactly the bounded maximum completes after checking for one more page',async()=>{
  const f=fixture({bindingRows:manyBindings(4000)});
  const raw='post-media/owner/image-3999.jpg';
  const map=await f.resolveModerationMedia([raw],'post',[id]);
  assert.equal(map[raw],base+'/signed/owner/image-3999.jpg');
  assert.deepEqual(f.events.filter(e=>e[0]==='bindings-page').at(-1),['bindings-page',4000,4499]);
});
