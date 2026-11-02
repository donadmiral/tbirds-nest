const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual small PostCard hook, not a parallel model of it.
const file = fs.readFileSync(path.join(__dirname, '../components/PostCard.tsx'), 'utf8');
const ast = ts.createSourceFile('PostCard.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useToggle');
assert.ok(declaration);
const source = ts.transpileModule(declaration.getText(ast) + '\nmodule.exports = useToggle;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
  let index = 0, dirty = false, now = 100, output, args;
  const slots = [], effects = [], events = [], module = { exports: {} };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  vm.runInNewContext(source, { module, Date: { now: () => now },
    useState(initial) {
      const i = index++; if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (next !== slots[i].value) { slots[i].value = next; dirty = true; } }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(run, deps) { const i = index++; if (changed(slots[i]?.deps, deps)) { slots[i] = { deps }; effects.push(run); } },
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  function render(next = args) {
    args = next; let count = 0;
    do { assert.ok(count++ < 20); dirty = false; index = 0; output = module.exports(...args); effects.splice(0).forEach(run => run()); } while (dirty);
    return output;
  }
  return { render, events, time(value) { now = value; } };
}

test('repost seed changes are accepted while idle but pending and confirmed mutations reject older snapshots', async () => {
  const h = harness(), hold = defer(), action = () => hold.promise;
  h.render([false, 4, action, 'post', undefined]);
  let state = h.render([false, 7, action, 'post', 90]); assert.equal(state.n, 7);
  const mutation = state.set(true);
  state = h.render([false, 7, action, 'post', 110]); assert.equal(state.on, true); assert.equal(state.n, 8);
  h.time(200); hold.resolve(true); await mutation;
  state = h.render([false, 6, action, 'post', 150]); assert.equal(state.on, true); assert.equal(state.n, 8);
  state = h.render([true, 12, action, 'post', 201]); assert.equal(state.on, true); assert.equal(state.n, 12);
  assert.equal(h.events.length, 1); assert.equal(h.events[0].type, 'pc-feed-post-changed'); assert.equal(h.events[0].detail.postId, 'post');
});

test('failed reposts release the pending guard and still request post-settlement canonical reconciliation', async () => {
  const h = harness(), action = async () => false;
  const state = h.render([false, 4, action, 'post', undefined]); await state.set(true);
  const after = h.render(); assert.equal(after.on, false); assert.equal(after.n, 4); assert.equal(h.events.length, 1);
  h.time(300); await after.set(true); assert.equal(h.events.length, 2, 'A failed mutation cannot leave the control locked');
});
