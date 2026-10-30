const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const choice = { soundId: '11111111-1111-4111-8111-111111111111', startSec: 2, durationSec: 5, volume: .7, originalVolume: 1 };
const other = { ...choice, soundId: '22222222-2222-4222-8222-222222222222', startSec: 8 };
function moduleFrom(source, context = {}) { const exports = {}; vm.runInNewContext(compile(source), { exports, Error, AbortController, ...context }); return exports; }
const soundtrack = moduleFrom(read('shared/soundtrack.ts'));

function setup(options = {}) {
  let cursor = 0, dirty = true, mounted = true, result, id = 0;
  const slots = [], effects = [], timers = new Map(), listeners = new Set(), calls = [], confirmed = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }]; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) { slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  let session = { user: { id: 'owner-a' }, access_token: 'fixture-token-a' }, stored = null;
  const client = {
    auth: { getSession: () => options.session ? options.session() : Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
    },
    rpc(name, args) {
      const call = { name, args, header: null, signal: null }; calls.push(call);
      const query = { setHeader(key, value) { call.header = [key, value]; return query; }, abortSignal(signal) { call.signal = signal; return query; },
        then(resolve, reject) { return Promise.resolve().then(async () => {
          if (options.rpc) return options.rpc(call);
          if (name === 'save_memory_book_soundtrack') { stored = args.p_soundtrack; return { data: null, error: null }; }
          return { data: { id: args.p_album, user_id: session.user.id, is_owner: true, soundtrack: stored }, error: null };
        }).then(resolve, reject); },
      }; return query;
    },
  };
  const props = { client, owner: 'owner-a', book: 'book-a', route: 'route-a', canEdit: true, onConfirmed: (book, selection) => confirmed.push({ book, selection }), ...options.props };
  const module = moduleFrom(read('shared/useMemorySoundtrackSave.ts'), { require(name) { assert.equal(name, './soundtrack'); return soundtrack; }, setTimeout(fn, milliseconds) { timers.set(++id, { fn, milliseconds }); return id; }, clearTimeout(key) { timers.delete(key); } });
  const useSave = module.createMemorySoundtrackSaveHook(react);
  function render(force = false) {
    if (!mounted) return result;
    if (force) dirty = true;
    let n = 0;
    while (dirty) { assert.ok(++n < 40, 'save hook render settles'); dirty = false; cursor = 0; result = useSave(props); while (effects.length) effects.shift()(); }
    return result;
  }
  render();
  return { props, calls, confirmed, timers, get value() { return render(); }, render,
    update(next) { Object.assign(props, next); render(true); },
    setStored(value) { stored = value; },
    auth(owner, event = 'SIGNED_IN') { session = owner ? { user: { id: owner }, access_token: 'fixture-token-' + owner } : null; for (const listener of listeners) listener(event, session); },
    timeout() { for (const timer of [...timers.values()]) { assert.equal(timer.milliseconds, 20000); timer.fn(); } },
    async flush() { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    dispose() { if (mounted) { mounted = false; slots.forEach(slot => slot?.cleanup?.()); } },
  };
}

test('book music saves serialize same-frame choices and confirm the actual row before reporting success', async () => {
  const write = deferred(), check = deferred();
  const h = setup({ rpc: call => call.name === 'save_memory_book_soundtrack' ? write.promise : check.promise });
  const save = h.value.save, pending = save(choice); await save(other); await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.value.busy, true); assert.equal(h.confirmed.length, 0);
  assert.equal(h.calls[0].args.p_album, 'book-a'); assert.deepEqual(Array.from(h.calls[0].header), ['Authorization', 'Bearer fixture-token-a']);
  write.resolve({ error: null }); await h.flush(); assert.equal(h.confirmed.length, 0);
  check.resolve({ data: { id: 'book-a', user_id: 'owner-a', is_owner: true, soundtrack: choice }, error: null }); await pending; await h.flush();
  assert.equal(h.confirmed[0].selection.soundId, choice.soundId); assert.equal(h.value.draft, null); assert.equal(h.value.busy, false); assert.match(h.value.notice, /saved/); assert.equal(h.timers.size, 0); h.dispose();
});

