const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };

function harness(denied = false) {
  const calls = [];
  const summary = { status_counts: {}, completed_week: 0, failed_week: 0, failed_previous_week: 0, volume_week: [], volume_all: [], days: [], top_recipients: [] };
  const service = {
    async rpc(name) {
      calls.push(name);
      if (name === 'admin_payment_report') return { data: { rows: [], has_more: false, next_cursor: null }, error: null };
      if (name === 'admin_payment_summary') return { data: summary, error: null };
      throw new Error('Unexpected financial operation: ' + name);
    },
    from(table) {
      assert.equal(table, 'health_runs');
      const query = { select() { return this; }, order() { return this; }, limit() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
      return query;
    },
  };
  function load(file) {
    const module = { exports: {} };
    const requireModule = name => {
      if (name === '@/lib/requestTime') return { requestTime: async () => Date.parse('2026-10-30T12:00:00Z') };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'next/link' || name === '@/components/Shell') return { default: name, __esModule: true };
      if (name === '@/components/Desk') return { Desk: 'Desk', StatStrip: 'StatStrip' };
      if (name === '@/components/Viz') return { Donut: 'Donut', StackBars: 'StackBars', Empty: 'Empty' };
      if (name === '@/lib/adminAuth') return { requireDesk: async desk => { calls.push('authorize:' + desk); if (denied) throw new Error('Denied'); return { role: 'finance_admin' }; } };
      if (name === '@/lib/supabaseAdmin') return { serviceClient: () => { calls.push('service'); return service; } };
      if (name.startsWith('@/lib/')) return load('admin-web/lib/' + name.slice(6) + '.ts');
      if (name === '../../../shared/payments/providerStatus') return load('shared/payments/providerStatus.ts');
      throw new Error('Unexpected module: ' + name);
    };
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, require: requireModule, Date, URLSearchParams });
    return module.exports;
  }
  return { calls, page: load('admin-web/app/payments/page.tsx').default };
}

test('authorized payment page reads existing reports without invoking financial commands', async () => {
  const h = harness();
  const tree = await h.page({ searchParams: Promise.resolve({}) });
  assert.equal(tree.type, '@/components/Shell');
  assert.deepEqual(h.calls, ['authorize:/payments', 'service', 'admin_payment_report', 'admin_payment_summary']);
});

test('payment report authorization happens before the service client or any financial read', async () => {
  const h = harness(true);
  await assert.rejects(h.page({ searchParams: Promise.resolve({}) }), /Denied/);
  assert.deepEqual(h.calls, ['authorize:/payments']);
});
