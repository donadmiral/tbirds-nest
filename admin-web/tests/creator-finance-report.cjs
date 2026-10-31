const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const creator = '10000000-0000-4000-8000-000000000001';
const payout = '10000000-0000-4000-8000-000000000002';
const at = '2026-10-30T16:25:37.655868+00:00';
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, Date, Error,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name) }, { filename: file });
  return module.exports;
}
const domain = load('../shared/monetization/domain.ts');
const availability = load('../shared/monetization/availability.ts');
const report = load('lib/creatorFinanceReport.ts', { '../../shared/monetization/domain': domain });
function fixture() {
  return { environment: 'live', enrollment_open: false,
    enrollments: [{ user_id: creator, status: 'applied', accepted_terms_version: '2026-10', public_reason: null, updated_at: at }],
    payouts: [{ id: payout, user_id: creator, currency: 'USD', amount_minor: '9007199254740991', environment: 'test', status: 'unknown', provider_reference: 'recorded-reference', last_error: null, created_at: at }],
    next_cursor: null };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props?.children)] : []; }
function words(node) { return Array.isArray(node) ? node.map(words).join(' ') : node && typeof node === 'object' ? words(node.props?.children) : typeof node === 'string' ? node : ''; }
function harness({ role = 'finance_admin', data = fixture(), error = null, thrown = null, deny = false } = {}) {
  const calls = [];
  let authorized = false;
  const mod = load('app/payments/creators/page.tsx', {
    'react/jsx-runtime': jsx, 'next/link': { __esModule: true, default: 'Link' },
    '@/components/Shell': { __esModule: true, default: 'Shell' },
    '@/components/AdminIcon': { __esModule: true, default: 'Icon' },
    './ReviewForm': { __esModule: true, default: 'ReviewForm' },
    'next/navigation': { notFound: () => { throw Error('not found'); } },
    '@/lib/adminAuth': { requireDesk: async desk => { calls.push({ desk }); if (deny) throw Error('sign-in required'); authorized = true; return { id: 'verified-actor', sessionId: 'verified-session', role }; } },
    '@/lib/supabaseAdmin': { serviceClient: () => {
      assert.equal(authorized, true, 'staff authorization must happen before a service client is created');
      calls.push({ service: true });
      return { rpc: async (name, args) => { calls.push({ name, args }); if (thrown) throw thrown; return { data, error }; } };
    } },
    '@/lib/creatorFinanceReport': report,
    '../../../../shared/monetization/domain': domain,
    '../../../../shared/monetization/availability': availability,
    '../../../../shared/payments/providerStatus': { providerIssue: () => null },
  });
  return { calls, render: search => mod.default({ searchParams: Promise.resolve(search || {}) }) };
}

test('read-only creator report uses the verified staff session while money operations remain disabled', async () => {
  const h = harness();
  const tree = await h.render({ p_actor: 'attacker', p_session: 'attacker' });
  assert.equal(availability.FINANCE_OPERATIONS_ENABLED, false);
  assert.equal(h.calls[0].desk, '/payments');
  const call = h.calls.find(item => item.name);
  assert.equal(call.name, 'creator_finance_admin_snapshot');
  assert.deepEqual(JSON.parse(JSON.stringify(call.args)), { p_actor: 'verified-actor', p_session: 'verified-session', p_before_at: null, p_before_id: null });
  assert.equal(h.calls.filter(item => item.name).length, 1);
  assert.match(words(tree), /Read-only reporting/);
  assert.match(words(tree), /does not confirm a working provider connection/);
  assert.match(words(tree), /USD 90,071,992,547,409\.91/);
  assert.equal(nodes(tree).filter(item => ['form', 'ReviewForm', 'input'].includes(item.type)).length, 0);
  assert.ok(nodes(tree).some(item => item.type === 'Link' && item.props.href === '/payments'));
  assert.ok(nodes(tree).some(item => item.type === 'Link' && item.props.href === '/users/' + creator));
});

test('unauthenticated and non-finance staff cannot query financial records', async () => {
  for (const options of [{ deny: true }, { role: 'support_agent' }, { role: 'analyst' }, { role: 'trust_safety' }]) {
    const h = harness(options);
    await assert.rejects(h.render(), /sign-in required|not found/);
    assert.equal(h.calls.filter(item => item.service || item.name).length, 0);
  }
});

test('malformed, duplicated and unpaired page cursors never reach the database', async () => {
  for (const search of [{ before_at: at }, { before_id: creator }, { before_at: [at, at], before_id: creator }, { before_at: at, before_id: '../../users' }, { before_at: 'tomorrow', before_id: creator }]) {
    const h = harness();
    const tree = await h.render(search);
    assert.equal(h.calls.filter(item => item.name).length, 0);
    assert.match(words(tree), /Open the first page/);
    assert.ok(nodes(tree).some(item => item.type === 'Link' && item.props.href === '/payments/creators'));
  }
});

