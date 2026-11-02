const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/pollCheck.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const slots = [], effects = [], listeners = new Set(), online = new Set(), reads = [];
  let cursor = 0, hint, value, dirty = false;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useEffect(fn, deps) {
      const index = cursor++, prior = slots[index];
      if (prior?.deps.every((item, i) => Object.is(item, deps[i]))) return;
      slots[index] = { deps };
      effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = fn(); });
    },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, window: {
    addEventListener(_event, fn) { online.add(fn); }, removeEventListener(_event, fn) { online.delete(fn); },
  }, require(name) {
    if (name === 'react') return hooks;
    if (name === './postMetadata') return {
      subscribePostMetadataSession(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      readPostPollFlag(postId) { return new Promise((resolve, reject) => reads.push({ postId, resolve, reject })); },
    };
    throw Error(name);
  } });
  const render = () => {
    for (let count = 0; count < 10; count++) {
      cursor = 0; dirty = false; value = exports.usePollFlag('post', hint);
      effects.splice(0).forEach(fn => fn());
      if (!dirty) return value;
    }
    throw Error('Hook did not settle');
  };
  return { reads, listeners, render, async flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); return render(); },
    hint(next) { hint = next; return render(); },
    account() { [...listeners].forEach(fn => fn()); return render(); },
    dispose() { slots.forEach(item => item?.cleanup?.()); },
  };
}

test('a hinted card still clears its prior account poll result before the hint is removed', async () => {
  const f = fixture();
  assert.equal(f.render(), false); f.reads[0].resolve(true); assert.equal(await f.flush(), true);
  assert.equal(f.hint(false), false); assert.equal(f.listeners.size, 1);
  assert.equal(f.account(), false); assert.equal(f.reads.length, 1, 'a hint suppresses queries');
  assert.equal(f.hint(undefined), false, 'the previous account result cannot flash');
  f.reads[1].reject(Error('offline')); assert.equal(await f.flush(), false);
  f.dispose(); assert.equal(f.listeners.size, 0);
});

test('a late poll result cannot replace a new account result', async () => {
  const f = fixture(); f.render(); f.account();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(false); assert.equal(await f.flush(), false);
  f.reads[0].resolve(true); assert.equal(await f.flush(), false);
  f.dispose();
});
