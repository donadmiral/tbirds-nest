const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual sheet with a small deterministic hook/native boundary.
// No renderer, network, biometric module or real connection code is used.
function harness() {
  let ownerId = 'account-a', cursor = 0, tree, mounted = true, stateWrites = 0;
  const slots = [], effects = [], requests = [], alerts = [];
  let linked = 0, closed = 0;
  let props = { visible: true, onLinked: () => linked++, onClose: () => closed++ };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { assert.equal(mounted, true, 'no setState after unmount'); stateWrites++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useCallback(callback, deps) { return React.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const prior = slots[index]; slots[index] = { deps, callback };
        effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const useAuthStore = selector => selector(useAuthStore.getState());
  useAuthStore.getState = () => ({ session: { user: { id: ownerId } } });
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/components/LinkIntoBankSheet.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const context = { exports: {}, require(name) {
    if (name === 'react') return { __esModule: true, default: React, ...React };
    if (name === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'Modal', 'TextInput', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name])), Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === '../theme/useTheme') return { themedSheet: factory => factory({ surface: { canvas: '', raised: '', hairline: '' }, ink: { inverse: '', primary: '', secondary: '' }, brand: { base: '' } }), useTheme: () => ({}), getTheme: () => ({ ink: { inverse: '', primary: '', secondary: '' } }) };
    if (name === '../stores/authStore') return { useAuthStore };
    if (name === '../services/paymentsService') return { paymentsService: { linkAccount(code, owner) {
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ code, owner, resolve, reject }); return promise;
    } } };
    throw new Error('Unexpected dependency ' + name);
  } };
  vm.runInNewContext(source, context);
  const render = () => { cursor = 0; tree = context.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  const find = (type, node = tree) => {
    if (node && node.type === type) return node;
    for (const child of node?.props?.children.flat(Infinity) || []) { const answer = find(type, child); if (answer) return answer; }
  };
  render();
  return {
    requests, alerts,
    get linked() { return linked; }, get closed() { return closed; }, get stateWrites() { return stateWrites; },
    setOwner(value) { ownerId = value; render(); },
    setVisible(value) { props = { ...props, visible: value }; render(); },
    submit() { render(); find('TextInput').props.onChangeText('ABCDEF12'); render(); return find('TouchableOpacity').props.onPress(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; },
  };
}

test('only the current sheet reports a confirmed successful link', async () => {
  const h = harness(); const work = h.submit();
  assert.equal(h.requests[0].owner, 'account-a');
  h.requests[0].resolve({ success: true }); await work;
  assert.equal(h.linked, 1); assert.equal(h.closed, 1); assert.equal(h.alerts[0][0], 'Connected');
});

test('an A-to-B-to-A account switch invalidates the old link completion', async () => {
  const h = harness(); const old = h.submit();
  h.setOwner('account-b'); h.setOwner('account-a');
  const fresh = h.submit();
  h.requests[0].resolve({ success: true }); await old;
  assert.equal(h.linked, 0); assert.equal(h.closed, 0); assert.equal(h.alerts.length, 0);
  await h.submit(); assert.equal(h.requests.length, 2, 'old completion cannot unlock the new operation');
  h.requests[1].resolve({ success: true }); await fresh;
  assert.equal(h.linked, 1);
});

test('dismissal and reopening invalidate the former sheet operation', async () => {
  const h = harness(); const old = h.submit();
  h.setVisible(false); h.setVisible(true);
  h.requests[0].resolve({ success: true }); await old;
  assert.equal(h.linked, 0); assert.equal(h.alerts.length, 0);
});

test('errors from an old account or unmounted sheet do not raise stale alerts or state writes', async () => {
  for (const invalidate of [h => h.setOwner('account-b'), h => h.unmount()]) {
    const h = harness(); const work = h.submit(); invalidate(h);
    const writes = h.stateWrites;
    h.requests[0].reject(new Error('Expired code')); await work;
    assert.equal(h.alerts.length, 0); assert.equal(h.stateWrites, writes);
  }
});
