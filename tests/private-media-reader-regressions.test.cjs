const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const postId = '11111111-1111-4111-8111-111111111111';
const mediaId = '22222222-2222-4222-8222-222222222222';
const canonical = 'https://qa.supabase.co/storage/v1/object/public/post-media/owner/image.jpg';
const signed = 'https://qa.supabase.co/storage/v1/object/sign/post-media/owner/image.jpg?token=test';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function source(file) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(ast, predicate) { let found; function walk(node) { if (found) return; if (predicate(node)) found = node; else ts.forEachChild(node, walk); } walk(ast); assert.ok(found, 'Expected source node'); return found; }
function execute(node, ast, context) {
  const module = { exports: {} };
  const code = ts.transpileModule('module.exports = ' + node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, ...context }); return module.exports;
}
function nativeLoad({ hydrationFailure = false, pendingHydration, visible = true } = {}) {
  const ast = source('src/screens/feed/PostScreen.tsx');
  const node = find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'load').initializer.arguments[0];
  const state = { post: { id: 'old' }, galleryImages: [{ url: 'old' }] }, references = [], reads = [];
  const identityRef = { current: { postId, userId: 'viewer' } };
  const context = { postId, userId: 'viewer', loadEpoch: { current: 0 }, identityRef, bounded: value => Promise.resolve(value) };
  for (const key of ['Post','GalleryImages','ThreadAbove','ThreadBelow','NotFound','Loading','LoadError','PostCollabs','CollabInvite','LikedPost','LinkPreview']) context['set'+key] = value => { state[key[0].toLowerCase()+key.slice(1)] = value; };
  context.hydratePostMedia = async rows => { references.push(rows); if (pendingHydration) await pendingHydration; if (hydrationFailure) throw new Error('Denied'); return JSON.parse(JSON.stringify(rows).replaceAll(canonical, signed)); };
  context.supabase = {
    rpc: async () => ({ data: visible, error: null }),
    from(table) {
      const filters = {}; reads.push({ table, filters });
      const chain = { select() { return chain; }, eq(k,v) { filters[k]=v; return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; }, maybeSingle() { return chain; }, then(ok,bad) {
        let data;
        if (table === 'posts') data = filters.id ? { id: postId, user_id: 'author', article_title: 'A story', content: 'Body', post_media: [{ id: mediaId, url: canonical }], post_products: [{ image_url: canonical }] } : [];
        else if (table === 'profiles') data = { id: 'author', full_name: 'Author' };
        else if (table === 'articles') data = { current_revision_id: 'revision' };
        else if (table === 'article_blocks') data = { content: { images: [{ url: canonical }] } };
        else data = table === 'post_collaborators' && !filters.user_id ? [] : null;
        return Promise.resolve({ data, error: null }).then(ok,bad);
      } }; return chain;
    },
  };
  return { load: execute(node,ast,context), state, references, reads, identityRef };
}
test('native standalone post signs its main media, product images and article gallery under the owning post', async () => {
  const run = nativeLoad(); await run.load();
  assert.equal(run.state.post.post_media[0].url,signed);
  assert.equal(run.state.post.post_products[0].image_url,signed);
  assert.equal(run.state.galleryImages[0].url,signed);
  assert.equal(run.references.find(rows=>rows[0].blocks)?.[0].post_id,postId);
  assert.equal(run.state.loadError,null);
});
test('native standalone reader fails closed when media access is denied', async () => {
  const run = nativeLoad({ hydrationFailure: true }); await run.load();
  assert.equal(run.state.post,null); assert.equal(run.state.galleryImages.length,0);
  assert.match(run.state.loadError,/could not be loaded/); assert.equal(run.state.loading,false);
});
test('native post response cannot publish after an account switch', async () => {
  const pending = deferred(), run = nativeLoad({ pendingHydration: pending.promise });
  const work = run.load(); await new Promise(done=>setImmediate(done));
  run.identityRef.current = { postId, userId: 'other' }; pending.resolve(); await work;
  assert.equal(run.state.post.id,'old'); assert.equal(run.state.galleryImages[0].url,'old');
});
test('native unavailable post clears retained media before any row fetch', async () => {
  const run = nativeLoad({ visible:false }); await run.load();
  assert.equal(run.state.post,null); assert.equal(run.state.galleryImages.length,0); assert.equal(run.reads.length,0);
});
function webEdits({ pending, fail = false, sourcePostId = postId } = {}) {
  const ast = source('web/components/MediaGallery.tsx');
  const component = find(ast,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PostMediaGallery');
  const effect = component.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='useEffect'&&n.expression.arguments[0].getText(ast).includes('readPostMediaEdits(')).expression.arguments[0];
  const key = find(component,n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='metadataKey').initializer;
  let edits={}, readCount=0, hydrationCount=0, cleaned=false, revision=1;
  const filters = {}, references = [], listeners = new Set(), work = [];
  const client = { from(){ const q={select(){return q;},in(k,v){filters[k]=Array.from(v);return q;},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return q;},then(ok,bad){readCount++;return Promise.resolve(pending).then(()=>({data:[{id:mediaId,post_id:sourcePostId,edit:{coverUrl:canonical}}],error:null})).then(ok,bad);}};return q;} };
  const compileModule = (file, require) => {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,require,window:{},Map,Set,AbortController,setTimeout,clearTimeout});
    return module.exports;
  };
  const batch = compileModule('shared/keyedBatchReader.ts');
  const metadata = compileModule('web/lib/postMetadata.ts',name=>{
    if(name==='../../shared/keyedBatchReader')return batch;
    if(name==='./supabase/client')return{createClient:()=>client};
    if(name==='./navigationCache')return{getNavigationStore:()=>({getSnapshot:()=>({revision,scope:'viewer:'+revision}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}})};
    if(name==='./contentMedia')return{hydratePostMedia:async(rows,_client,signal)=>{
      assert.ok(signal instanceof AbortSignal);references.push(rows);hydrationCount++;
      if(fail)throw new Error('Denied');assert.equal(rows[0].post_id,postId);
      return JSON.parse(JSON.stringify(rows).replaceAll(canonical,signed));
    }};
    throw new Error('Unexpected metadata module '+name);
  });
  const context = { media:[{id:mediaId,url:canonical}],postId,UUID_ID:/^[0-9a-f-]{36}$/i,setEdits(value){edits=value;},
    readPostMediaEdits(parent,ids){const read=metadata.readPostMediaEdits(parent,ids);work.push(read);return read;},
    subscribePostMetadataSession(listener){const unsubscribe=metadata.subscribePostMetadataSession(listener);return()=>{cleaned=true;unsubscribe();};},
    setInterval:()=>1,clearInterval(){},queueMicrotask,document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}} };
  context.metadataKey=execute(key,ast,context);
  const cleanup=execute(effect,ast,context)();
  return {get edits(){return edits;},filters,references,cleanup,auth(){revision++;listeners.forEach(fn=>fn());},
    async flush(){while(work.length)await Promise.allSettled(work.splice(0));await new Promise(done=>setImmediate(done));},
    get hydrated(){return hydrationCount;},get readCount(){return readCount;},get cleaned(){return cleaned;}};
}
test('web lazy edit cover is post-bound and hydrated before it reaches playback', async () => {
  const run=webEdits();await run.flush();
  assert.deepEqual(run.filters.id,[mediaId]);assert.equal(run.references[0][0].post_id,postId);
  assert.equal(run.edits[mediaId].coverUrl,signed);assert.equal(run.hydrated,1);
  run.auth();assert.equal(Object.keys(run.edits).length,0);await run.flush();
  assert.equal(run.readCount,2);run.cleanup();assert.equal(run.cleaned,true);
});
test('web lazy edit failures and disposed requests never retain raw cover URLs', async () => {
  const denied=webEdits({fail:true});await denied.flush();assert.equal(Object.keys(denied.edits).length,0);denied.cleanup();
  const pending=deferred(),disposed=webEdits({pending:pending.promise});
  for(let n=0;n<50&&!disposed.readCount;n++)await new Promise(done=>setTimeout(done,2));
  assert.equal(disposed.readCount,1,'the request is actually in flight before disposal');
  disposed.cleanup();pending.resolve();await disposed.flush();assert.equal(Object.keys(disposed.edits).length,0);
});
test('a batched lazy edit from another parent post cannot be signed or retained', async () => {
  const run=webEdits({sourcePostId:'33333333-3333-4333-8333-333333333333'});await run.flush();
  assert.equal(run.hydrated,0);assert.equal(run.edits[mediaId],null);run.cleanup();
});
