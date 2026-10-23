const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

// Actual component, with deterministic hooks and synthetic service boundaries.
// The mocked service retains confirmed intent cleanup even after UI invalidation.
function harness({ linked = true, holdPrepare = false, initialOwner = 'account-a' } = {}) {
  let ownerId = initialOwner, cursor = 0, tree, mounted = true, writes = 0;
  let savedIntent = null, status = { status: 'not_found' }, holdStatus = false;
  const slots = [], effects = [], sends = [], links = [], statuses = [], prepares = [], clears = [], alerts = [], balances = [];
  let sent = 0, closed = 0, requested = 0;
  let checkoutOverride;
  const checkouts = [];
  const orders = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../shared/marketOrders.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: orders.exports, module: orders });
  let props = { visible: true, recipientId: 'recipient', recipientName: 'Recipient', conversationId: 'conversation', initialAmount: 12,
    onSent: () => sent++, onClose: () => closed++, onRequested: () => requested++ };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        assert.equal(mounted, true, 'no state update after unmount'); writes++;
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
      }];
    },
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
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
  const services = {
    async getPendingIntent(input) { return savedIntent?.ownerId === input.ownerId ? savedIntent : null; },
    async getBalance(owner) { balances.push(owner); return { linked, available: 100, currency: 'USD' }; },
    async peerLinked() { return true; },
    async prepareIntent(input) {
      const request = deferred(); prepares.push({ ...request, input });
      if (holdPrepare) await request.promise;
      savedIntent = { ...input, idempotencyKey: 'same-intent-reference', version: 1, createdAt: '2026-10-17T00:00:00Z' };
      return savedIntent;
    },
    getPaymentStatus(intent) { const request = deferred(); statuses.push({ ...request, intent }); return holdStatus ? request.promise : Promise.resolve(status); },
    sendMoney(intent) { const request = deferred(); sends.push({ ...request, intent }); return request.promise; },
    linkAccount(code, owner) { const request = deferred(); links.push({ ...request, code, owner }); return request.promise; },
    async clearIntent(intent) { clears.push(intent); if (savedIntent?.idempotencyKey === intent.idempotencyKey) savedIntent = null; },
  };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/components/SendMoneySheet.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const context = { exports: {}, require(name) {
    if (name === 'react') return { __esModule: true, default: React, ...React };
    if (name === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'Modal', 'TextInput', 'ActivityIndicator', 'KeyboardAvoidingView', 'Image'].map(x => [x, x])), Platform: { OS: 'ios' }, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === '../theme/useTheme') return { themedSheet: factory => factory({ surface: { canvas: '', raised: '', hairline: '' }, ink: { inverse: '', primary: '', secondary: '' }, brand: { base: '' } }), useTheme: () => ({}), getTheme: () => ({ ink: { inverse: '', primary: '', secondary: '' } }) };
    if (name === '../stores/authStore') return { useAuthStore };
    if (name === '../../shared/marketOrders') return orders.exports;
    if (name === '../services/supabase') return { supabase: { async rpc(name, args) {
      assert.ok(['get_market_order', 'get_market_checkout'].includes(name)); checkouts.push({ name, args });
      return checkoutOverride ?? { error: null, data: { id: props.orderId ?? 'accepted-order', buyer_id: ownerId, seller_id: props.recipientId,
        conversation_id: props.conversationId, listing_id: props.listingId, status: 'awaiting_payment', currency: 'USD', total_minor: '1250' } };
    } } };
    if (name === '../services/paymentsService') return { paymentsService: services };
    if (name === '../services/flagsService') return { flagsService: { isEnabled: async () => true } };
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name.endsWith('intobank-mark.png')) return 'logo';
    throw new Error('Unexpected dependency ' + name);
  } };
  vm.runInNewContext(source, context);
  const render = () => { cursor = 0; tree = context.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  const all = (node = tree) => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(all);
    return [node, ...all(node.props?.children)];
  };
  const text = node => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : '';
  };
  const button = label => all().find(n => n.type === 'TouchableOpacity' && text(n) === label);
  render();
  return {
    sends, links, statuses, prepares, clears, alerts, balances, checkouts,
    setCheckout(value) { checkoutOverride = value; },
    get sent() { return sent; }, get closed() { return closed; }, get writes() { return writes; }, get requested() { return requested; },
    get busy() { render(); return all().find(n => n.type === 'TouchableOpacity' && n.props.activeOpacity === 1).props.disabled; },
    get text() { render(); return text(tree); },
    get savedIntent() { return savedIntent; },
    async ready() { await flush(); render(); },
    setOwner(value) { ownerId = value; render(); },
    setProps(value) { props = { ...props, ...value }; render(); },
    setStatus(value, hold = false) { status = value; holdStatus = hold; },
    press(label) { render(); const node = button(label); assert.ok(node, 'Button present: ' + label); return node.props.onPress(); },
    enterCode() { render(); all().find(n => n.type === 'TextInput').props.onChangeText('ABCDEF12'); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; },
  };
}
const completed = { status: 'completed', tx_id: 'synthetic-transaction', currency: 'USD' };

test('current payment completes once and retains the prepared reference', async () => {
  const h = harness(); await h.ready();
  const work = h.press('Pay'); await flush();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].intent.idempotencyKey, 'same-intent-reference');
  h.sends[0].resolve(completed); await work;
  assert.equal(h.sent, 1); assert.equal(h.closed, 1); assert.equal(h.clears.length, 1);
  assert.equal(h.savedIntent, null); assert.equal(h.busy, false);
});

