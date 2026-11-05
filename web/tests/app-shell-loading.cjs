const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const React = require('react');
const { renderToPipeableStream } = require('react-dom/server');
const { PassThrough } = require('node:stream');

const source = fs.readFileSync(path.join(__dirname, '../components/AppShell.tsx'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function loadProfileHelper(name) {
 const module = { exports: {} };
 const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 vm.runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout,
  require: id => { assert.equal(id, './withTimeout'); return loadProfileHelper('withTimeout'); } });
 return module.exports;
}
const navigationProfile = loadProfileHelper('navigationProfile');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(viewer, profileRead, { streaming = false } = {}) {
 const queries = [];
 const supabase = { from(table) {
  const query = { table, filters: [] }; queries.push(query);
  const builder = { select: columns => { query.columns = columns; return builder; }, eq: (key, value) => { query.filters.push([key, value]); return builder; }, abortSignal: signal => { query.signal = signal; return builder; }, maybeSingle: () => profileRead() };
  return builder;
 } };
 const module = { exports: {} };
 const marker = name => streaming ? props => jsx.jsx('div', { 'data-component': name, children: props.name }) : name;
 vm.runInNewContext(output, { module, exports: module.exports, require(name) {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === '@/lib/serverViewer') return { getServerViewer: async () => ({ supabase, user: await viewer }) };
  if (name === '@/lib/navigationProfile') return navigationProfile;
  if (name === 'next/link') return { __esModule: true, default: 'a' };
  if (name === '@/components/NavigationLoading') return { RememberNavigationChrome: marker('RememberNavigationChrome') };
  if (name === '@/components/PendingAppChrome') return { PendingAppNavigation: marker('PendingAppNavigation'), PendingAppTopBar: marker('PendingAppTopBar') };
  if (name.endsWith('.module.css')) return { __esModule: true, default: { professionalMain: 'professional-main', skipLink: 'skip-link' } };
  const key = name.split('/').at(-1); return { [key]: marker(key) };
 } });
 return { render: module.exports.AppShell, queries };
}
function findAll(node, type) {
 if (!node || typeof node !== 'object') return [];
 return [...(node.type === type ? [node] : []), ...[].concat(node.props?.children || []).flatMap(child => findAll(child, type))];
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
test('standard content appears after authentication while one shared optional profile read streams only the chrome', async () => {
 const profile = deferred(), h = fixture({ id: 'viewer' }, () => profile.promise);
 const content = jsx.jsx('img', { src: '/post-image.jpg', alt: 'Existing post' });
 let settled = false; const work = h.render({ children: content }).then(value => { settled = true; return value; });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(settled, true, 'The optional profile must not block authenticated content');
 assert.deepEqual(h.queries[0].filters, [['id', 'viewer']]);
 const result = await work, boundaries = findAll(result, React.Suspense);
 assert.equal(boundaries.length, 2); assert.equal(h.queries.length, 1);
 assert.equal(boundaries[0].props.children.props.profile, boundaries[1].props.children.props.profile);
 assert.equal(find(result, 'img'), content, 'The page keeps its original content node');
 assert.equal(find(find(result, 'main'), React.Suspense), null);
 for (const boundary of boundaries) {
  assert.equal(find(boundary, 'main'), null, 'A profile fallback must never replace the page');
  assert.equal(boundary.props.fallback.props.ownerId, 'viewer');
 }
 profile.resolve({ data: { full_name: 'A member', username: 'member', account_type: 'business', avatar_url: 'avatar', is_verified: true, verified_tier: 'gold' }, error: null });
 const navigation = await boundaries[0].props.children.type(boundaries[0].props.children.props);
 const topbar = await boundaries[1].props.children.type(boundaries[1].props.children.props);
 const nav = find(navigation, 'Nav'), tabs = find(navigation, 'MobileTabBar');
 assert.equal(nav.props.name, 'A member'); assert.equal(nav.props.business, true); assert.equal(nav.props.verified, true); assert.equal(tabs.props.userId, 'viewer');
 assert.equal(topbar.props.name, 'A member');
 const remembered = find(navigation, 'RememberNavigationChrome').props.identity;
 assert.equal(remembered.ownerId, 'viewer'); assert.equal(remembered.name, 'A member'); assert.equal(remembered.username, 'member'); assert.equal(remembered.business, true);
 assert.equal(h.queries[0].signal.aborted, true);
});

test('standard shell still waits for actual viewer verification before exposing content or reading a profile', async () => {
 const auth = deferred(), h = fixture(auth.promise, async () => ({ data: null, error: null }));
 let settled = false; const work = h.render({ children: 'Private route' }).then(value => { settled = true; return value; });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(settled, false); assert.equal(h.queries.length, 0);
 auth.resolve({ id: 'viewer' }); const result = await work;
 assert.ok(find(result, 'main')); assert.equal(h.queries.length, 1);
});

test('optional profile rejection falls back to usable generic chrome and never fails the authorized page', async () => {
 const h = fixture({ id: 'viewer' }, async () => { throw Error('Profile unavailable'); });
 const result = await h.render({ children: 'Existing feed' });
 const boundaries = findAll(result, React.Suspense);
 const navigation = await boundaries[0].props.children.type(boundaries[0].props.children.props);
 const topbar = await boundaries[1].props.children.type(boundaries[1].props.children.props);
 assert.equal(find(navigation, 'Nav').props.name, 'Member');
 assert.equal(find(navigation, 'MobileTabBar').props.userId, 'viewer');
 assert.equal(topbar.props.name, 'Member'); assert.ok(find(result, 'main'));
 assert.equal(h.queries[0].signal.aborted, true);
});

test('React streams the real page image before profile completion and never serializes that content again on reveal', async t => {
 const profile = deferred(), shellReady = deferred();
 const h = fixture({ id: 'viewer' }, () => profile.promise, { streaming: true });
 const content = jsx.jsx('article', { id: 'retained-page', children: jsx.jsx('img', { src: '/post-image.jpg', alt: 'Existing post', loading: 'lazy' }) });
 const tree = await h.render({ children: content });
 const output = new PassThrough(), chunks = [], errors = [];
 output.on('data', chunk => chunks.push(String(chunk)));
 const finished = new Promise(resolve => output.on('end', resolve));
 const stream = renderToPipeableStream(tree, {
  onShellReady() { stream.pipe(output); shellReady.resolve(); },
  onError(error) { errors.push(error); },
 });
 t.after(() => { profile.resolve({ data: null, error: null }); stream.abort(); });
 await shellReady.promise; await new Promise(resolve => setImmediate(resolve));
 const before = chunks.join('');
 assert.match(before, /id="retained-page"/); assert.match(before, /alt="Existing post"/);
 assert.match(before, /PendingAppNavigation/); assert.doesNotMatch(before, /Profile complete/);
 profile.resolve({ data: { full_name: 'Profile complete', username: 'member' }, error: null });
 await finished;
 const complete = chunks.join('');
 assert.match(complete, /Profile complete/);
 assert.equal((complete.match(/id="retained-page"/g) || []).length, 1);
 assert.equal((complete.match(/alt="Existing post"/g) || []).length, 1);
 assert.deepEqual(errors, []); assert.equal(h.queries.length, 1);
});