test('a returned book music rejection keeps the draft and confirms the saved value before retrying', async () => {
  let reject = true, stored = null;
  const h = setup({ rpc: async call => {
    if (call.name === 'save_memory_book_soundtrack') {
      if (reject) return { error: { code: '42501' } };
      stored = call.args.p_soundtrack; return { error: null };
    }
    return { data: { id: 'book-a', is_owner: true, soundtrack: stored }, error: null };
  } });
  await h.value.save(choice); await h.flush();
  assert.equal(h.confirmed.length, 0); assert.equal(h.value.draft.selection.soundId, choice.soundId); assert.equal(h.value.needsConfirmation, true);
  reject = false; await h.value.retry(); await h.flush();
  assert.equal(h.confirmed[0].selection, null); assert.equal(h.value.needsConfirmation, false); assert.equal(h.calls.filter(call => call.name === 'save_memory_book_soundtrack').length, 1);
  await h.value.retry(); await h.flush(); assert.equal(h.confirmed.at(-1).selection.soundId, choice.soundId); assert.equal(h.calls.filter(call => call.name === 'save_memory_book_soundtrack').length, 2); h.dispose();
});

test('resolved network and proxy errors after a committed book write recover with a read only', async () => {
  for (const status of [0, 502, 504]) {
    let stored = null;
    const h = setup({ rpc: async call => {
      if (call.name === 'save_memory_book_soundtrack') {
        stored = call.args.p_soundtrack;
        return { data: null, error: { message: 'The response could not be delivered.' }, status };
      }
      return { data: { id: 'book-a', is_owner: true, soundtrack: stored }, error: null };
    } });
    await h.value.save(choice); assert.equal(h.value.needsConfirmation, true); assert.equal(h.confirmed.length, 0);
    await h.value.save(other); assert.equal(h.calls.length, 1);
    await h.value.retry(); await h.flush();
    assert.equal(h.calls.filter(call => call.name === 'save_memory_book_soundtrack').length, 1);
    assert.equal(h.calls.at(-1).name, 'get_memory_book'); assert.equal(h.confirmed[0].selection.soundId, choice.soundId); assert.equal(h.value.draft, null); h.dispose();
  }
});

test('an uncertain book write requires a read and cannot replay or replace its soundtrack blindly', async () => {
  const h = setup({ rpc: async call => {
    if (call.name === 'save_memory_book_soundtrack') throw new Error('response lost after commit');
    return { data: { id: 'book-a', is_owner: true, soundtrack: choice }, error: null };
  } });
  await h.value.save(choice); await h.flush(); assert.equal(h.value.needsConfirmation, true); assert.equal(h.value.draft.selection.soundId, choice.soundId);
  await h.value.save(other); assert.equal(h.calls.length, 1);
  await h.value.retry(); await h.flush(); assert.equal(h.calls.filter(call => call.name === 'save_memory_book_soundtrack').length, 1); assert.equal(h.calls.at(-1).name, 'get_memory_book'); assert.equal(h.value.draft, null); assert.equal(h.confirmed.length, 1); h.dispose();
});

test('a recovered different server value remains authoritative while the unsaved book choice is retained', async () => {
  let writeFailed = false, server = other;
  const h = setup({ rpc: async call => {
    if (call.name === 'save_memory_book_soundtrack') {
      if (!writeFailed) { writeFailed = true; throw new Error('offline'); }
      server = call.args.p_soundtrack; return { error: null };
    }
    return { data: { id: 'book-a', is_owner: true, soundtrack: server }, error: null };
  } });
  await h.value.save(choice); await h.value.retry(); await h.flush();
  assert.equal(h.confirmed[0].selection.soundId, other.soundId); assert.equal(h.value.draft.selection.soundId, choice.soundId); assert.equal(h.value.needsConfirmation, false); assert.match(h.value.error, /different soundtrack/);
  await h.value.retry(); await h.flush(); assert.equal(h.confirmed.at(-1).selection.soundId, choice.soundId); assert.equal(h.value.draft, null); h.dispose();
});

