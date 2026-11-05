const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, require(name) { if (!(name in imports)) throw Error(name); return imports[name]; } });
  return exports;
}
const content = load('shared/contentMedia.ts');
const { retainMemoryBookMedia } = load('web/lib/memoryReadiness.ts', { '../../shared/contentMedia': content });
const { watchStoryVideoFrame } = load('web/lib/storyMediaReadiness.ts');
const base = 'https://fixture.supabase.co', now = 1_000_000;
const canonical = name => `${base}/storage/v1/object/public/story-media/owner/${name}`;
const signed = name => `${base}/functions/v1/media-content/story-media/owner/${name}?token=${'a'.repeat(64)}`;
function book(delivered = false) {
  const url = delivered ? signed : canonical;
  const page = { id: 'page-a', story_id: 'story-a', media_type: 'video', media_url: url('clip.mp4'), thumbnail_url: url('poster.jpg'), media_transform: { trimStart: .4 }, caption: 'First memory' };
  return { id: 'book-a', user_id: 'owner', title: 'Before', is_owner: false, can_view: true,
    pages: [page], cover_page: { ...page }, cover_pages: [{ ...page }], soundtrack: null,
    ...(delivered ? { _mediaExpiresAt: now + 180_000 } : {}) };
}
const reuse = (previous, incoming, previousScope = 'owner:1', scope = previousScope) => retainMemoryBookMedia(previous, incoming, base, previousScope, scope, now);

test('a fresh allowed book response retains the exact no-store grants and updated title', () => {
  const previous = book(true), incoming = { ...book(), title: 'After' }, result = reuse(previous, incoming);
  assert.equal(result.title, 'After'); assert.equal(result.pages[0].media_url, signed('clip.mp4'));
  assert.equal(result.cover_page.thumbnail_url, signed('poster.jpg'));
  assert.equal(result._mediaExpiresAt, previous._mediaExpiresAt);
  assert.equal(incoming.pages[0].media_url, canonical('clip.mp4'));
});
test('expired, near-expiry and implausibly long book grants must renew', () => {
  for (const expiry of [undefined, now - 1, now + 60_000, NaN, Infinity, now + 300_001]) {
    const incoming = book(); assert.equal(reuse({ ...book(true), _mediaExpiresAt: expiry }, incoming), incoming);
  }
});
test('book identity, permission loss and session round trips cannot retain private grants', () => {
  for (const change of [{ id: 'book-b' }, { user_id: 'other' }, { can_view: false, is_owner: false }]) {
    const incoming = { ...book(), ...change }; assert.equal(reuse(book(true), incoming), incoming);
  }
  for (const [before, after] of [[null, null], ['owner:1', 'other:2'], ['owner:1', 'owner:3']]) {
    const incoming = book(); assert.equal(reuse(book(true), incoming, before, after), incoming);
  }
});
test('edited page media, trim and cover recipes require a fresh complete grant set', () => {
  for (const update of [
    row => { row.pages[0].media_url = canonical('replacement.mp4'); },
    row => { row.pages[0].media_transform.trimStart = 1; },
    row => { row.cover_page.thumbnail_url = canonical('new-poster.jpg'); },
    row => { row.pages.push({ ...row.pages[0], id: 'page-b' }); },
  ]) { const incoming = book(); update(incoming); assert.equal(reuse(book(true), incoming), incoming); }
});
test('partial, malformed and legacy storage grants are never retained as complete book delivery', () => {
  for (const url of [canonical('clip.mp4'), `${base}/storage/v1/object/sign/story-media/owner/clip.mp4?token=legacy`, signed('clip.mp4').replace(/a{64}$/, 'invalid')]) {
    const previous = book(true), incoming = book();
    previous.pages[0].media_url = url; previous.cover_page.media_url = url; previous.cover_pages[0].media_url = url;
    assert.equal(reuse(previous, incoming), incoming);
  }
});

function player({ frames = true } = {}) {
  const handlers = new Map(), callbacks = new Map(), cancelled = []; let serial = 0, ready = 0, current = true;
  const node = { isConnected: true, currentSrc: 'https://viewer.invalid/clip.mp4', ownerDocument: { baseURI: 'https://viewer.invalid/' },
    readyState: 1, currentTime: 0, seeking: false,
    addEventListener: (event, callback) => handlers.set(event, callback), removeEventListener: event => handlers.delete(event),
    ...(frames ? { requestVideoFrameCallback(callback) { callbacks.set(++serial, callback); return serial; }, cancelVideoFrameCallback(id) { cancelled.push(id); } } : {}),
  };
  const dispose = watchStoryVideoFrame(node, { source: '/clip.mp4', start: () => .4, current: () => current, ready: () => ready++ });
  return { node, handlers, callbacks, cancelled, dispose, get ready() { return ready; }, retire() { current = false; },
    emit(event) { handlers.get(event)?.(); }, frame(time) { callbacks.get(serial)(0, { mediaTime: time }); } };
}
test('story readiness waits for the matching decoded post-trim frame and emits once', () => {
  const h = player(); h.emit('loadeddata'); assert.equal(h.callbacks.size, 0);
  h.node.readyState = 2; h.node.currentTime = .4; h.emit('loadeddata'); h.frame(0); assert.equal(h.ready, 0);
  h.frame(.4); assert.equal(h.ready, 1); h.emit('canplay'); assert.equal(h.ready, 1); h.dispose();
});
test('retired, source-swapped and unmounted video callbacks cannot reveal another story', () => {
  for (const retire of [h => h.retire(), h => { h.node.currentSrc = 'https://viewer.invalid/other.mp4'; }, h => { h.node.isConnected = false; }, h => h.dispose()]) {
    const h = player(); h.node.readyState = 2; h.node.currentTime = .4; h.emit('loadeddata'); retire(h); h.frame(.4);
    assert.equal(h.ready, 0); h.dispose(); assert.equal(h.handlers.size, 0);
  }
});
test('browsers without frame callbacks still wait for decoded data and the completed trim seek', () => {
  const h = player({ frames: false }); h.node.readyState = 2; h.emit('loadeddata'); assert.equal(h.ready, 0);
  h.node.currentTime = .4; h.node.seeking = true; h.emit('canplay'); assert.equal(h.ready, 0);
  h.node.seeking = false; h.emit('seeked'); assert.equal(h.ready, 1); h.dispose();
});

test('adaptive source ownership permits decoded HLS frames and rejects retired attachments', () => {
  let owns = true, ready = 0;
  const handlers = new Map();
  const node = { isConnected: true, currentSrc: 'blob:https://viewer.invalid/hls-session', ownerDocument: { baseURI: 'https://viewer.invalid/' }, readyState: 2, currentTime: 1, seeking: false,
    addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name) };
  const dispose = watchStoryVideoFrame(node, { source: '/original.mp4', matchesSource: () => owns, start: () => 0, current: () => true, ready: () => ready++ });
  assert.equal(ready, 1); dispose(); ready = 0; owns = false;
  const retired = watchStoryVideoFrame(node, { source: '/original.mp4', matchesSource: () => owns, start: () => 0, current: () => true, ready: () => ready++ });
  handlers.get('loadeddata')(); assert.equal(ready, 0); retired();
});
