const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute the production effect, including its real scroll callback. The controlled
// timer/frame boundary reproduces the CI jump without relying on machine timing.
const file = path.join(__dirname, '../components/MessagesApp.tsx');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects = [];
let scrollToEnd;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'scrollToEnd') scrollToEnd = node.initializer.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    const callback = node.arguments[0]?.getText(ast);
    if (callback?.includes('new ResizeObserver(') && callback.includes('new MutationObserver(')) effects.push(callback);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.length, 1, 'exercise the actual conversation resize/mutation effect');
assert.ok(scrollToEnd);
const compiled = ts.transpileModule(`const scrollToEnd = ${scrollToEnd}; module.exports = ${effects[0]};`, {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function element(top = 2712) {
  let position = top;
  const listeners = new Map();
  return {
    children: [{}, {}], scrollHeight: 3500, clientHeight: 788,
    get scrollTop() { return position; },
    set scrollTop(value) { position = Math.max(0, Math.min(Number(value), this.scrollHeight - this.clientHeight)); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    scroll(top) { this.scrollTop = top; listeners.get('scroll')?.(); },
  };
}

function fixture() {
  const node = element(), timers = new Map(), frames = new Map(), resize = [], mutation = [];
  let next = 0;
  const observer = callbacks => class {
    constructor(callback) { this.callback = callback; callbacks.push(callback); }
    observe() {}
    disconnect() {}
  };
  const globals = {
    activeId: 'conversation-a', activeRef: { current: { id: 'conversation-a' } },
    accountGeneration: { current: 1 }, listRef: { current: node }, pinnedRef: { current: true },
    threadPosition: { current: null }, debugCounts: { current: { scroll: 0, ro: 0, mo: 0 } },
    restoreVisibleThread() {}, markReadRef: { current: async () => {} },
    setTimeout(callback, delay) { assert.equal(delay, 80); const id = ++next; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: observer(resize), MutationObserver: observer(mutation),
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, ...globals });
  const cleanup = module.exports();
  const take = queue => {
    assert.equal(queue.size, 1, 'exactly one callback is pending at this boundary');
    const [id, callback] = queue.entries().next().value; queue.delete(id); return callback;
  };
  return {
    node, globals, timers, frames, cleanup,
    resize: () => resize[0](), mutation: () => mutation[0](),
    takeTimer: () => take(timers), takeFrame: () => take(frames),
    queueFrame() { resize[0](); take(timers)(); return take(frames); },
  };
}

test('a queued resize frame cannot move a conversation from the reader position 247 back to the bottom', () => {
  const h = fixture(), frame = h.queueFrame();
  h.node.scroll(247);
  assert.equal(h.globals.pinnedRef.current, false);
  frame();
  assert.equal(h.node.scrollTop, 247);
  h.cleanup();
});

test('a current reader at the bottom still follows the final content height', () => {
  const h = fixture(), frame = h.queueFrame();
  h.node.scrollHeight = 4200;
  frame();
  assert.equal(h.node.scrollTop, 3412);
  h.cleanup();
});

test('conversation replacement fences an already dispatched frame before effect cleanup', () => {
  const h = fixture(), frame = h.queueFrame();
  h.globals.activeRef.current = { id: 'conversation-b' };
  h.node.scrollTop = 247;
  frame();
  assert.equal(h.node.scrollTop, 247);
  h.cleanup();
});

test('account replacement fences an already dispatched frame even for the same conversation', () => {
  const h = fixture(), frame = h.queueFrame();
  h.globals.accountGeneration.current += 1;
  h.node.scrollTop = 247;
  frame();
  assert.equal(h.node.scrollTop, 247);
  h.cleanup();
});

test('an old observer frame cannot scroll a replacement list element through the shared ref', () => {
  const h = fixture(), frame = h.queueFrame(), replacement = element(247);
  h.globals.listRef.current = replacement;
  frame();
  assert.equal(replacement.scrollTop, 247);
  h.cleanup();
});

test('cleanup cancels its pending frame and a callback already dispatched cannot scroll afterward', () => {
  const h = fixture(); h.resize(); h.takeTimer()();
  const frame = h.frames.values().next().value;
  h.cleanup();
  assert.equal(h.frames.size, 0);
  h.node.scrollTop = 247;
  frame();
  assert.equal(h.node.scrollTop, 247);
});

test('cleanup cancels its timer and rejects a timer or observer delivery already queued', () => {
  const h = fixture(); h.mutation();
  const timer = h.timers.values().next().value;
  h.cleanup();
  assert.equal(h.timers.size, 0);
  timer();
  h.resize(); h.mutation();
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
});
