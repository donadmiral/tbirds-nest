const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = 'https://preview.supabase.co';
const postId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const canonical = name => `${base}/storage/v1/object/public/post-media/owner/${name}`;
const signed = name => `${base}/functions/v1/media-content/post-media/owner/${name}?token=${'a'.repeat(64)}`;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function execute(source, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, URL, setTimeout, clearTimeout, queueMicrotask, ...globals, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; } });
  return module.exports;
}
const load = (file, imports, globals) => execute(fs.readFileSync(path.join(root, file), 'utf8'), imports, globals);
const preview = load('shared/sharedPostPreview.ts');
const content = load('shared/contentMedia.ts');
const delivery = load('shared/mediaDelivery.ts');
const safe = rows => content.replaceContentMedia(rows, base, new Map([
  ['post-media/owner/source.mp4', signed('source.mp4')],
  ['post-media/owner/cover.jpg', signed('cover.jpg')],
  ['post-media/owner/second.jpg', signed('second.jpg')],
]));
const strip = rows => content.replaceContentMedia(rows, base, new Map());
const row = (id = postId) => ({ id, user_id: 'author', content: 'Original caption', body: null, created_at: '2026-11-01T12:00:00Z', post_media: [
  { url: canonical('second.jpg'), media_type: 'image', sort_order: 1 },
  { url: canonical('source.mp4'), media_type: 'video/mp4', sort_order: 0, edit: { coverUrl: canonical('cover.jpg') } },
] });

test('the ordered source preview keeps its granted cover, normalizes MIME video and reports its album count', () => {
  const input = safe([row()])[0], result = preview.sharedPostPreview(input);
  assert.deepEqual(plain(result), { media: { url: signed('source.mp4'), media_type: 'video', thumbnail_url: signed('cover.jpg') }, mediaCount: 2 });
  assert.equal(preview.sharedPostImageUri(result.media), signed('cover.jpg'));
  assert.equal(input.post_media[0].url, signed('second.jpg'), 'The input order is not mutated');
});

test('a denied first source item never borrows another album item or the containing post image', () => {
  const first = { url: null, media_type: 'video', sort_order: 0, edit: { coverUrl: null } };
  const result = preview.sharedPostPreview({ media_url: signed('wrong-source.jpg'), post_media: [first, { url: signed('second.jpg'), sort_order: 1, media_type: 'image' }] });
  assert.equal(result.media.url, ''); assert.equal(result.media.media_type, 'video');
  assert.equal(preview.sharedPostImageUri(result.media), null); assert.equal(result.mediaCount, 2);
  assert.equal(preview.sharedPostMediaLabel(result.media, result.mediaCount), '2 items');
});

test('legacy movies and MIME variants cannot become image decoder inputs, while text and image posts keep their content', () => {
  for (const type of ['video', ' VIDEO/MP4 ', 'image', undefined]) {
    const result = preview.sharedPostPreview({ media_url: `${signed('source.MOV')}`, media_type: type });
    assert.equal(result.media.media_type, 'video'); assert.equal(preview.sharedPostImageUri(result.media), null);
  }
  assert.equal(preview.sharedPostImageUri({ media_type: 'video', url: signed('source.mp4'), thumbnail_url: signed('wrong.mp4') }), null);
  assert.equal(preview.sharedPostImageUri({ media_type: 'image/jpeg', url: signed('cover.jpg') }), signed('cover.jpg'));
  assert.equal(preview.sharedPostPreview({}).media, null);
  assert.equal(preview.sharedPostPreview({ image_url: signed('cover.jpg') }).media.url, signed('cover.jpg'));
});

function hooks() {
  const slots = [], effects = []; let cursor = 0;
  return {
    api: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((d,j) => !Object.is(d,slots[i].deps[j]))) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    },
    render(fn) { cursor = 0; return fn(); }, flush() { while (effects.length) effects.shift()(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const jsx = (type, props, key) => ({ type, props, key });
const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
function native() {
  const h = hooks();
  const component = load('src/components/feed/SharedPostCard.tsx', {
    react: h.api, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 } },
    'expo-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Icon' },
    '../../theme/useTheme': { themedSheet: fn => fn({ surface: { canvas: '#fff', raised: '#eee', sunken: '#eee', hairline: '#ddd' }, ink: { primary: '#123', muted: '#456' } }) },
    '../VerifiedBadge': {}, '../TierName': {}, '../../../shared/sharedPostPreview': preview, '../../../shared/mediaDelivery': delivery,
  });
  return { ...h, ...component };
}

