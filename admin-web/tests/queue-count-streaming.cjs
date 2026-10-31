const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const React = localRequire('react');
const { renderToPipeableStream } = localRequire('react-dom/server');

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, AbortSignal, Promise, Number,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name),
  }, { filename: file });
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const permissions = load('lib/permissions.ts');
function reader(replies = {}) {
  const calls = [];
  const module = load('lib/queueCounts.ts', {
    'server-only': {}, './permissions': permissions,
    './supabaseAdmin': { serviceClient: () => ({ from(table) {
      const call = { table }; calls.push(call);
      const query = {
        select(columns, options) { call.select = { columns, ...options }; return query; },
        in(column, values) { call.filter = [column, values]; return query; },
        eq(column, value) { call.filter = [column, value]; return query; },
        abortSignal(signal) { call.signal = signal; return query; },
        then(resolve, reject) {
          const value = replies[table] ?? { count: 2, error: null };
          return (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)).then(resolve, reject);
        },
      };
      return query;
    } }) },
  });
  return { ...module, calls };
}

test('counts query only the desks and report types the current staff role can open', async () => {
  for (const role of permissions.STAFF_ROLES) {
    const h = reader();
    const result = await h.loadQueueCounts(role);
    const tables = h.calls.map(call => call.table);
    assert.equal(tables.includes('verification_applications'), permissions.allowedDesks(role).has('/queue'), role);
    assert.equal(tables.includes('support_tickets'), permissions.allowedDesks(role).has('/support'), role);
    for (const [table, permission] of [['post_reports', 'report_post'], ['listing_reports', 'report_listing'], ['user_reports', 'report_user']]) {
      assert.equal(tables.includes(table), permissions.canPerform(role, permission), `${role}: ${table}`);
    }
    assert.equal(result.unavailable, false);
    for (const call of h.calls) {
      assert.equal(call.select.head, true);
      assert.equal(call.select.count, 'exact');
      assert.ok(call.signal instanceof AbortSignal);
    }
  }
});

test('throwOnError failures affect the failed badge, preserve other counts, and never become invented zeros', async () => {
  const h = reader({ post_reports: new Error('connection failed') });
  const state = await h.loadQueueCounts('super_admin');
  assert.equal(state.counts['/queue'], 2);
  assert.equal(state.counts['/support'], 2);
  assert.equal(state.counts['/reports'], null);
  assert.equal(state.alerts, null);
  assert.equal(state.unavailable, true);
});

test('provider initialization failure resolves to unknown counts without rejecting the shell promise', async () => {
  const { loadQueueCounts } = load('lib/queueCounts.ts', {
    'server-only': {}, './permissions': permissions,
    './supabaseAdmin': { serviceClient() { throw new Error('provider configuration unavailable'); } },
  });
  const state = await loadQueueCounts('super_admin');
  assert.equal(state.unavailable, true);
  assert.equal(state.alerts, null);
  assert.ok(Object.values(state.counts).every(value => value === null));
});

test('null, negative and nonintegral counts are not presented as verified data', async () => {
  for (const count of [null, -1, 2.5, NaN]) {
    const state = await reader({ support_tickets: { count, error: null } }).loadQueueCounts('super_admin');
    assert.equal(state.counts['/support'], null);
    assert.equal(state.unavailable, true);
  }
});

test('concurrent staff requests never share privileged count results', async () => {
  const gate = deferred();
  const first = reader({ verification_applications: gate.promise });
  const high = first.loadQueueCounts('super_admin');
  const low = await reader().loadQueueCounts('support_agent');
  assert.equal(low.counts['/queue'], 0);
  assert.equal(low.counts['/reports'], 0);
  gate.resolve({ count: 91, error: null });
  assert.equal((await high).counts['/queue'], 91);
  assert.equal(low.counts['/queue'], 0);
});

const components = load('components/QueueCounts.tsx', {
  'next/link': { default: props => React.createElement('a', props), __esModule: true },
  './AdminIcon': { default: () => React.createElement('span', { 'aria-hidden': true }), __esModule: true },
});

test('the actual React stream delivers desk content and a usable bell before slow counts finish', async () => {
  const gate = deferred();
  const stream = new PassThrough();
  let html = '';
  stream.on('data', chunk => { html += chunk; });
  const ended = once(stream, 'end');
  const shell = deferred();
  const errors = [];
  const renderer = renderToPipeableStream(React.createElement(components.QueueCountsProvider, { value: gate.promise },
    React.createElement('main', null,
      React.createElement('h1', null, 'Post review'),
      React.createElement('p', null, 'The post is available now'),
      React.createElement(components.QueueBell, { href: '/queue' }),
      React.createElement(components.QueueBadge, { href: '/queue' }),
      React.createElement(components.QueueCountNotice))), {
    onShellReady() { renderer.pipe(stream); shell.resolve(); },
    onError(error) { errors.push(error); },
  });
  await shell.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.match(html, /The post is available now/);
  assert.match(html, /aria-label="Work queues"/);
  assert.doesNotMatch(html, /11 waiting|11 items waiting/);
  gate.resolve({ counts: { '/queue': 11 }, alerts: 11, unavailable: false });
  await ended;
  assert.match(html, /11 waiting/);
  assert.match(html, /11 items waiting for review/);
  assert.deepEqual(errors, []);
});
