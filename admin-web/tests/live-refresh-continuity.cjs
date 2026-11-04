const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : text(node?.props?.children || '');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const contractModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/liveOperations.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { module: contractModule, exports: contractModule.exports, Error, Date, Number });
const contract = contractModule.exports;

function harness(name, read = async () => ({ status: 200, data: { items: [] } })) {
  const slots = [], effects = [];
  let cursor = 0, dirty = true, tree, props = {};
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], update => { const next = typeof update === 'function' ? update(slots[i]) : update; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!same(old?.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useLayoutEffect(fn, deps) { hooks.useEffect(fn, deps); },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../components', name + '.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { fileName: name + '.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, Error, URLSearchParams, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto, window: { confirm: () => true },
    fetch: async (url, init) => { const result = await read(url, init); return { ok: result.status < 400, status: result.status, json: async () => result.data }; },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === './LiveOperations' || name === './LiveClipOperations') return { default: name };
      if (name === './LiveIcon') return { LiveIcon: 'icon' };
      if (name === '@/lib/liveOperations') return contract;
      if (name === '@/lib/liveClipOperations') return { staffClipStateFilters: [] };
      throw Error('Unexpected import: ' + name);
    },
  });
  const render = next => { if (next) { props = next; dirty = true; } let count = 0; while (dirty) { assert.ok(++count < 30); dirty = false; cursor = 0; tree = module.exports.default(props); effects.splice(0).forEach(fn => fn()); } return tree; };
  render();
  return { render, async flush() { for (let i = 0; i < 4; i++) { await tick(); render(); } },
    get tree() { return render(); }, get text() { return text(render()); }, button(label) { return nodes(render()).find(node => node.type === 'button' && text(node) === label); },
    buttons(label) { return nodes(render()).filter(node => node.type === 'button' && text(node) === label); },
    field(type, value) { const field = nodes(render()).find(node => node.type === type); assert.ok(field, type); if (value !== undefined) { field.props.onChange({ target: { value } }); render(); } return field.props.value; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('Live tabs mount lazily and preserve each visited desk at the same React position', () => {
  const h = harness('LiveWorkspace');
  const panel = id => nodes(h.tree).find(node => node.props?.id === 'live-panel-' + id);
  const broadcasts = panel('broadcasts').props.children;
  assert.equal(panel('clips').props.children, null);
  h.button('Clips and sharing').props.onClick(); h.render();
  assert.equal(panel('broadcasts').props.children.type, broadcasts.type);
  assert.equal(panel('broadcasts').props.hidden, true); assert.equal(panel('broadcasts').props.children.props.active, false);
  const clips = panel('clips').props.children;
  h.button('Broadcasts').props.onClick(); h.render();
  assert.equal(panel('clips').props.children.type, clips.type); assert.equal(panel('clips').props.hidden, true);
  assert.equal(panel('clips').props.children.props.active, false); assert.equal(panel('broadcasts').props.hidden, false);
  h.dispose();
});

for (const [component, recordKey] of [['LiveOperations', 'session'], ['LiveClipOperations', 'clip']]) {
  test(`${component} retains a reviewed record during reload and temporary failure, then clears an access refusal`, async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const item = { id, session_id: id, title: 'Confirmed record', state: 'live', formats: [] };
    let held, status = 200;
    const h = harness(component, async url => {
      const detail = new URL(url, 'http://local').searchParams.has(recordKey);
      if (detail && held) await held.promise;
      return { status: detail ? status : 200, data: detail ? status < 400 ? { [recordKey]: item, permissions: {} } : { error: 'Read unavailable' } : { items: [item] } };
    });
    await h.flush(); h.button('Review').props.onClick(); await h.flush();
    assert.ok(h.button('Refresh review'));
    held = deferred(); h.button('Refresh review').props.onClick(); h.render();
    assert.ok(h.button('Refresh review'), 'The loaded detail remains visible while its replacement is pending');
    status = 503; held.resolve(); await h.flush(); assert.ok(h.button('Refresh review'));
    held = null; status = 403; h.button('Refresh review').props.onClick(); await h.flush();
    assert.equal(h.button('Refresh review'), undefined);
    h.dispose();
  });
}

const firstId = '00000000-0000-4000-8000-000000000001', secondId = '00000000-0000-4000-8000-000000000002';
function reviewDesk(component) {
  const key = component === 'LiveOperations' ? 'session' : 'clip';
  const records = [firstId, secondId].map((id, index) => ({ id, session_id: firstId, title: 'Record ' + (index + 1), state: 'live', formats: [] }));
  const calls = []; let post = async () => ({ status: 200, data: { ok: true } }), detail = null;
  const h = harness(component, async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body });
    if (init?.method === 'POST') return post();
    const id = new URL(url, 'http://local').searchParams.get(key);
    if (id && detail) return detail(id, url);
    return { status: 200, data: id ? { [key]: records.find(record => record.id === id), permissions: { moderate: true } } : { items: records } };
  });
  return Object.assign(h, { calls, records, recordKey: key, setPost: next => { post = next; }, setDetail: next => { detail = next; },
    confirm() { h.button(component === 'LiveOperations' ? 'Send warning' : 'Approve clip').props.onClick(); h.render(); },
    detailResponse(id = firstId) { return { status: 200, data: { [key]: records.find(record => record.id === id), permissions: { moderate: true } } }; },
  });
}