test('pagination and refresh preserve PostgreSQL microseconds and use the returned last record', async () => {
  const data = fixture();
  data.next_cursor = { user_id: creator, updated_at: at };
  const h = harness({ data });
  const tree = await h.render({ before_at: at, before_id: creator });
  const call = h.calls.find(item => item.name);
  assert.equal(call.args.p_before_at, at);
  const links = nodes(tree).filter(item => item.type === 'Link');
  const next = links.find(item => words(item).includes('Next creator page'));
  const refresh = links.find(item => words(item).includes('Refresh records'));
  assert.equal(new URL(next.props.href, 'https://qa.example.invalid').searchParams.get('before_at'), at);
  assert.equal(refresh.props.href, report.creatorFinanceHref(data.next_cursor));
  assert.ok(links.some(item => words(item) === 'First page' && item.props.href === '/payments/creators'));
});

test('provider absence is not replaced by an invented payout or empty-state success', async () => {
  const data = fixture();
  data.payouts = [];
  const h = harness({ data });
  const tree = await h.render();
  assert.match(words(tree), /No payout requests have been recorded/);
  assert.match(words(tree), /Creator approvals, payouts and finalized statements are unavailable/);
  assert.equal(h.calls.filter(item => item.name).length, 1);
});

test('expired finance and MFA sessions show recovery routes without exposing raw backend errors', async () => {
  for (const [message, href, text] of [['MFA_REQUIRED', '/security', 'Verify sign-in'], ['ACTIVE_FINANCE_SESSION_REQUIRED', '/', 'Sign in again']]) {
    const h = harness({ data: null, error: { message } });
    const tree = await h.render();
    assert.match(words(tree), /Records unavailable/);
    assert.doesNotMatch(words(tree), /No payout requests have been recorded/);
    assert.ok(nodes(tree).some(item => item.type === 'Link' && item.props.href === href && words(item) === text));
    assert.equal(words(tree).includes(message), false);
  }
});

test('query failures and rejected network requests retain a retry path for the current page', async () => {
  for (const options of [{ error: { message: 'database-internal-secret' } }, { thrown: Error('transport-internal-secret') }]) {
    const h = harness(options);
    const tree = await h.render({ before_at: at, before_id: creator });
    assert.match(words(tree), /Records unavailable/);
    assert.equal(words(tree).includes('internal-secret'), false);
    assert.ok(nodes(tree).some(item => item.type === 'Link' && words(item) === 'Retry' && item.props.href === report.creatorFinanceHref({ updated_at: at, user_id: creator })));
  }
});

test('incomplete, oversized, duplicate or unknown financial responses fail closed', async () => {
  const changes = [
    data => { delete data.enrollment_open; }, data => { delete data.next_cursor; },
    data => { data.environment = 'enabled'; }, data => { data.enrollments[0].status = '__proto__'; },
    data => { data.enrollments.push({ ...data.enrollments[0] }); },
    data => { data.payouts.push({ ...data.payouts[0] }); },
    data => { data.payouts[0].amount_minor = 42; }, data => { data.payouts[0].amount_minor = '9007199254740991.01'; },
    data => { data.payouts[0].amount_minor = '9223372036854775808'; },
    data => { data.payouts[0].currency = 'US'; }, data => { data.payouts[0].status = 'settled'; },
    data => { data.payouts[0].environment = null; }, data => { data.payouts[0].created_at = 'not-a-date'; },
    data => { data.next_cursor = { user_id: payout, updated_at: at }; },
    data => { data.enrollments = Array.from({ length: 51 }, () => ({ ...data.enrollments[0] })); },
  ];
  for (const change of changes) {
    const data = fixture(); change(data);
    assert.throws(() => report.parseCreatorFinanceReport(data), /INVALID_FINANCE_REPORT/);
    const tree = await harness({ data }).render();
    assert.match(words(tree), /Records unavailable/);
    assert.doesNotMatch(words(tree), /No payout requests have been recorded/);
  }
});

test('large and non-USD amounts stay exact and each payout retains its own environment', async () => {
  const data = fixture();
  data.payouts[0].currency = 'JPY';
  data.payouts[0].amount_minor = '9223372036854775807';
  const tree = await harness({ data }).render();
  assert.match(words(tree), /9223372036854775807 minor units \(JPY\)/);
  const table = nodes(tree).find(item => item.type === 'table');
  assert.match(words(table), /Test/);
  assert.match(words(tree), /Live records/);
});

test('private provider error payloads are replaced with a reconciliation instruction', async () => {
  const data = fixture();
  data.payouts[0].last_error = 'raw-request-with-private-payload';
  const tree = await harness({ data }).render();
  assert.equal(words(tree).includes(data.payouts[0].last_error), false);
  assert.match(words(tree), /Reconcile the existing reference before retrying/);
});