test('a successful book write with a failed confirmation retries only the read', async () => {
  let fail = true;
  const h = setup({ rpc: async call => {
    if (call.name === 'save_memory_book_soundtrack') return { error: null };
    if (fail) throw new Error('confirmation offline');
    return { data: { id: 'book-a', is_owner: true, soundtrack: choice }, error: null };
  } });
  await h.value.save(choice); assert.equal(h.value.needsConfirmation, true); fail = false; await h.value.retry();
  assert.equal(h.calls.filter(call => call.name === 'save_memory_book_soundtrack').length, 1); assert.equal(h.confirmed.length, 1); h.dispose();
});

test('book music removal is confirmed as null and retains its removal draft on failure', async () => {
  let fail = true;
  const h = setup({ rpc: async call => call.name === 'save_memory_book_soundtrack'
    ? { error: fail ? { code: '42501' } : null }
    : { data: { id: 'book-a', is_owner: true, soundtrack: null }, error: null } });
  await h.value.save(null); assert.equal(h.value.draft.selection, null); assert.equal(h.confirmed.length, 0);
  fail = false; await h.value.retry(); assert.equal(h.confirmed[0].selection, null); assert.match(h.value.notice, /removed/); h.dispose();
});

test('one deadline bounds stalled book authentication without sending a later write', async () => {
  const session = deferred(), h = setup({ session: () => session.promise }), work = h.value.save(choice);
  await h.flush(); h.timeout(); await work; await h.flush();
  assert.equal(h.value.busy, false); assert.equal(h.value.needsConfirmation, false); assert.equal(h.value.draft.selection.soundId, choice.soundId);
  session.resolve({ data: { session: { user: { id: 'owner-a' }, access_token: 'late' } }, error: null }); await h.flush(); assert.equal(h.calls.length, 0); h.dispose();
});

test('book write timeout aborts transport, preserves the draft and ignores late completion', async () => {
  const gate = deferred(), h = setup({ rpc: () => gate.promise }), work = h.value.save(choice); await h.flush(); h.timeout(); await work; await h.flush();
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(h.value.needsConfirmation, true); assert.equal(h.value.busy, false);
  gate.resolve({ error: null }); await h.flush(); assert.equal(h.calls.length, 1); assert.equal(h.confirmed.length, 0); h.dispose();
});

test('malformed, wrong-book, wrong-owner and non-owner confirmations never become saved state', async () => {
  for (const data of [
    { id: 'other-book', is_owner: true, soundtrack: choice },
    { id: 'book-a', user_id: 'other-owner', is_owner: true, soundtrack: choice },
    { id: 'book-a', is_owner: false, soundtrack: choice },
    { id: 'book-a', is_owner: true },
    { id: 'book-a', is_owner: true, soundtrack: { ...choice, durationSec: NaN } },
  ]) {
    const h = setup({ rpc: async call => call.name === 'save_memory_book_soundtrack' ? { error: null } : { data, error: null } });
    await h.value.save(data.soundtrack === undefined ? null : choice); assert.equal(h.confirmed.length, 0); assert.equal(h.value.needsConfirmation, true); h.dispose();
  }
});

test('route changes invalidate late book writes and old-render save callbacks', async () => {
  const gate = deferred(), h = setup({ rpc: () => gate.promise }), oldSave = h.value.save, work = oldSave(choice); await h.flush();
  h.update({ book: 'book-b', route: 'route-b' }); await oldSave(other);
  gate.resolve({ error: null }); await work; await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmed.length, 0); assert.equal(h.value.draft, null); assert.equal(h.value.error, ''); h.dispose();
});

test('an account round trip before a render cannot revive a book soundtrack save', async () => {
  const gate = deferred(), h = setup({ rpc: () => gate.promise }), work = h.value.save(choice); await h.flush();
  h.auth('owner-b'); h.auth('owner-a'); gate.resolve({ error: null }); await work; await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmed.length, 0); assert.equal(h.value.draft, null); assert.equal(h.calls[0].signal.aborted, true); h.dispose();
});

test('book save readback keeps the initiating token through a harmless token refresh', async () => {
  const gate = deferred(), h = setup({ rpc: async call => call.name === 'save_memory_book_soundtrack' ? gate.promise : { data: { id: 'book-a', is_owner: true, soundtrack: choice }, error: null } });
  const work = h.value.save(choice); await h.flush(); h.auth('owner-a', 'TOKEN_REFRESHED'); gate.resolve({ error: null }); await work;
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => call.header[1] === 'Bearer fixture-token-a')); assert.equal(h.confirmed.length, 1); h.dispose();
});

