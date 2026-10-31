const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = 'https://example.supabase.co', id = '10000000-0000-4000-8000-000000000001', nestedId = '20000000-0000-4000-8000-000000000002';
const raw = `${base}/storage/v1/object/public/post-media/${id}/photo.jpg`;
const signed = `${base}/storage/v1/object/sign/post-media/${id}/photo.jpg?token=synthetic`;
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require(name) { if (!(name in imports)) throw new Error(name); return imports[name]; }, URL, Request, Response, setTimeout, clearTimeout });
  return exports;
}
const media = load('shared/contentMedia.ts');
const { createContentMediaHandler } = load('supabase/functions/content-media-sign/handler.ts', { '../../../shared/contentMedia.ts': media });
const plain = value => JSON.parse(JSON.stringify(value));
test('content parsing accepts current project only and rejects traversal/encoded alternatives', () => {
  assert.equal(media.contentObject(raw, base).key, `post-media/${id}/photo.jpg`);
  for (const value of [raw.replace(base, 'https://evil.test'), raw.replace('photo.jpg', '%252e%252e/private.jpg'), raw.replace('photo.jpg', '%5cprivate.jpg'), raw.replace(base, 'https://user:password@example.supabase.co')]) assert.equal(media.contentObject(value, base), null);
});
test('embedded post requests are independent and duplicate IDs are removed', () => {
  const result = media.contentReferences([{ id, stickers_json: [{ postId: nestedId, postMediaUrl: raw }, { postId: nestedId }] }], 'story');
  assert.deepEqual(plain(result), [{ kind: 'story', id }, { kind: 'post', id: nestedId }]);
});
test('authorized URLs are replaced and missing capabilities are cleared in every nested field', () => {
  const row = { id, media_url: raw, media: [{ url: raw, edit: { coverUrl: raw + '2' } }], avatar: 'https://example.com/avatar.png' };
  const result = media.replaceContentMedia(row, base, new Map([[`post-media/${id}/photo.jpg`, signed]]));
  assert.equal(result.media_url, signed); assert.equal(result.media[0].url, signed); assert.equal(result.media[0].edit.coverUrl, null);
  assert.equal(result.avatar, row.avatar); assert.equal(row.media_url, raw);
});
test('text-only content does not add authentication or signing round trips', async () => {
  const rows = [{ id, text: 'Hello' }];
  assert.equal(await media.hydrateContentMedia({}, base, rows, 'post'), rows);
});
test('account changes discard capabilities rather than applying them to another viewer', async () => {
  let reads = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'A' } }, error: null }), getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: reads++ === 0 ? 'A' : 'B' } } }, error: null }) }, functions: { invoke: async () => ({ data: { urls: [{ key: `post-media/${id}/photo.jpg`, url: signed }], expiresAt: Date.now() + 300000 }, error: null }) } };
  await assert.rejects(() => media.hydrateContentMedia(client, base, [{ id, media_url: raw }], 'post'), /account changed/);
});
test('signer rejects unauthenticated calls and never signs client-supplied paths', async () => {
  let signCalls = 0;
  const handler = createContentMediaHandler({ base, authenticate: async () => false, manifest: async () => [], sign: async () => { signCalls++; return []; } });
  const response = await handler(new Request('https://function.invalid', { method: 'POST', body: JSON.stringify({ references: [{ kind: 'post', id }], paths: ['private.jpg'] }) }));
  assert.equal(response.status, 401); assert.equal(signCalls, 0);
});
test('only verified manifest objects may enter the signing batch', async () => {
  const calls = [];
  const handler = createContentMediaHandler({ base, authenticate: async () => true, manifest: async () => [{ media_url: raw }, { media_url: raw.replace(base, 'https://evil.test') }], sign: async (bucket, paths) => { calls.push({ bucket, paths }); return [{ path: `${id}/photo.jpg`, signedUrl: signed }, { path: 'not-requested.jpg', signedUrl: signed }]; } });
  const response = await handler(new Request('https://function.invalid', { method: 'POST', body: JSON.stringify({ references: [{ kind: 'post', id }], paths: ['private.jpg'] }) }));
  const result = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(plain(calls), [{ bucket: 'post-media', paths: [`${id}/photo.jpg`] }]);
  assert.equal(result.urls.length, 1); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('missing manifest is a failure, and denied content returns no capability', async () => {
  for (const [manifest, status] of [[null, 503], [[], 200]]) {
    const handler = createContentMediaHandler({ base, authenticate: async () => true, manifest: async () => manifest, sign: async () => { throw new Error('Must not sign'); } });
    const response = await handler(new Request('https://function.invalid', { method: 'POST', body: JSON.stringify({ references: [{ kind: 'post', id }] }) }));
    assert.equal(response.status, status);
  }
});

test('article covers request the linked post and draft references remain a distinct permission', () => {
  assert.deepEqual(plain(media.contentReferences([{id,linked_post_id:nestedId}], 'post')), [{kind:'post',id:nestedId}]);
  assert.deepEqual(plain(media.contentReferences([{id}], 'story_draft')), [{kind:'story_draft',id}]);
});
test('unsigned and foreign responses cannot become media capabilities', async()=>{
  const client={auth:{getUser:async()=>({data:{user:{id}},error:null}),getSession:async()=>({data:{session:{access_token:"test-token",user:{id}}},error:null})},functions:{invoke:async()=>({data:{urls:[{key:`post-media/${id}/photo.jpg`,url:raw}],expiresAt:Date.now()+300000},error:null})}};
  const [row]=await media.hydrateContentMedia(client,base,[{id,media_url:raw}], 'post');
  assert.equal(row.media_url,null);
  assert.equal(media.isContentCapability(raw,base),false);
  assert.equal(media.isContentCapability(signed.replace('token=synthetic','token='),base),false);
  assert.equal(media.isContentCapability(signed,base),true);
});
test('malformed JSON values fail as client errors before manifest or signing',async()=>{
  const handler=createContentMediaHandler({base,authenticate:async()=>true,manifest:async()=>{throw Error('must not call');},sign:async()=>{throw Error('must not call');}});
  for(const value of [null,2,'text',{}, {references:[{kind:'story_draft',id:'bad'}]}]) {
    const response=await handler(new Request('https://function.invalid',{method:'POST',body:JSON.stringify(value)}));
    assert.equal(response.status,400);
  }
});
test('expired capabilities never reach a rendered row',async()=>{
  const client={auth:{getUser:async()=>({data:{user:{id}},error:null}),getSession:async()=>({data:{session:{access_token:"test-token",user:{id}}},error:null})},functions:{invoke:async()=>({data:{urls:[{key:`post-media/${id}/photo.jpg`,url:signed}],expiresAt:Date.now()-1},error:null})}};
  await assert.rejects(()=>media.hydrateContentMedia(client,base,[{id,media_url:raw}], 'post'),/expired/);
});

test('Markdown images hydrate without changing text or turning ordinary links into media', () => {
  const text = `Text [ordinary](${raw})\n\n![Caption](${raw})`;
  const result = media.replaceContentMedia({body:text},base,new Map([[`post-media/${id}/photo.jpg`,signed]]));
  assert.equal(result.body, `Text [ordinary](${raw})\n\n![Caption](${signed})`);
  const denied = media.replaceContentMedia({body:`![Caption](${raw})`},base,new Map());
  assert.equal(denied.body, '[Caption]');
});
test('canonical reshares remove signed tokens from nested objects and Markdown before storage', () => {
  const source = { stickers:[{postMediaUrl:signed}],body:`![Photo](${signed})` };
  const result = media.canonicalContentMedia(source,base);
  assert.equal(result.stickers[0].postMediaUrl,raw);
  assert.equal(result.body,`![Photo](${raw})`);
  assert.ok(!JSON.stringify(result).includes('token='));
  assert.equal(source.stickers[0].postMediaUrl,signed);
});
test('owner upload hydration uses the separate server ownership manifest and never persists previews', async () => {
  const calls=[];
  const delivered=`${base}/functions/v1/media-content/post-media/${id}/photo.jpg?token=${'a'.repeat(64)}`;
  const client={auth:{getUser:async()=>({data:{user:{id}},error:null}),getSession:async()=>({data:{session:{access_token:"test-token",user:{id}}},error:null})},functions:{invoke:async(name,{body})=>{calls.push(body);return{data:{urls:[{key:`post-media/${id}/photo.jpg`,url:delivered}],expiresAt:Date.now()+300000},error:null};}}};
  const original={body:`![Photo](${raw})`};
  const [result]=await media.hydrateOwnerUploadMedia(client,base,[original]);
  assert.deepEqual(plain(calls),[{uploads:[raw],delivery:'no-store'}]);
  assert.equal(result.body,`![Photo](${delivered})`);
  assert.equal(original.body,`![Photo](${raw})`);
});
test('upload requests cannot bypass authenticated owner authorization or mix modes', async () => {
  let signedCalls=0, manifestCalls=0;
  const handler=createContentMediaHandler({base,authenticate:async()=>true,manifest:async()=>{manifestCalls++;return[];},uploads:async()=>[],sign:async()=>{signedCalls++;return[];}});
  const denied=await handler(new Request('https://function.invalid',{method:'POST',body:JSON.stringify({uploads:[raw]})}));
  assert.equal(denied.status,200); assert.deepEqual((await denied.json()).urls,[]); assert.equal(signedCalls,0); assert.equal(manifestCalls,0);
  for(const body of [{uploads:[raw],references:[{kind:'post',id}]},{uploads:[raw.replace(base,'https://other.test')]}]){
    const result=await handler(new Request('https://function.invalid',{method:'POST',body:JSON.stringify(body)}));assert.equal(result.status,400);
  }
});