test('a signed-out sheet exits loading with its existing sign-in error and no requests', async () => {
  const h = harness({ initialOwner: '' }); await h.ready();
  assert.ok(h.text.includes('Sign in before opening a payment.'));
  assert.equal(h.balances.length, 0); assert.equal(h.statuses.length, 0); assert.equal(h.sends.length, 0);
});

for (const transition of ['reopen', 'account ABA', 'conversation ABA']) {
  test('old completed payment cannot own a new sheet after ' + transition, async () => {
    const h = harness(); await h.ready();
    const old = h.press('Pay'); await flush();
    h.setStatus({ status: 'pending' });
    if (transition === 'reopen') { h.setProps({ visible: false }); h.setProps({ visible: true }); }
    if (transition === 'account ABA') { h.setOwner('account-b'); h.setOwner('account-a'); }
    if (transition === 'conversation ABA') { h.setProps({ conversationId: 'other' }); h.setProps({ conversationId: 'conversation' }); }
    await h.ready();
    assert.equal(h.busy, false, 'new sheet is not held by the old operation');
    h.setStatus({ status: 'pending' }, true);
    const fresh = h.press('Check status'); await flush();
    const currentStatus = h.statuses.at(-1);
    assert.equal(h.busy, true);
    h.sends[0].resolve(completed); await old;
    assert.equal(h.sent, 0); assert.equal(h.closed, 0);
    assert.equal(h.clears.length, 1, 'confirmed old intent still clears safely');
    assert.equal(h.busy, true, 'old finally cannot unlock a new operation');
    assert.equal(h.sends.length, 1, 'reopening never sends again');
    currentStatus.resolve({ status: 'pending' }); await fresh;
    assert.equal(h.busy, false);
  });
}

for (const transition of ['reopen', 'listing', 'recipient']) {
  test('stale preparation cannot dispatch a payment after ' + transition, async () => {
    const h = harness({ holdPrepare: true }); await h.ready();
    const work = h.press('Pay'); await flush();
    if (transition === 'reopen') { h.setProps({ visible: false }); h.setProps({ visible: true }); }
    if (transition === 'listing') h.setProps({ listingId: 'other-listing' });
    if (transition === 'recipient') h.setProps({ recipientId: 'other-recipient' });
    await h.ready();
    h.prepares[0].resolve(); await flush();
    assert.equal(h.sends.length, 0);
    assert.equal(h.statuses.length, 0);
    assert.equal(h.savedIntent.idempotencyKey, 'same-intent-reference', 'prepared reference remains recoverable');
    await work;
  });
}

test('late failed send cannot replace reopened recovery state', async () => {
  const h = harness(); await h.ready();
  const work = h.press('Pay'); await flush();
  h.setStatus({ status: 'pending' });
  h.setProps({ visible: false }); h.setProps({ visible: true }); await h.ready();
  h.sends[0].reject(new Error('stale network failure')); await work;
  assert.equal(h.text.includes('stale network failure'), false);
  assert.equal(h.sent, 0); assert.equal(h.closed, 0);
});

test('unmounted payment completion preserves intent cleanup without UI writes', async () => {
  const h = harness(); await h.ready();
  const work = h.press('Pay'); await flush(); h.unmount(); const writes = h.writes;
  h.sends[0].resolve(completed); await work;
  assert.equal(h.clears.length, 1); assert.equal(h.writes, writes);
  assert.equal(h.sent, 0); assert.equal(h.closed, 0);
});

test('stale linking completion skips wallet lookup and cannot unlock a newer link', async () => {
  const h = harness({ linked: false }); await h.ready(); h.enterCode();
  const old = h.press('Connect approved account'); await flush();
  h.setProps({ visible: false }); h.setProps({ visible: true }); await h.ready(); h.enterCode();
  assert.equal(h.busy, false);
  const fresh = h.press('Connect approved account'); await flush();
  const balanceReads = h.balances.length;
  h.links[0].resolve({ success: true }); await old;
  assert.equal(h.balances.length, balanceReads); assert.equal(h.busy, true); assert.equal(h.alerts.length, 0);
  h.links[1].resolve({ success: true }); await fresh;
  assert.equal(h.balances.length, balanceReads + 1); assert.equal(h.busy, false);
});

test('market payment uses the accepted server order total and binds the resulting intent to that order', async () => {
  const h = harness(); await h.ready(); h.setProps({ listingId: 'listing', orderId: 'accepted-order', initialAmount: 1 }); await h.ready();
  assert.equal(h.checkouts[0].name, 'get_market_order'); assert.equal(h.checkouts[0].args.p_id, 'accepted-order');
  const payment = h.press('Pay'); await flush();
  assert.equal(h.prepares[0].input.amount, 12.5); assert.equal(h.prepares[0].input.orderId, 'accepted-order');
  h.sends[0].resolve(completed); await payment;
});

test('an order for another buyer cannot expose an enabled payment flow', async () => {
  const h = harness(); await h.ready();
  h.setCheckout({ error: null, data: { id: 'order', buyer_id: 'other-account', seller_id: 'recipient', listing_id: 'listing', conversation_id: 'conversation', currency: 'USD', status: 'awaiting_payment', total_minor: '1200' } });
  h.setProps({ listingId: 'listing', orderId: 'order' }); await h.ready();
  assert.match(h.text, /Open the accepted order/); assert.equal(h.prepares.length, 0); assert.equal(h.sends.length, 0);
});
