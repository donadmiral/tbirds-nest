const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../src/components/feed/CommentsPanel.tsx'), 'utf8');
const ast = ts.createSourceFile('CommentsPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ['submitComment', 'moderateComment', 'deleteComment', 'pinComment', 'commentMenu', 'restrictCommentAuthor'].includes(node.name.getText(ast))) actions.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness({ result = { error: null }, rpcResult = { error: null, data: { pinned_comment_id: 'comment' } } } = {}) {
  const calls = [], alerts = [], state = { input: 'Keep my draft', reply: { id: 'parent' }, gif: 'https://example.invalid/choice.gif', busy: false, pinned: null, loads: 0 };
  const update = (key, value) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const scope = {
    input: state.input, pendingGif: state.gif, replyTo: state.reply, submitting: false, userId: 'author', ownerId: 'author', postId: 'post', canComment: true, policyOff: false, pinnedId: null,
    pendingActions: { current: new Set() }, activeScope: { current: { key: 'post:author', generation: 1 } },
    currentAuthorId: id => id,
    setSubmitting: value => update('busy', value), setInput: value => update('input', value), setReplyTo: value => update('reply', value), setPendingGif: value => update('gif', value), setPinnedId: value => update('pinned', value),
    setMentionOn() {}, setMentions() {}, Haptics: { impactAsync() {}, ImpactFeedbackStyle: { Light: 'light' } },
    Alert: { alert: (...args) => alerts.push(args) }, load: async () => { state.loads++; }, listRef: { current: null }, setTimeout: fn => fn(),
    supabase: {
      from(table) {
        let query;
        return query = {
          insert(row) { calls.push({ table, operation: 'insert', row }); return Promise.resolve(result); },
          delete() { calls.push({ table, operation: 'delete', filters: [] }); return query; },
          eq(key, value) { calls.at(-1).filters.push([key, value]); return query; },
          then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
        };
      },
      rpc: async (name, args) => { calls.push({ name, args }); return rpcResult; },
    },
  };
  scope.actionScope = scope.activeScope.current;
  const run = name => {
    const compiled = ts.transpileModule('globalThis.action = ' + actions.get(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, scope);
    return scope.action;
  };
  return { scope, state, calls, alerts, run };
}

test('two immediate presses send a native comment only once and clear only the confirmed draft', async () => {
  const pending = deferred(), h = harness({ result: pending.promise }), submit = h.run('submitComment');
  const first = submit(), second = submit(); assert.equal(h.calls.length, 1); assert.equal(h.state.busy, true);
  h.state.input = 'Next draft'; pending.resolve({ error: null }); await Promise.all([first, second]);
  assert.equal(h.state.input, 'Next draft'); assert.equal(h.state.gif, null); assert.equal(h.state.reply, null); assert.equal(h.state.busy, false); assert.equal(h.state.loads, 1);
});
test('a rejected native comment preserves text, reply and GIF for retry', async () => {
  const h = harness({ result: { error: { message: 'denied' } } }); await h.run('submitComment')();
  assert.equal(h.state.input, 'Keep my draft'); assert.equal(h.state.reply.id, 'parent'); assert.equal(h.state.gif, 'https://example.invalid/choice.gif'); assert.equal(h.state.busy, false); assert.equal(h.state.loads, 0); assert.match(h.alerts[0][0], /not sent/);
});
test('a late comment response cannot erase a new account or thread draft, even after returning to the same account', async () => {
  const pending = deferred(), h = harness({ result: pending.promise }); const send = h.run('submitComment')();
  h.scope.activeScope.current = { key: 'post:author', generation: 3 }; h.state.input = 'New account draft'; h.state.busy = true;
  pending.resolve({ error: null }); await send;
  assert.equal(h.state.input, 'New account draft'); assert.equal(h.state.busy, true); assert.equal(h.state.loads, 0);
});
test('off or limited native comments cannot submit through a stale enabled button', async () => {
  for (const field of ['policyOff', 'canComment']) {
    const h = harness(); h.scope[field] = field === 'policyOff'; await h.run('submitComment')(); assert.equal(h.calls.length, 0);
  }
});
test('failed moderation reports a failure instead of reloading as if saved', async () => {
  const h = harness({ rpcResult: { error: { message: 'denied' } } }); await h.run('moderateComment')({ id: 'comment', hidden: false }, 'hidden');
  assert.equal(h.calls[0].name, 'set_comment_hidden'); assert.equal(h.calls[0].args.p_hidden, true); assert.equal(h.state.loads, 0); assert.match(h.alerts[0][0], /not saved/);
});
test('native pin uses the checked command, waits for confirmation and rejects a nonauthor', async () => {
  const h = harness(); await h.run('pinComment')({ id: 'comment' }); assert.equal(h.state.pinned, 'comment'); assert.equal(h.calls[0].name, 'set_comment_pinned');
  const other = harness(); other.scope.ownerId = 'someone-else'; await other.run('pinComment')({ id: 'comment' }); assert.equal(other.calls.length, 0);
});
test('native comment deletion scopes the write to the writer and reports uncertain failure', async () => {
  const h = harness({ result: { error: { message: 'offline' } } }); await h.run('deleteComment')({ id: 'comment', user_id: 'author' });
  assert.deepEqual(h.calls[0].filters, [['id', 'comment'], ['user_id', 'author']]); assert.equal(h.state.loads, 0); assert.match(h.alerts[0][0], /not confirmed/);
});


test('an old native comment action cannot run after leaving a thread, including returning to the same identity', async () => {
  for (const name of ['pinComment', 'moderateComment', 'deleteComment', 'submitComment']) {
    for (const key of ['other-post:author', 'post:someone-else', 'post:author']) {
      const h = harness(), action = h.run(name);
      h.scope.activeScope.current = { key, generation: 3 };
      await action({ id: 'comment', user_id: 'author', hidden: false }, 'hidden');
      assert.equal(h.calls.length, 0, name + ' must reject a callback retained by an old native alert');
      assert.equal(h.scope.pendingActions.current.size, 0);
      assert.equal(h.state.pinned, null);
    }
  }
});


function restrictionConfirmation(h) {
  if (actions.has('restrictCommentAuthor')) h.scope.restrictCommentAuthor = h.run('restrictCommentAuthor');
  h.run('commentMenu')({ id: 'comment', user_id: 'commenter', author: { full_name: 'Commenter' } });
  const open = h.alerts.at(-1)[2].find(button => button.text === 'Restrict Commenter').onPress;
  open();
  return { open, confirm: h.alerts.at(-1)[2].find(button => button.text === 'Restrict').onPress };
}

test('native Restrict rejects an old nested confirmation and an old outer menu after identity changes', async () => {
  for (const key of ['other-post:author', 'post:someone-else', 'post:author']) {
    const h = harness(), { open, confirm } = restrictionConfirmation(h);
    h.scope.activeScope.current = { key, generation: 3 };
    await confirm(); open();
    assert.equal(h.calls.length, 0, 'the old confirmation must not restrict under a replacement context');
    assert.equal(h.alerts.length, 2, 'the old outer menu must not open a new confirmation');
  }
});

test('native Restrict sends once, waits for confirmation and exposes a rejected write', async () => {
  const pending = deferred(), h = harness({ rpcResult: pending.promise }), { confirm } = restrictionConfirmation(h);
  const first = confirm(), second = confirm();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'set_restriction'); assert.equal(h.calls[0].args.p_user, 'commenter');
  assert.equal(h.calls[0].args.p_on, true); assert.equal(h.alerts.length, 2);
  pending.resolve({ error: null }); await Promise.all([first, second]);
  assert.equal(h.alerts.at(-1)[0], 'Restricted'); assert.equal(h.scope.pendingActions.current.size, 0);
  const denied = harness({ rpcResult: { error: { message: 'permission denied' } } });
  await restrictionConfirmation(denied).confirm(); assert.equal(denied.alerts.at(-1)[0], 'Could not restrict');
  assert.equal(denied.scope.pendingActions.current.size, 0);
  const offline = harness(); offline.scope.supabase.rpc = async () => { throw Error('connection lost'); };
  await restrictionConfirmation(offline).confirm();
  assert.match(offline.alerts.at(-1)[1], /could not be confirmed/); assert.equal(offline.scope.pendingActions.current.size, 0);
});

test('an in-flight native Restrict response cannot notify or unlock a replacement context', async () => {
  for (const key of ['other-post:author', 'post:someone-else', 'post:author']) {
    for (const result of [{ error: null }, { error: { message: 'denied' } }]) {
      const pending = deferred(), h = harness({ rpcResult: pending.promise }), { confirm } = restrictionConfirmation(h);
      const first = confirm(); h.scope.activeScope.current = { key, generation: 3 };
      h.scope.pendingActions.current = new Set(['restrict:commenter']);
      pending.resolve(result); await first;
      assert.equal(h.alerts.length, 2); assert.equal(h.scope.pendingActions.current.has('restrict:commenter'), true);
    }
  }
});