test('both native card layouts hand the same source poster to the thumbnail, and text-only posts reserve no blank tile', () => {
  const n = native(); const post = { id: postId, content: 'Original caption', ...preview.sharedPostPreview(safe([row()])[0]) };
  for (const layout of ['full', 'compact']) {
    const tree = n.default({ post, layout });
    const thumbnail = walk(tree).find(item => item.type === n.SharedPostThumbnail);
    assert.equal(thumbnail.props.media.thumbnail_url, signed('cover.jpg')); assert.equal(thumbnail.props.mediaCount, 2);
  }
  const text = n.default({ post: { id: postId, content: 'A source text post' }, layout: 'compact' });
  assert.equal(walk(text).some(item => item.type === n.SharedPostThumbnail), false);
  assert.equal(walk(text).some(item => item.type === 'Text' && item.props.children === 'A source text post'), true);
});

test('native source thumbnails show a labeled fallback on failure and cannot flash a previous post image', () => {
  const n = native(); const media = { url: signed('source.mp4'), media_type: 'video/mp4', thumbnail_url: signed('cover.jpg') };
  const initial = n.render(() => n.SharedPostThumbnail({ postId, media, compact: true }));
  const image = walk(initial).find(item => item.type === 'Image');
  assert.equal(image.props.source.uri, signed('cover.jpg')); assert.equal(image.props.cachePolicy, 'none'); assert.equal(image.props.transition, 0);
  image.props.onError();
  const failed = n.render(() => n.SharedPostThumbnail({ postId, media, compact: true }));
  assert.equal(walk(failed).some(item => item.type === 'Image'), false); assert.match(failed.props.accessibilityLabel, /Video.*unavailable/);
  const next = n.render(() => n.SharedPostThumbnail({ postId: otherId, media, compact: true }));
  const nextImage = walk(next).find(item => item.type === 'Image'); assert.ok(nextImage); assert.notEqual(nextImage.key, image.key);
  image.props.onError();
  assert.equal(walk(n.render(() => n.SharedPostThumbnail({ postId: otherId, media, compact: true }))).some(item => item.type === 'Image'), true);
  const noPoster = n.render(() => n.SharedPostThumbnail({ postId: otherId, media: { ...media, thumbnail_url: null }, compact: true }));
  assert.equal(walk(noPoster).some(item => item.type === 'Image'), false); assert.match(noPoster.props.accessibilityLabel, /Video/);
});