test('unmount during book write or confirmation produces no late UI update', async () => {
  for (const phase of ['save_memory_book_soundtrack', 'get_memory_book']) {
    const gate = deferred(), h = setup({ rpc: async call => call.name === phase ? gate.promise : { error: null } });
    const work = h.value.save(choice); await h.flush(); h.dispose();
    gate.resolve({ data: { id: 'book-a', is_owner: true, soundtrack: choice }, error: null }); await work; await h.flush();
    assert.equal(h.confirmed.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('non-owners, mismatched sessions and invalid soundtrack recipes cannot write book music', async () => {
  for (const options of [{ props: { canEdit: false } }, { props: { owner: null } }, { props: { owner: 'different-owner' } }]) {
    const h = setup(options); await h.value.save(choice); assert.equal(h.calls.length, 0); h.dispose();
  }
  const h = setup(); await h.value.save({ ...choice, durationSec: NaN }); assert.equal(h.calls.length, 0); assert.match(h.value.error, /again/); h.dispose();
});

const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const words = node => Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? words(node.props?.children) : '';
for (const platform of ['native', 'web']) {
  const file = platform === 'native' ? 'src/screens/profile/MemoryAlbumScreen.tsx' : 'web/components/MemoryAlbum.tsx';
  test(platform + ' book music controls retain failed choices and expose bounded save/status recovery', () => {
    const source = read(file), retryCalls = [], selected = [], opened = [];
    const lines = source.split('\n').filter(line => line.includes('aria-label="Book soundtrack"') || line.includes('accessibilityLabel="Book soundtrack"') || line.trimStart().startsWith('{musicOpen&&uid&&album.is_owner?') || line.trimStart().startsWith('{soundtrackSave.busy ?'));
    assert.ok(lines.length >= 2);
    const state = { draft: { selection: choice, retry: 'check' }, error: 'Save could not be confirmed.', busy: false, needsConfirmation: true, save: value => selected.push(value), retry: () => retryCalls.push(true) };
    const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
    const scope = { require: () => runtime, album: { id: 'book-a', is_owner: true, soundtrack: other }, viewerId: 'owner-a', uid: 'owner-a', musicOpen: true,
      soundtrackSave: state, setMusicOpen: value => opened.push(value), t: { ink: { primary: '#000', secondary: '#333' } }, SoundtrackPicker: 'Picker', TouchableOpacity: 'button', View: 'div', Text: 'span' };
    const panel = moduleFrom('export const panel = () => <>' + lines.join('\n') + '</>;', scope).panel;
    let nodes = walk(panel());
    const music = nodes.find(node => (node.props?.accessibilityLabel || node.props?.['aria-label']) === 'Book soundtrack'); assert.equal(music.props.disabled, true);
    const picker = nodes.find(node => node.type === 'Picker'); assert.equal(picker.props.value, choice); picker.props.onChange(null); assert.equal(selected[0], null);
    const retry = nodes.find(node => node.type === 'button' && words(node) === 'Check saved music'); assert.ok(retry); (retry.props.onPress || retry.props.onClick)(); assert.equal(retryCalls.length, 1);
    state.draft = null; state.error = ''; state.needsConfirmation = false; state.notice = 'Book soundtrack saved.'; nodes = walk(panel()); assert.ok(nodes.some(node => words(node) === state.notice));
  });

  test(platform + ' confirmed book soundtrack updates only that book and cancels stale full-book reads', () => {
    const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useMemorySoundtrackSave') callback = node.arguments[0].properties.find(property => property.name.getText(ast) === 'onConfirmed').initializer.getText(ast); ts.forEachChild(node, visit); }
    visit(ast); assert.ok(callback);
    const pages = [{ id: 'page-one' }], loadGeneration = { current: 4 }; let album = { id: 'book-a', is_owner: true, soundtrack: other, pages };
    const run = moduleFrom('export const run = ' + callback, { loadGeneration, setAlbum: update => { album = update(album); } }).run;
    run('book-a', choice); assert.equal(album.soundtrack, choice); assert.equal(album.pages, pages); assert.equal(loadGeneration.current, 5);
    run('book-b', null); assert.equal(album.soundtrack, choice);
  });
}
