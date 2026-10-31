const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const values = new Map();
  let staff = 'fixture-a:super_admin';
  let denied = false;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/share.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Date, Math, Number,
    document: { querySelector: () => staff ? { getAttribute: () => staff } : null },
    window: { sessionStorage: { getItem: key => { if (denied) throw new Error('Denied'); return values.get(key) ?? null; }, setItem: (key, value) => { if (denied) throw new Error('Denied'); values.set(key, value); } }, dispatchEvent() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  return { ...module.exports, values, setStaff: value => { staff = value; }, deny: () => { denied = true; } };
}
const note = { kind: 'note', title: 'Review context', page: 'Users', path: '/users', note: { text: 'Synthetic review notes.' } };

test('presentation collections are isolated by staff identity and current role', () => {
  const api = load();
  api.trayAdd(note);
  assert.equal(api.trayRead().length, 1);
  api.setStaff('fixture-b:super_admin');
  assert.equal(api.trayRead().length, 0);
  api.setStaff('fixture-a:analyst');
  assert.equal(api.trayRead().length, 0);
  api.setStaff('fixture-a:super_admin');
  assert.equal(api.trayRead().length, 1);
  api.setStaff(null);
  assert.equal(api.trayRead().length, 0);
  assert.throws(() => api.trayAdd(note), /Refresh your staff workspace/);
});

test('malformed cached presentation items cannot reach the renderer', () => {
  const api = load();
  const key = 'pc-present-tray-v2:fixture-a:super_admin';
  for (const value of ['{', '{}', 'null', '[null,2,"x",{}]', JSON.stringify([{ ...note, id: 'bad', createdAt: new Date().toISOString(), note: null }]), JSON.stringify([{ ...note, id: 'bad', createdAt: new Date().toISOString(), path: '//other.test' }])]) {
    api.values.set(key, value);
    assert.equal(api.trayRead().length, 0);
  }
  api.values.set(key, JSON.stringify([{ ...note, id: 'valid', createdAt: new Date().toISOString() }, null]));
  assert.equal(api.trayRead().length, 1);
});

test('unavailable browser storage reports failure instead of success', () => {
  const api = load();
  api.deny();
  assert.throws(() => api.trayAdd(note), /Browser storage is unavailable/);
  assert.equal(api.trayRead().length, 0);
});

test('a full presentation does not silently discard a newly added item', () => {
  const api = load();
  for (let i = 0; i < 40; i++) api.trayAdd({ ...note, title: `Item ${i}` });
  assert.throws(() => api.trayAdd({ ...note, title: 'Overflow' }), /holds 40 items/);
  assert.equal(api.trayRead().length, 40);
  assert.equal(api.trayRead()[39].title, 'Item 39');
  api.trayRemove(api.trayRead()[0].id);
  api.trayAdd({ ...note, title: 'Replacement' });
  assert.equal(api.trayRead()[39].title, 'Replacement');
});

test('invalid table shapes and excessive note payloads are rejected before persistence', () => {
  const api = load();
  assert.throws(() => api.trayAdd({ ...note, note: { text: 'x'.repeat(10001) } }), /cannot be added/);
  assert.throws(() => api.trayAdd({ ...note, kind: 'table', table: { columns: ['A', 'B'], rows: [['one']], total: 1, filters: [] } }), /cannot be added/);
  assert.equal(api.trayRead().length, 0);
});

test('CSV retains quoted cells and neutralizes formulas and carriage returns', () => {
  const api = load();
  assert.equal(api.csv(['Name', 'Detail'], [['A, B', 'Said "hello"'], ['line\rbreak', '=HYPERLINK("https://example.test")']]), 'Name,Detail\r\n"A, B","Said ""hello"""\r\n"line\rbreak","\'=HYPERLINK(""https://example.test"")"');
  for (const formula of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', ' \t=1+1', '\uFEFF=1+1']) assert.ok(api.csv(['Data'], [[formula]]).split('\r\n')[1].startsWith("'"));
  assert.equal(api.csv(['Count'], [['1234']]), 'Count\r\n1234');
});