test('web source thumbnails retain the signed poster and show useful failure states without starting a movie', () => {
  const h = hooks(); const icons = Object.fromEntries(['FileText','Image','Layers','Music','Play','Video'].map(name => [name, name]));
  const { SharedPostThumbnail } = load('web/components/SharedPostThumbnail.tsx', { react: h.api, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': icons, '../../shared/sharedPostPreview': preview });
  const props = { postId, ...preview.sharedPostPreview(safe([row()])[0]) };
  const first = h.render(() => SharedPostThumbnail(props)); const image = walk(first).find(item => item.type === 'img');
  assert.equal(image.props.src, signed('cover.jpg')); image.props.onError();
  const failed = h.render(() => SharedPostThumbnail(props)); assert.equal(walk(failed).some(item => item.type === 'img' || item.type === 'video'), false);
  assert.match(failed.props['aria-label'], /2 items.*unavailable/);
  const next = h.render(() => SharedPostThumbnail({ ...props, postId: otherId })); assert.notEqual(walk(next).find(item => item.type === 'img').key, image.key);
});

function webSource({ gate, authorGate, denied = false, sourceMissing = false } = {}) {
  const h = hooks(), calls = [], reads = []; let auth, unsubscribed = false, authors = 0;
  const client = {
    auth: { onAuthStateChange(fn) { auth = fn; return { data: { subscription: { unsubscribe() { unsubscribed = true; } } } }; } },
    from(table) {
      let id;
      const query = {
        select() { return query; }, eq(_key,value) { id = value; return query; },
        maybeSingle() {
          reads.push({ table, id });
          if (table === 'posts') return Promise.resolve({ data: sourceMissing ? null : row(id), error: null });
          const pending = Array.isArray(authorGate) ? authorGate[authors++] : authorGate;
          const result = { data: { full_name: 'Source author', username: 'source' }, error: null };
          return pending ? pending.promise.then(value => value ?? result) : Promise.resolve(result);
        },
      };
      return query;
    },
  };
  const { useSharedPostPreview } = load('web/lib/useSharedPostPreview.ts', {
    react: h.api, '../../shared/sharedPostPreview': preview,
    './contentMedia': { withoutPrivateMedia: strip, hydratePostMedia: async rows => {
      const pending = Array.isArray(gate) ? gate[calls.length] : gate;
      calls.push(rows); if (pending) await pending.promise; if (denied) throw Error('Denied'); return safe(rows);
    } },
    './supabase/client': { createClient: () => client }, './withTimeout': { withTimeout: value => Promise.resolve(value) },
  }, { setInterval: () => 1, clearInterval() {} });
  return { ...h, calls, reads, view: id => h.render(() => useSharedPostPreview(id)), auth: () => auth(), get unsubscribed() { return unsubscribed; } };
}

test('web quotes and chat shares show stripped source text and type before optional author or media work finishes', async () => {
  const gate = deferred(), authorGate = deferred(), h = webSource({ gate, authorGate });
  assert.equal(h.view(postId), undefined); h.flush(); await tick();
  assert.equal(h.calls[0][0].post_id, postId); assert.equal(h.reads.some(item => item.table === 'profiles'), true);
  const initial = h.view(postId);
  assert.equal(initial.content, 'Original caption'); assert.equal(initial.media.media_type, 'video'); assert.equal(initial.mediaCount, 2);
  assert.equal(initial.media.url, ''); assert.equal(initial.media.thumbnail_url, null); assert.equal(initial.author, null);
  assert.equal(JSON.stringify(initial).includes('/storage/v1/object/public/'), false);
  authorGate.resolve(); await tick();
  assert.equal(h.view(postId).author.full_name, 'Source author'); assert.equal(h.view(postId).media.url, '');
  gate.resolve(); await tick(); const loaded = h.view(postId);
  assert.equal(loaded.media.thumbnail_url, signed('cover.jpg')); assert.equal(loaded.content, 'Original caption');
  assert.equal(loaded.author.full_name, 'Source author'); h.dispose(); assert.equal(h.unsubscribed, true);
});

test('granted web media appears while the author is pending and survives a later author response or failure', async () => {
  for (const rejected of [false, true]) {
    const authorGate = deferred(), h = webSource({ authorGate }); h.view(postId); h.flush(); await tick();
    assert.equal(h.view(postId).media.thumbnail_url, signed('cover.jpg'));
    assert.equal(h.view(postId).author, null);
    if (rejected) authorGate.reject(new Error('Profile timed out'));
    else authorGate.resolve({ data: { full_name: 'Late author', username: 'later' }, error: null });
    await tick();
    assert.equal(h.view(postId).media.thumbnail_url, signed('cover.jpg'));
    assert.equal(h.view(postId).author?.full_name ?? null, rejected ? null : 'Late author');
    h.dispose();
  }
});

test('late web author and grant responses cannot enrich a different source post', async () => {
  const firstMedia = deferred(), secondMedia = deferred(), firstAuthor = deferred(), secondAuthor = deferred();
  const h = webSource({ gate: [firstMedia, secondMedia], authorGate: [firstAuthor, secondAuthor] });
  h.view(postId); h.flush(); await tick(); assert.equal(h.view(postId).media.url, '');
  assert.equal(h.view(otherId), undefined); h.flush(); await tick();
  firstMedia.resolve(); firstAuthor.resolve({ data: { full_name: 'Obsolete author', username: 'old' }, error: null });
  await tick(); assert.equal(h.view(otherId).media.url, ''); assert.equal(h.view(otherId).author, null);
  secondMedia.resolve(); secondAuthor.resolve({ data: { full_name: 'Current author', username: 'current' }, error: null });
  await tick(); assert.equal(h.view(otherId).media.thumbnail_url, signed('cover.jpg'));
  assert.equal(h.view(otherId).author.full_name, 'Current author'); h.dispose();
});

test('an account round trip cannot resurrect grants or author labels from the previous request', async () => {
  const oldMedia = deferred(), currentMedia = deferred(), oldAuthor = deferred(), currentAuthor = deferred();
  const h = webSource({ gate: [oldMedia, currentMedia], authorGate: [oldAuthor, currentAuthor] });
  h.view(postId); h.flush(); await tick();
  h.auth(); h.auth(); assert.equal(h.view(postId), undefined); await tick();
  oldMedia.resolve(); oldAuthor.resolve({ data: { full_name: 'Stale account label', username: 'stale' }, error: null });
  await tick(); assert.equal(h.view(postId).media.url, ''); assert.equal(h.view(postId).author, null);
  currentMedia.resolve(); currentAuthor.resolve(); await tick();
  assert.equal(h.view(postId).media.thumbnail_url, signed('cover.jpg'));
  assert.equal(h.view(postId).author.full_name, 'Source author'); h.dispose();
});

test('an inaccessible web source never starts author or private-media enrichment', async () => {
  const h = webSource({ sourceMissing: true }); h.view(postId); h.flush(); await tick();
  assert.equal(h.view(postId), null); assert.equal(h.calls.length, 0);
  assert.equal(h.reads.some(item => item.table === 'profiles'), false); h.dispose();
});

test('web denied media keeps source text and type but never falls back to a canonical private URL', async () => {
  const h = webSource({ denied: true }); h.view(postId); h.flush(); await tick(); const result = h.view(postId);
  assert.equal(result.content, 'Original caption'); assert.equal(result.media.url, ''); assert.equal(result.media.thumbnail_url, null);
  assert.equal(preview.sharedPostImageUri(result.media), null); h.dispose();
});

test('web source changes and sign-out hide retained data before effects and ignore old granted responses', async () => {
  const h = webSource(); h.view(postId); h.flush(); await tick(); assert.ok(h.view(postId));
  assert.equal(h.view(otherId), undefined, 'An old source cannot render during the pre-effect frame'); h.flush(); await tick(); assert.ok(h.view(otherId));
  h.auth(); assert.equal(h.view(otherId), undefined); h.dispose(); await tick(); assert.equal(h.view(otherId), undefined);
  const gate = deferred(), pending = webSource({ gate }); pending.view(postId); pending.flush(); await tick();
  const beforeDisposal = plain(pending.view(postId)); pending.dispose(); gate.resolve(); await tick();
  assert.deepEqual(plain(pending.view(postId)), beforeDisposal, 'Disposed work cannot replace the safe preview with late granted media');
});

function nativeSharedSource({ gate, authorGate, denied = false, queued = false } = {}) {
  const source = fs.readFileSync(path.join(root,'src/screens/messages/ChatScreen.tsx'),'utf8');
  const ast = ts.createSourceFile('ChatScreen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback; const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('const request = sharedPostsRequest.current')) callback = node.arguments[0]; ts.forEachChild(node,visit); }; visit(ast); assert.ok(callback);
  let result = {}, navigationOwner = 'viewer:1', authorCount = 0;
  const calls = [], reads = [], updates = [], accountScopeRef = { current: 0 }, mountedRef = { current: true }, attachmentScopeRef = { current: 'chat-1' };
  const sharedPostsRequest = { current: { owner: 'viewer:1:chat-1', pending: new Set() } };
  const apply = value => { result = typeof value === 'function' ? value(result) : value; };
  const run = (ids = [postId]) => execute('module.exports = ' + callback.getText(ast), {}, {
    accountScopeRef, mountedRef, attachmentScopeRef, navigationScope: () => navigationOwner, sharedPostsRequest,
    sharedPostsOwner: sharedPostsRequest.current.owner, sharedPostIds: ids.join(','), sharedPostsMap: result,
    setSharedPostsMap: value => { if (queued) updates.push(value); else apply(value); }, sharedPostPreview: preview.sharedPostPreview, withoutPrivateMedia: strip,
    hydratePostMedia: async rows => { const pending = Array.isArray(gate) ? gate[calls.length] : gate; calls.push(rows); if (pending) await pending.promise; if (denied) throw Error('Denied'); return safe(rows); },
    supabase: { from(table) { const query = { select() { return query; }, in(_key,ids) {
      reads.push({ table, ids });
      if (table === 'posts') return Promise.resolve({ data: ids.map(row), error: null });
      const pending = Array.isArray(authorGate) ? authorGate[authorCount++] : authorGate;
      const authors = { data: [{ id: 'author', full_name: 'Source author' }], error: null };
      return pending ? pending.promise.then(value => value ?? authors) : Promise.resolve(authors);
    } }; return query; } },
  })();
  run();
  return {
    calls, reads, accountScopeRef, run, get result() { return result; }, get queued() { return updates.length; },
    cleanup() { mountedRef.current = false; }, flush() { while (updates.length) apply(updates.shift()); },
    changeNavigation(next) { navigationOwner = next; },
    changeConversation(next) { attachmentScopeRef.current = next; sharedPostsRequest.current = { owner: `viewer:1:${next}`, pending: new Set() }; },
  };
}

test('native chat publishes stripped source text and type before either independent author or media request finishes', async () => {
  const gate = deferred(), authorGate = deferred(), h = nativeSharedSource({ gate, authorGate }); await tick();
  assert.equal(h.calls[0][0].id, postId); assert.equal(h.reads.some(read => read.table === 'profiles'), true);
  assert.equal(h.result[postId].content, 'Original caption'); assert.equal(h.result[postId].media.media_type, 'video'); assert.equal(h.result[postId].mediaCount, 2);
  assert.equal(h.result[postId].media.url, ''); assert.equal(h.result[postId].media.thumbnail_url, null); assert.equal(h.result[postId].author, null);
  assert.equal(JSON.stringify(h.result).includes('/storage/v1/object/public/'), false);
  authorGate.resolve(); await tick(); assert.equal(h.result[postId].author.full_name, 'Source author'); assert.equal(h.result[postId].media.url, '');
  gate.resolve(); await tick(); assert.equal(h.result[postId].media.thumbnail_url, signed('cover.jpg')); assert.equal(h.result[postId].scope, 'viewer:1:chat-1'); assert.equal(h.result[postId].author.full_name, 'Source author'); h.cleanup();
});

test('native granted posters render while the author is pending and survive late profile success or failure', async () => {
  for (const denied of [false, true]) {
    const authorGate = deferred(), h = nativeSharedSource({ authorGate }); await tick();
    assert.equal(h.result[postId].media.thumbnail_url, signed('cover.jpg')); assert.equal(h.result[postId].author, null);
    if (denied) authorGate.reject(Error('Profile unavailable'));
    else authorGate.resolve({ data: [{ id: 'author', full_name: 'Late author' }], error: null });
    await tick(); assert.equal(h.result[postId].media.thumbnail_url, signed('cover.jpg'));
    assert.equal(h.result[postId].author?.full_name ?? null, denied ? null : 'Late author'); h.cleanup();
  }
});

test('native chat source failures strip private originals, and account switches reject late posters', async () => {
  const denied = nativeSharedSource({ denied: true }); await tick(); assert.equal(denied.result[postId].media.url, ''); assert.equal(denied.result[postId].media.thumbnail_url, null); denied.cleanup();
  const gate = deferred(), stale = nativeSharedSource({ gate }); await tick(); const stripped = plain(stale.result);
  stale.accountScopeRef.current++; gate.resolve(); await tick(); assert.deepEqual(plain(stale.result), stripped); stale.cleanup();
});

test('a new shared-post message does not cancel or duplicate existing pending source enrichment', async () => {
  const first = deferred(), second = deferred(), firstAuthor = deferred(), secondAuthor = deferred();
  const h = nativeSharedSource({ gate: [first,second], authorGate: [firstAuthor,secondAuthor] }); await tick();
  h.run([postId,otherId]); await tick();
  assert.deepEqual(plain(h.reads.filter(read => read.table === 'posts').map(read => read.ids)), [[postId],[otherId]]);
  assert.equal(h.result[postId].media.url, ''); assert.equal(h.result[otherId].media.url, '');
  first.resolve(); firstAuthor.resolve(); await tick();
  assert.equal(h.result[postId].media.thumbnail_url, signed('cover.jpg')); assert.equal(h.result[postId].author.full_name, 'Source author'); assert.equal(h.result[otherId].media.url, '');
  second.resolve(); secondAuthor.resolve(); await tick(); assert.equal(h.result[otherId].media.thumbnail_url, signed('cover.jpg'));
  h.run([postId,otherId]); await tick(); assert.equal(h.calls.length, 2); h.cleanup();
});

test('queued native source updaters cannot cross navigation scope, conversation lifetime or unmount', async () => {
  for (const invalidate of [h => h.changeNavigation('viewer:2'), h => { h.changeConversation('chat-2'); h.changeConversation('chat-1'); }, h => h.cleanup()]) {
    const gate = deferred(), authorGate = deferred(), h = nativeSharedSource({ gate, authorGate, queued: true }); await tick(); h.flush();
    const stripped = plain(h.result); gate.resolve(); authorGate.resolve(); await tick(); assert.equal(h.queued, 2);
    invalidate(h); h.flush(); assert.deepEqual(plain(h.result), stripped); h.cleanup();
  }
});
