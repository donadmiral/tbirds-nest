const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, require: name => overrides[name] ?? require(name),
    Promise, Date, Request, Response, TextDecoder, AbortSignal, URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon' } }, ...overrides.globals });
  return module.exports;
}
const shared = load('shared/clientDiagnostics.ts');
const plain = value => JSON.parse(JSON.stringify(value));
test('diagnostics do not include raw error messages, stacks, arbitrary context or forged category values', () => {
  const error = new TypeError('secret-token@example.test'); error.stack = 'private://stack';
  const result = shared.sanitizeDiagnostic(error, { source: 'render', platform: 'web', fatal: true, token: 'secret', appVersion: 'https://secret.test' });
  assert.deepEqual(plain(result), { version: 1, category: 'TypeError', source: 'render', platform: 'web', fatal: true, appVersion: null });
  assert.equal(shared.sanitizeDiagnostic({ name: 'my-password' }).category, 'UnknownError');
  assert.equal(shared.sanitizeDiagnostic({ get name() { throw Error('secret'); } }).category, 'UnknownError');
  assert.equal(shared.sanitizeDiagnostic(null, { appVersion: '1.2.3-qa.1' }).appVersion, '1.2.3-qa.1');
});
test('reporting deduplicates, limits a minute to five reports, recovers after time reset and contains rejected transports', async () => {
  let now = 100, sent = [];
  const report = shared.createDiagnosticReporter(payload => { sent.push(payload); return Promise.reject(Error('offline')); }, () => now);
  assert.equal(report({ name: 'Error' }), true); assert.equal(report({ name: 'Error' }), false);
  for (const name of ['TypeError','RangeError','ReferenceError','SyntaxError']) assert.equal(report({ name }), true);
  assert.equal(report({ name: 'TimeoutError' }), false); assert.equal(sent.length, 5);
  now += 60_000; assert.equal(report({ name: 'Error' }), true);
  now = 0; assert.equal(report({ name: 'Error' }), true);
  await new Promise(resolve => setImmediate(resolve));
});
for (const [app, callback] of [['web', 'retry'], ['admin-web', 'unstable_retry']]) {
  for (const file of ['error.tsx', 'global-error.tsx']) {
    test(`${app}/${file} requests fresh server data with the installed Next retry API`, () => {
      const React = require('../' + app + '/node_modules/react');
      const jsx = require('../' + app + '/node_modules/react/jsx-runtime');
      const component = load(app + '/app/' + file, { react: { ...React, useEffect() {} }, 'react/jsx-runtime': jsx,
        '@/lib/clientDiagnostics': { reportClientError() {} }, 'next/link': 'a', 'lucide-react': { AlertTriangle: 'span', RotateCcw: 'span' } }).default;
      let retries = 0; const tree = component({ error: Object.assign(Error('secret'), { digest: 'private-digest' }), [callback]: () => retries++ });
      const walk = value => { if (!value || typeof value !== 'object') return; if (value.type === 'button') value.props.onClick(); React.Children.forEach(value.props?.children, walk); };
      walk(tree); assert.equal(retries, 1);
      const html = require('../' + app + '/node_modules/react-dom/server').renderToStaticMarkup(tree);
      assert.doesNotMatch(html, /secret|private-digest/);
      if (file === 'global-error.tsx') assert.match(html, /<html.*<body/s);
    });
  }
}
test('admin diagnostic endpoint rejects untrusted origins, anonymous requests, oversized input and re-sanitizes accepted reports', async () => {
  let admin = { aal: 'aal2' }, sent = [];
  const route = load('admin-web/app/api/diagnostics/route.ts', { 'next/headers': { cookies: async () => ({ get: () => ({ value: 'verified-token' }) }) },
    '@/lib/adminAuth': { getAdmin: async () => admin }, '../../../../shared/clientDiagnostics': shared,
    globals: { fetch: async (...args) => { sent.push(args); return new Response(null, { status: 204 }); } } });
  const request = (body, origin = 'https://admin.test') => new Request('https://admin.test/api/diagnostics', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await route.POST(request({}, 'https://evil.test'))).status, 403);
  assert.equal((await route.POST(request({ secret: 'x'.repeat(3000) }))).status, 413);
  admin = null; assert.equal((await route.POST(request({}))).status, 401);
  assert.equal(sent.length, 0);
  admin = { aal: 'aal2' }; assert.equal((await route.POST(request({ category: 'TypeError', source: 'render', message: 'secret' }))).status, 204);
  const payload = JSON.parse(sent[0][1].body).p_report;
  assert.equal(payload.category, 'TypeError'); assert.equal(payload.platform, 'admin'); assert.equal(payload.message, undefined);
  assert.equal(sent[0][1].headers.Authorization, 'Bearer verified-token');
});
