const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');

const source = fs.readFileSync(path.join(__dirname, '../components/AppShell.tsx'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(viewer, profileRead) {
 const queries = [];
 const supabase = { from(table) {
  const query = { table, filters: [] }; queries.push(query);
  const builder = { select: columns => { query.columns = columns; return builder; }, eq: (key, value) => { query.filters.push([key, value]); return builder; }, maybeSingle: () => profileRead() };
  return builder;
 } };
 const module = { exports: {} };
 vm.runInNewContext(output, { module, exports: module.exports, require(name) {
  if (name === 'react/jsx-runtime') return jsx;
  if (name === '@/lib/serverViewer') return { getServerViewer: async () => ({ supabase, user: await viewer }) };
  if (name === 'next/link') return { __esModule: true, default: 'a' };
  if (name === '@/components/NavigationLoading') return { RememberNavigationChrome: 'RememberNavigationChrome' };
  if (name.endsWith('.module.css')) return { __esModule: true, default: { professionalMain: 'professional-main', skipLink: 'skip-link' } };
  const key = name.split('/').at(-1); return { [key]: key };
 } });
 return { render: module.exports.AppShell, queries };
}
function find(node, type) {
 if (!node || typeof node !== 'object') return null;
 if (node.type === type) return node;
 for (const child of [].concat(node.props?.children || [])) { const result = find(child, type); if (result) return result; }
 return null;
}

test('authenticated professional workspace renders without dispatching an unused navigation-profile read', async () => {
 const h = fixture({ id: 'viewer' }, () => assert.fail('Professional shell does not consume this profile'));
 const result = await h.render({ professional: true, children: 'Workspace contents' });
 assert.equal(h.queries.length, 0); assert.equal(result.props.className, 'professional-main');
 assert.equal(find(result, 'main').props.children, 'Workspace contents');
 for (const type of ['WebCallLayer', 'GlobalMediaLightbox', 'ScrollMemory']) assert.ok(find(result, type), type);
 assert.equal(find(result, 'RememberNavigationChrome'), null);
});
test('professional branch still waits for the authenticated viewer and preserves the signed-out shell', async () => {
 const auth = deferred(), h = fixture(auth.promise, () => assert.fail('Signed-out shell must not read a private profile'));
 let settled = false; const work = h.render({ professional: true, children: 'Route content' }).then(value => { settled = true; return value; });
 await Promise.resolve(); assert.equal(settled, false); assert.equal(h.queries.length, 0);
 auth.resolve(null); const result = await work;
 assert.ok(find(result, 'header')); assert.equal(find(result, 'WebCallLayer'), null); assert.equal(h.queries.length, 0);
 assert.equal(find(result, 'RememberNavigationChrome').props.identity, null, 'A verified guest clears remembered chrome without recording an identity.');
});
test('standard navigation still reads and renders the authenticated profile rather than falling back while it is pending', async () => {
 const profile = deferred(), h = fixture({ id: 'viewer' }, () => profile.promise);
 let settled = false; const work = h.render({ children: 'Feed' }).then(value => { settled = true; return value; });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(settled, false); assert.deepEqual(h.queries[0].filters, [['id', 'viewer']]);
 profile.resolve({ data: { full_name: 'A member', username: 'member', account_type: 'business', avatar_url: 'avatar', is_verified: true, verified_tier: 'gold' }, error: null });
 const result = await work, nav = find(result, 'Nav'), tabs = find(result, 'MobileTabBar');
 assert.equal(nav.props.name, 'A member'); assert.equal(nav.props.business, true); assert.equal(nav.props.verified, true); assert.equal(tabs.props.userId, 'viewer');
 const remembered = find(result, 'RememberNavigationChrome').props.identity;
 assert.equal(remembered.ownerId, 'viewer'); assert.equal(remembered.name, 'A member'); assert.equal(remembered.username, 'member'); assert.equal(remembered.business, true);
});
