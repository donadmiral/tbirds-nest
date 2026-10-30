const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.join(__dirname, '..');

function load(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, Date, require: name => Object.hasOwn(imports, name) ? imports[name] : require(name) });
  return module.exports;
}
function elements(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, type));
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}
async function renderStaff() {
  const permissions = load('lib/permissions.ts', {});
  const staffDirectory = load('lib/staffDirectory.ts', {});
  const admin = { id: 'fixture-owner', role: 'super_admin', email: 'owner@example.test', sessionId: 'fixture-session', aal: 'aal1' };
  let authorized = false;
  const service = {
    from(table) {
      assert.equal(authorized, true);
      const result = table === 'admin_users' ? { data: [{ user_id: admin.id, role: 'super_admin', active: true, created_at: '2026-10-01T00:00:00Z' }], count: 1, error: null } : { data: [], error: null };
      const query = { select() { return query; }, order() { return query; }, limit() { return query; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
      return query;
    },
    auth: { admin: { getUserById: async id => ({ data: { user: { id, email: admin.email } }, error: null }) } },
  };
  const noWrite = () => { throw new Error('Rendering must not create or modify staff'); };
  const page = load('app/staff/page.tsx', {
    '@/lib/permissions': permissions, '@/lib/staffDirectory': staffDirectory,
    '@/lib/completeRead': load('lib/completeRead.ts', { 'server-only': {} }),
    '@/lib/adminAuth': { requireDesk: async () => { authorized = true; return admin; } },
    '@/lib/supabaseAdmin': { serviceClient: () => service },
    '@/lib/actions': { inviteStaff: noWrite, setStaffRole: noWrite, deactivateStaff: noWrite },
    '@/components/CommandForm': { default: 'CommandForm' }, '@/components/PermissionGate': { default: 'PermissionGate' },
    '@/components/Shell': { default: 'Shell' }, '@/components/Desk': { Desk: 'Desk', StatStrip: 'StatStrip' },
    '@/components/Viz': { Donut: 'Donut', Empty: 'Empty' }, '@/lib/fmt': load('lib/fmt.ts', {}),
    'next/navigation': { redirect: noWrite },
  });
  return { tree: await page.default(), roles: [...permissions.STAFF_ROLES] };
}

test('actual invite page defaults to read-only auditor without removing or reordering roles', async () => {
  const { tree, roles } = await renderStaff();
  const invite = elements(tree, 'CommandForm').find(form => form.props.scope === 'inviteStaff');
  assert.ok(invite);
  const select = elements(invite, 'select').find(control => control.props.name === 'role');
  assert.equal(select.props.defaultValue, 'auditor_readonly');
  assert.deepEqual(elements(select, 'option').map(option => option.props.value), roles);
  const html = renderToStaticMarkup(select);
  assert.match(html, /<option value="auditor_readonly" selected="">Auditor Readonly<\/option>/);
  assert.doesNotMatch(html, /<option value="super_admin" selected/);
});