for (const component of ['LiveOperations', 'LiveClipOperations']) {
  test(`${component} keeps reason and target on tab return, while a different selection clears the old draft`, async () => {
    const h = reviewDesk(component); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.field('textarea', 'Unsent review draft'); if (component === 'LiveOperations') h.field('input', secondId);
    h.render({ active: false }); const reads = h.calls.length; await h.flush(); assert.equal(h.calls.length, reads);
    h.render({ active: true }); await h.flush(); assert.equal(h.field('textarea'), 'Unsent review draft');
    if (component === 'LiveOperations') assert.equal(h.field('input'), secondId);
    h.buttons('Review')[1].props.onClick(); await h.flush(); assert.equal(h.field('textarea'), '');
    if (component === 'LiveOperations') assert.equal(h.field('input'), ''); h.dispose();
  });

  test(`${component} ignores command completion after hiding the desk and does not issue hidden reads`, async () => {
    const h = reviewDesk(component), pending = deferred(); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.field('textarea', 'Pending review'); h.setPost(() => pending.promise); h.confirm(); await h.flush();
    h.render({ active: false }); const count = h.calls.length; pending.resolve({ status: 200, data: { ok: true } }); await h.flush();
    assert.equal(h.calls.length, count); assert.doesNotMatch(h.text, /Action recorded|Review action recorded/);
    h.render({ active: true }); await h.flush(); assert.equal(h.field('textarea'), 'Pending review'); h.dispose();
  });

  test(`${component} fences an A-to-B-to-A command completion from the new draft`, async () => {
    const h = reviewDesk(component), pending = deferred(); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.field('textarea', 'Original draft'); h.setPost(() => pending.promise); h.confirm(); await h.flush();
    h.buttons('Review')[1].props.onClick(); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.field('textarea', 'New visit draft'); const count = h.calls.length;
    pending.resolve({ status: 200, data: { ok: true } }); await h.flush();
    assert.equal(h.calls.length, count); assert.equal(h.field('textarea'), 'New visit draft');
    assert.doesNotMatch(h.text, /Action recorded|Review action recorded/); h.dispose();
  });

  for (const edited of [false, true]) test(`${component} confirmed action clears its submitted draft and preserves later typing (${edited ? 'edited' : 'unchanged'})`, async () => {
    const h = reviewDesk(component), pending = deferred(); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.field('textarea', 'Submitted draft'); if (component === 'LiveOperations') h.field('input', secondId);
    h.setPost(() => pending.promise); h.confirm(); await h.flush();
    if (edited) { h.field('textarea', 'New unsent draft'); if (component === 'LiveOperations') h.field('input', firstId); }
    pending.resolve({ status: 200, data: { ok: true } }); await h.flush();
    assert.equal(h.field('textarea'), edited ? 'New unsent draft' : '');
    if (component === 'LiveOperations') assert.equal(h.field('input'), edited ? firstId : '');
    assert.match(h.text, /Action recorded|Review action recorded/); h.dispose();
  });

  test(`${component} authoritative removal clears the retained record and its draft`, async () => {
    const h = reviewDesk(component); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush(); h.field('textarea', 'Private draft');
    h.setDetail(async () => ({ status: 404, data: { error: 'This review is no longer available.' } }));
    h.button('Refresh review').props.onClick(); await h.flush(); assert.equal(h.button('Refresh review'), undefined);
    assert.equal(h.buttons('Review').length, 1, 'Remove the confirmed missing record from its directory');
    h.setDetail(null); h.buttons('Review')[0].props.onClick(); await h.flush(); assert.equal(h.field('textarea'), ''); h.dispose();
  });

  test(`${component} an authorization refusal also removes the retained directory`, async () => {
    const h = reviewDesk(component); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
    h.setDetail(async () => ({ status: 403, data: { error: 'Access denied' } })); h.button('Refresh review').props.onClick(); await h.flush();
    assert.equal(h.button('Refresh review'), undefined); assert.equal(h.buttons('Review').length, 0); h.dispose();
  });
}

test('clip action does not start a directory refresh after its follow-up review was hidden', async () => {
  const h = reviewDesk('LiveClipOperations'), pending = deferred(); await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush();
  h.field('textarea', 'Confirmed review'); h.setDetail(() => pending.promise); h.confirm(); await h.flush();
  h.render({ active: false }); const count = h.calls.length; pending.resolve(h.detailResponse()); await h.flush();
  assert.equal(h.calls.length, count); h.dispose();
});

test('returning to the clip desk cannot briefly restore the previous visit preview', async () => {
  const h = reviewDesk('LiveClipOperations');
  try {
    h.records[0].formats = ['vertical'];
    h.setDetail(async (id, url) => new URL(url, 'http://local').searchParams.has('format')
      ? { status: 200, data: { url: 'https://fixture.invalid/review.mp4', expires_at: new Date(Date.now() + 120000).toISOString() } } : h.detailResponse(id));
    await h.flush(); h.buttons('Review')[0].props.onClick(); await h.flush(); h.button('Preview vertical').props.onClick(); await h.flush();
    assert.ok(nodes(h.tree).some(node => node.type === 'video'));
    h.render({ active: false }); assert.equal(nodes(h.tree).some(node => node.type === 'video'), false);
    h.render({ active: true }); assert.equal(nodes(h.tree).some(node => node.type === 'video'), false, 'Old playback stays hidden before the re-entry effect runs');
    await h.flush();
  } finally { h.dispose(); }
});
