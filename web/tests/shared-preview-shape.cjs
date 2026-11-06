const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const base = 'https://synthetic.invalid';
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(code, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URL, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const preview = load(compile('../shared/sharedPostPreview.ts'));
const contentMedia = load(compile('../shared/contentMedia.ts'));
const { replaceContentMedia } = contentMedia;
const imageIdentity = load(compile('../shared/imageDisplayIdentity.ts'), {
  require(id) { if (id === './contentMedia') return contentMedia; throw new Error('Unexpected identity dependency: ' + id); },
});
const errors = load(compile('lib/errors.ts'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const original = name => base + '/storage/v1/object/public/post-media/' + name;
const capability = name => base + '/functions/v1/media-content/post-media/' + name + '?token=' + 'b'.repeat(64);
const source = (extra = {}) => ({ id: 'post', user_id: 'author', content: 'Fresh authorized source', body: null,
  created_at: '2026-11-02T12:00:00Z', media_url: null, image_url: null, post_media: [], ...extra });

function harness(initialRow, options = {}) {
  let row = initialRow, sourceRead = async () => ({ data: row, error: null }), authorRead = options.authorRead ?? (async () => ({ data: { full_name: 'Author', username: 'author' }, error: null }));
  let postId = 'post', cursor = 0, dirty = true, pending = [], value, interval;
  const slots = [], scopeListeners = new Set(), grants = [], reads = [];
  let session = { scope: 'owner:1', initialized: true };
  const navigation = {
    getSnapshot: () => session,
    getServerSnapshot: () => ({ scope: null, initialized: false }),
    subscribe(fn) { scopeListeners.add(fn); return () => scopeListeners.delete(fn); },
  };
  const client = {
    from(table) { let id; const query = { select() { return query; }, eq(_field, next) { id = next; return query; }, maybeSingle() { reads.push({ table, id }); return table === 'posts' ? sourceRead(id) : authorRead(id); } }; return query; } };
  const same = (a, b) => a && b && a.length === b.length && a.every((entry, index) => Object.is(entry, b[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { const nextValue = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(nextValue, slots[index])) { slots[index] = nextValue; dirty = true; } }]; },
    useEffect(fn, deps) { const index = cursor++, prior = slots[index]; if (!prior || !same(prior.deps, deps)) { slots[index] = { deps }; pending.push(() => { prior?.cleanup?.(); slots[index].cleanup = fn(); }); } },
    useSyncExternalStore(subscribe, getSnapshot) { hooks.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]); return getSnapshot(); },
  };
  const hook = load(compile('lib/useSharedPostPreview.ts'), {
    queueMicrotask, process: { env: { NEXT_PUBLIC_SUPABASE_URL: base } },
    setInterval(fn) { interval = fn; return 1; }, clearInterval() { interval = null; },
    require(id) {
      if (id === 'react') return hooks;
      if (id === '../../shared/sharedPostPreview') return preview;
      if (id === '../../shared/imageDisplayIdentity') return imageIdentity;
      if (id === './navigationCache') return { getNavigationStore: () => navigation };
      if (id === './errors') return errors;
      if (id === './supabase/client') return { createClient: () => client };
      if (id === './withTimeout') return { withTimeout: promise => Promise.resolve(promise) };
      if (id === './contentMedia') return {
        withoutPrivateMedia: rows => replaceContentMedia(rows, base, new Map()),
        hydratePostMedia: rows => { const wait = deferred(); grants.push({ rows, ...wait }); return wait.promise; },
      };
      throw new Error('Unexpected dependency: ' + id);
    },
  }).useSharedPostPreview;
  const h = {
    grants, reads, get value() { return value; },
    render() { let count = 0; while (dirty) { assert.ok(count++ < 20); dirty = false; cursor = 0; value = hook(postId); const work = pending; pending = []; work.forEach(fn => fn()); } return h; },
    async settle() { for (let index = 0; index < 4; index++) { await new Promise(setImmediate); h.render(); } return h; },
    grant(index, allowed) { const entry = grants[index], map = new Map(allowed ? allowed.map(name => ['post-media/' + name, capability(name)]) : []); entry.resolve(replaceContentMedia(entry.rows, base, map)); },
    refresh(next) { row = next; interval(); },
    auth(read) { sourceRead = read; session = { scope: 'new-owner:2', initialized: true }; for (const fn of scopeListeners) fn(); return h.render(); },
    sourceRead(read) { sourceRead = read; },
    setId(id) { postId = id; dirty = true; return h.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return h.render();
}

test('freshly authorized private legacy images and videos expose only type/count while grants are pending or denied', async () => {
  for (const [field, name, kind] of [['media_url', 'legacy.mp4', 'video'], ['image_url', 'legacy.jpg', 'image']]) {
    const h = harness(source({ [field]: original(name) })); await h.settle();
    assert.equal(h.value.media.media_type, kind); assert.equal(h.value.mediaCount, 1);
    assert.equal(h.value.media.url, ''); assert.equal(h.value.media.thumbnail_url, null);
    assert.equal(JSON.stringify(h.value).includes(original(name)), false);
    h.grant(0, []); await h.settle();
    assert.equal(h.value.media.media_type, kind); assert.equal(h.value.media.url, ''); assert.equal(h.value.mediaCount, 1);
    h.unmount();
  }
});

test('author and granted media enrich independently without replacing each other or exposing the original URL', async () => {
  for (const authorFirst of [false, true]) {
    const author = deferred(), h = harness(source({ media_url: original('legacy.jpg') }), { authorRead: () => author.promise });
    await h.settle(); assert.equal(h.value.author, null); assert.equal(h.value.media.url, '');
    const releaseAuthor = () => author.resolve({ data: { full_name: 'Granted author', username: 'source' }, error: null });
    if (authorFirst) releaseAuthor(); else h.grant(0, ['legacy.jpg']);
    await h.settle();
    assert.equal(h.value.media.url, authorFirst ? '' : capability('legacy.jpg'));
    assert.equal(h.value.author?.full_name ?? null, authorFirst ? 'Granted author' : null);
    if (authorFirst) h.grant(0, ['legacy.jpg']); else releaseAuthor();
    await h.settle(); assert.equal(h.value.author.full_name, 'Granted author'); assert.equal(h.value.media.url, capability('legacy.jpg'));
    assert.equal(JSON.stringify(h.value).includes(original('legacy.jpg')), false); h.unmount();
  }
});

test('a new authorized source with no media clears the previous shape and an absent source returns null', async () => {
  const h = harness(source({ media_url: original('legacy.jpg') })); await h.settle(); h.grant(0, []); await h.settle();
  h.refresh(source()); await h.settle(); assert.equal(h.value.media, null); assert.equal(h.value.mediaCount, 0);
  h.grant(1, []); await h.settle(); assert.equal(h.value.media, null);
  h.refresh(null); await h.settle(); assert.equal(h.value, null); h.unmount();
});

test('late grants cannot restore an old preview after an authorization session changes', async () => {
  const h = harness(source({ media_url: original('legacy.jpg') })); await h.settle();
  const nextSource = deferred(); h.auth(() => nextSource.promise); assert.equal(h.value, undefined);
  h.grant(0, ['legacy.jpg']); await h.settle(); assert.equal(h.value, undefined);
  nextSource.resolve({ data: null, error: null }); await h.settle(); assert.equal(h.value, null); h.unmount();
});

test('failed or unauthorized source reads never derive or publish a media shape', async () => {
  const h = harness(source({ media_url: original('legacy.jpg') }));
  h.sourceRead(async () => ({ data: source({ media_url: original('private.jpg') }), error: { message: 'denied' } }));
  h.setId('denied-post'); await h.settle(); assert.equal(h.value, null); assert.equal(h.grants.length, 0); h.unmount();
});
