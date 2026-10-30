const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(initial = []) {
  const stored = new Map(initial);
  const listeners = new Map();
  let readDenied = false, writeDenied = false, subscription;
  const storage = {
    getItem(key) { if (readDenied) throw new DOMException('Denied', 'SecurityError'); return stored.get(key) ?? null; },
    setItem(key, value) { if (writeDenied) throw new DOMException('Full', 'QuotaExceededError'); stored.set(key, value); },
  };
  const sessionStorage = {};
  const window = {
    localStorage: storage,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; },
  };
  function load(file, imports = {}) {
    const module = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '../lib', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, window, Event, require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    } });
    return module.exports;
  }
  const api = load('browserPreferences.ts');
  const hooks = load('browserPreferenceHooks.ts', {
    './browserPreferences': api,
    react: {
      useCallback: callback => callback,
      useSyncExternalStore(subscribe, snapshot, serverSnapshot) {
        const notifications = [];
        subscription = { snapshot, serverSnapshot, notifications, unsubscribe: subscribe(() => notifications.push(snapshot())) };
        return snapshot();
      },
    },
  });
  return {
    ...api, stored, sessionStorage,
    denyRead(value) { readDenied = value; },
    denyWrite(value) { writeDenied = value; },
    observe(key) { hooks.usePreference(key); return subscription; },
    storageEvent(key, newValue, area = storage) { window.dispatchEvent({ type: 'storage', key, newValue, storageArea: area }); },
  };
}

test('ordinary persisted preferences notify consumers and still read later stored changes', () => {
  const api = fixture([['collapsed', 'false']]);
  const view = api.observe('collapsed');
  assert.equal(view.serverSnapshot(), '');
  api.savePreference('collapsed', true);
  assert.equal(api.stored.get('collapsed'), 'true');
  assert.deepEqual(view.notifications, ['true']);
  api.stored.set('collapsed', 'false');
  assert.equal(view.snapshot(), 'false');
});

test('write-only storage failure keeps collapse and pin actions usable in this tab', () => {
  const api = fixture([['collapsed', 'false'], ['pins', '[]']]);
  const view = api.observe('collapsed');
  api.denyWrite(true);
  api.savePreference('collapsed', !api.readPreferenceFlag('collapsed'));
  assert.equal(api.readPreferenceFlag('collapsed'), true);
  assert.equal(view.snapshot(), 'true');
  assert.equal(api.stored.get('collapsed'), 'false', 'the fallback must not claim persistence');
  api.savePreference('collapsed', !api.readPreferenceFlag('collapsed'));
  assert.equal(api.readPreferenceFlag('collapsed'), false);
  api.savePreference('pins', ['/content']);
  assert.deepEqual(Array.from(api.readPreferenceList('pins')), ['/content']);
  assert.deepEqual(view.notifications.slice(0, 2), ['true', 'false']);
});

test('a successful retry retires the temporary override and follows stored values again', () => {
  const api = fixture([['collapsed', 'false']]);
  api.denyRead(true); api.denyWrite(true);
  api.savePreference('collapsed', true);
  assert.equal(api.readPreferenceFlag('collapsed'), true);
  api.denyRead(false); api.denyWrite(false);
  api.savePreference('collapsed', true);
  assert.equal(api.stored.get('collapsed'), 'true');
  api.stored.set('collapsed', 'false');
  assert.equal(api.readPreferenceFlag('collapsed'), false);
});

test('a changed persisted value supersedes a failed write without waiting for an event', () => {
  const api = fixture([['pins', '[]']]);
  api.denyWrite(true);
  api.savePreference('pins', ['/content']);
  assert.deepEqual(Array.from(api.readPreferenceList('pins')), ['/content']);
  api.stored.set('pins', '["/support"]');
  assert.deepEqual(Array.from(api.readPreferenceList('pins')), ['/support']);
});

test('cross-tab changes invalidate failed writes even if storage has returned to the old value', () => {
  const api = fixture([['collapsed', 'false']]);
  const view = api.observe('collapsed');
  api.denyWrite(true);
  api.savePreference('collapsed', true);
  // Another tab changes true -> false before this tab handles its first event.
  api.stored.set('collapsed', 'false');
  api.storageEvent('collapsed', 'true');
  assert.equal(view.snapshot(), 'false');
  assert.equal(view.notifications.at(-1), 'false');
  api.denyRead(true);
  assert.equal(view.snapshot(), 'false', 'the last confirmed stored value is the fallback');
});

test('cross-tab clear retires every temporary override, including unavailable-storage fallbacks', () => {
  const api = fixture();
  const view = api.observe('pins');
  api.denyRead(true); api.denyWrite(true);
  api.savePreference('pins', ['/content']);
  api.savePreference('collapsed', true);
  api.stored.clear();
  api.storageEvent(null, null);
  assert.equal(view.snapshot(), '');
  assert.equal(api.readPreferenceFlag('collapsed'), false);
  assert.equal(view.notifications.at(-1), '');
});

test('session-storage and unrelated storage entries cannot replace a preference fallback', () => {
  const api = fixture([['collapsed', 'false']]);
  const view = api.observe('collapsed');
  api.denyWrite(true);
  api.savePreference('collapsed', true);
  api.storageEvent('collapsed', 'false', api.sessionStorage);
  assert.equal(view.snapshot(), 'true');
  api.storageEvent('unrelated', 'not-a-navigation-preference');
  api.denyRead(true);
  assert.equal(api.preferenceValue('unrelated'), '', 'unrelated browser storage must not be cached');
});

test('unsubscribed preference consumers stop receiving both local and cross-tab changes', () => {
  const api = fixture();
  const view = api.observe('collapsed');
  view.unsubscribe();
  api.savePreference('collapsed', true);
  api.storageEvent('collapsed', 'false');
  assert.deepEqual(view.notifications, []);
});
