const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: name => Object.hasOwn(imports, name) ? imports[name] : require(name) });
  return module.exports;
}
const policy = load('lib/permissions.ts');
const nav = load('lib/navigation.ts', { './permissions': policy });

test('all navigation and tool destinations resolve to existing route files', () => {
  const items = [...nav.GROUPS.flatMap(group => group.items), ...nav.RELATED_DESTINATIONS, ...nav.WORKSPACE_TOOLS];
  for (const item of items) assert.ok(fs.existsSync(path.join(root, 'app', nav.routePath(item.href), 'page.tsx')), item.href);
  assert.equal(new Set(items.map(item => item.key)).size, items.length, 'keyboard shortcuts must not collide');
});

test('every role sees only routes whose parent desk and operation it can actually access', () => {
  for (const role of [...policy.STAFF_ROLES, 'unknown_role']) {
    const allowed = policy.allowedDesks(role);
    for (const item of nav.navigationForRole(role).flatMap(group => group.items)) {
      assert.ok(allowed.has(item.desk || item.href), `${role} / ${item.href}`);
      if (item.permission) assert.ok(policy.canPerform(role, item.permission), `${role} / ${item.permission}`);
    }
    for (const action of nav.actionsForRole(role)) {
      assert.ok(allowed.has(action.desk), `${role} / ${action.href}`);
      if (action.permission) assert.ok(policy.canPerform(role, action.permission));
    }
  }
  assert.equal(nav.navigationForRole('unknown_role').length, 0);
  assert.equal(nav.toolsForRole('unknown_role').length, 0);
});

test('deletion and seller review discoverability follow their distinct decision permissions', () => {
  const hrefs = role => nav.navigationForRole(role).flatMap(group => group.items).map(item => item.href);
  for (const role of policy.STAFF_ROLES) {
    assert.equal(hrefs(role).includes('/users/deletions'), role === 'super_admin');
    assert.equal(hrefs(role).includes('/market/reviews'), ['super_admin', 'platform_admin', 'trust_safety', 'market_reviewer'].includes(role));
  }
  assert.ok(hrefs('market_reviewer').includes('/market/orders'));
  assert.ok(!hrefs('support_agent').includes('/market/orders'));
});

test('nested destinations win over their parents and do not collide with similar path prefixes', () => {
  const items = nav.navigationForRole('super_admin').flatMap(group => group.items);
  assert.equal(nav.matchingDestination('/users/deletions', items), '/users/deletions');
  assert.equal(nav.matchingDestination('/users/deletions-backup', items), '/users');
  assert.equal(nav.matchingDestination('/market/orders/00000000-0000-4000-8000-000000000001', items), '/market/orders');
  assert.equal(nav.matchingDestination('/market/reviews', items), '/market/reviews');
  assert.equal(nav.matchingDestination('/users-malicious', items), undefined);
});

test('quick actions target real form anchors and authenticator setup opens the optional setup route', () => {
  const actions = nav.actionsForRole('super_admin');
  for (const action of actions.filter(action => action.href.includes('#'))) {
    const [route, anchor] = action.href.split('#');
    const source = fs.readFileSync(path.join(root, 'app', route, 'page.tsx'), 'utf8');
    assert.ok(source.includes(`id="${anchor}"`), action.href);
  }
  assert.ok(nav.toolsForRole('support_agent').some(item => item.href === '/security?setup=1'));
});

async function auditFilters(role, requestedActor) {
  const calls = [];
  const own = '10000000-0000-4000-8000-000000000001';
  const service = { from(table) {
    const result = { data: [], count: 0, error: null };
    const query = {
      select() { return query; }, eq(column, value) { calls.push({ table, column, value }); return query; },
      order() { return query; }, limit() { return query; },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return query;
  } };
  const component = load('app/audit/page.tsx', {
    '@/lib/adminAuth': { requireDesk: async desk => { assert.equal(desk, '/audit'); return { id: own, role }; } },
    '@/lib/supabaseAdmin': { serviceClient: () => service },
    '@/components/Shell': { default: 'Shell' }, '@/components/Desk': { Desk: 'Desk', StatStrip: 'StatStrip' },
    '@/components/Viz': { Donut: 'Donut', StackBars: 'StackBars', Empty: 'Empty' },
    '@/lib/fmt': { fmt: String, ago: String }, 'next/link': { default: 'Link' },
    'next/navigation': { redirect() { throw Error('Unexpected redirect'); } },
  });
  await component.default({ searchParams: Promise.resolve({ actor: requestedActor }) });
  return { filters: calls.filter(call => call.table === 'admin_audit_log'), own };
}

test('a full audit reviewer can follow a staff-specific audit trail', async () => {
  const requested = '10000000-0000-4000-8000-000000000002';
  const { filters } = await auditFilters('super_admin', requested);
  assert.deepEqual(filters, [{ table: 'admin_audit_log', column: 'admin_id', value: requested }]);
});

test('an audit actor parameter never overrides a restricted reviewer’s own identity', async () => {
  const { filters, own } = await auditFilters('support_agent', '10000000-0000-4000-8000-000000000002');
  assert.deepEqual(filters, [{ table: 'admin_audit_log', column: 'admin_id', value: own }]);
});

test('invalid audit actor input is never forwarded into a database filter', async () => {
  const { filters } = await auditFilters('super_admin', 'invalid).or(admin_id.neq.null');
  assert.deepEqual(filters, []);
});
